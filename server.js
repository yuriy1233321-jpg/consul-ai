
import express from "express";
import cors from "cors";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import crypto from "crypto";
import Fuse from "fuse.js";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { body, validationResult } from "express-validator";
import Stripe from "stripe";

const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;

// =====================
// 🔐 КОНФІГУРАЦІЯ
// =====================
const CONFIG = {
  API_KEY: process.env.OPENAI_API_KEY,
  QUESTIONS_PER_SESSION: 10,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY, // обов'язково
  CERT_SECRET: process.env.CERT_SECRET || crypto.randomBytes(32).toString("hex"),
  APP_URL: process.env.APP_URL || "http://localhost:3000",
  JWT_SECRET: process.env.JWT_SECRET,
  OPENAI_TIMEOUT: 15000,
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
  STRIPE_PRICE_BASIC: process.env.STRIPE_PRICE_BASIC,
  STRIPE_PRICE_PRO: process.env.STRIPE_PRICE_PRO,
  STRIPE_PRICE_BUSINESS: process.env.STRIPE_PRICE_BUSINESS,
};

if (!CONFIG.API_KEY) {
  console.error("❌ OPENAI_API_KEY is required");
  process.exit(1);
}
if (!CONFIG.JWT_SECRET) {
  console.error("❌ JWT_SECRET is required");
  process.exit(1);
}
if (!CONFIG.ADMIN_API_KEY) {
  console.error("❌ ADMIN_API_KEY is required");
  process.exit(1);
}

let stripe = null;
if (CONFIG.STRIPE_SECRET_KEY) {
  stripe = new Stripe(CONFIG.STRIPE_SECRET_KEY);
  console.log("✅ Stripe initialized");
} else {
  console.warn("⚠️ Stripe not configured, payments disabled");
}

// =====================
// 🛡️ WEBHOOK ПОВИНЕН БУТИ ДО express.json
// =====================
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  if (!stripe) {
    console.warn("Stripe not configured");
    return res.status(200).json({ received: true });
  }
  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, CONFIG.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(`Webhook signature failed: ${err.message}`);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const userId = session.metadata.userId;
    let planKey = "demo";
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      const priceId = lineItems.data[0]?.price?.id;
      if (priceId === CONFIG.STRIPE_PRICE_BASIC) planKey = "basic";
      else if (priceId === CONFIG.STRIPE_PRICE_PRO) planKey = "pro";
      else if (priceId === CONFIG.STRIPE_PRICE_BUSINESS) planKey = "business";
      else {
        const amount = session.amount_total / 100;
        if (amount === 39) planKey = "basic";
        else if (amount === 79) planKey = "pro";
        else if (amount === 599) planKey = "business";
      }
    } catch (err) { console.error("Failed to get line items:", err); }
    if (planKey !== "demo" && upgradeUserPlan(userId, planKey)) {
      console.log(`✅ Upgraded user ${userId} to ${planKey}`);
    }
  }
  res.json({ received: true });
});

// =====================
// 🛡️ БЕЗПЕКА ТА JSON
// =====================
app.use(helmet());
app.use(cors({ origin: CONFIG.APP_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));

// =====================
// 🧰 ДОПОМІЖНІ ФУНКЦІЇ
// =====================
function detectGender(name) {
  if (!name) return "male";
  const n = name.toLowerCase().trim();
  if (n.endsWith("a") && !["kuba", "barnaba"].includes(n)) return "female";
  return "male";
}
function getPolishForm(name) {
  return detectGender(name) === "female" ? "Pani" : "Pan";
}
function safeJSONParse(str, fallback = {}) {
  try {
    let clean = str.replace(/```json\s*|\s*```/g, '').trim();
    if (!clean) return fallback;
    return JSON.parse(clean);
  } catch {
    return fallback;
  }
}

// =====================
// 📊 МЕТРИКИ (базові)
// =====================
const metrics = {
  aiFails: 0,
  followUps: 0,
  repeats: 0,
  totalSessions: 0,
};

function incMetric(name) {
  if (metrics[name] !== undefined) metrics[name]++;
}

// =====================
// 🔎 ФІЛЬТРАЦІЯ ТА ВАЛІДАЦІЯ ПИТАНЬ
// =====================
const BANNED_WORDS_IN_QUESTION = [
  "wiza", "visa", "dokument", "document", "pozwolenie", "permit",
  "karta pobytu", "zezwolenie", "formalności", "urząd", "biuro",
  "dlaczego chcesz", "why do you want", "praca", "job", "wyjazd", "immigration"
];

function validateQuestion(questionObj) {
  const q = questionObj.question?.toLowerCase() || "";
  for (const banned of BANNED_WORDS_IN_QUESTION) {
    if (q.includes(banned)) return false;
  }
  if (q.length < 10) return false;
  if (!q.includes("?")) return false;
  return true;
}

function isGoodQuestion(q) {
  if (!q || typeof q !== 'object') return false;
  if (!q.question || typeof q.question !== 'string') return false;
  if (q.question.length < 15) return false;
  if (q.question.length > 200) return false;
  if (!q.question.includes("?")) return false;
  if (!q.keywords || !Array.isArray(q.keywords) || q.keywords.length === 0) return false;
  return true;
}

// =====================
// 💾 ФАЙЛОВІ СХОВИЩА (з чергою)
// =====================
class DataStore {
  constructor(file) {
    this.file = file;
    this.data = this.load();
    this.queue = Promise.resolve();
  }
  load() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return []; } }
  save() {
    this.queue = this.queue.then(async () => {
      const tempFile = this.file + ".tmp";
      await fsPromises.writeFile(tempFile, JSON.stringify(this.data, null, 2));
      await fsPromises.rename(tempFile, this.file);
    }).catch(err => console.error("Save error:", err));
    return this.queue;
  }
  asyncSave() { this.save(); }
  findAll() { return this.data; }
  findOne(pred) { return this.data.find(pred); }
  insert(item) { this.data.push(item); this.asyncSave(); return item; }
  update(pred, updater) {
    const idx = this.data.findIndex(pred);
    if (idx !== -1) { this.data[idx] = updater(this.data[idx]); this.asyncSave(); return true; }
    return false;
  }
}

const usersDB = new DataStore("users.json");
const resultsDB = new DataStore("results.json");
const memoryStore = new DataStore("memory.json");

// =====================
// 📚 БАНК ПИТАНЬ (з індексами для швидкості)
// =====================
let questionBank = [];
let questionIndex = new Map(); // key: `${topic}_${difficulty}_${type}`

function rebuildQuestionIndex() {
  questionIndex.clear();
  for (const q of questionBank) {
    const key = `${q.topic}_${q.difficulty}_${q.type || "fact"}`;
    if (!questionIndex.has(key)) questionIndex.set(key, []);
    questionIndex.get(key).push(q);
  }
}

try {
  if (fs.existsSync("questions.json")) {
    questionBank = JSON.parse(fs.readFileSync("questions.json", "utf8"));
    console.log(`✅ Loaded ${questionBank.length} questions`);
  } else {
    questionBank = [
      { id:"sym_001", topic:"polish symbols", difficulty:"easy", type:"fact", question:"Jakie są trzy polskie symbole narodowe?", answerKeywords:["orzeł","flaga","hymn"], hint:"Orzeł, flaga, hymn", intro:"Symbole narodowe" }
    ];
    fs.writeFileSync("questions.json", JSON.stringify(questionBank, null, 2));
  }
} catch(e) { console.error("Question bank error", e); }

questionBank = questionBank.map(q => ({ ...q, type: q.type || "fact" }));
rebuildQuestionIndex();

// =====================
// 🔍 НЕЧІТКИЙ SCORER
// =====================
class FuzzyScorer {
  calculateScore(answer, keywords) {
    const ans = answer.toLowerCase();
    let matched = 0;
    for (let kw of keywords) if (ans.includes(kw.toLowerCase())) matched++;
    const score = (matched / keywords.length) * 10;
    return { score: Math.min(10, Math.round(score)), matched, total: keywords.length };
  }
}
const fuzzyScorer = new FuzzyScorer();

// =====================
// 🧠 ПАМ'ЯТЬ (з обмеженням росту)
// =====================
function getMemory(userId) {
  let mem = memoryStore.findOne(u => u.userId === userId);
  if (!mem) {
    mem = { userId, weakTopics: {}, strongTopics: {}, lastScores: [], totalAnswers: 0 };
    memoryStore.insert(mem);
  }
  mem.strongTopics = mem.strongTopics || {};
  if (mem.totalAnswers > 1000) {
    mem.lastScores = mem.lastScores.slice(-20);
  }
  return mem;
}
function updateMemory(userId, topic, score) {
  const mem = getMemory(userId);
  mem.lastScores.push(score);
  if (mem.lastScores.length > 10) mem.lastScores.shift();
  if (score < 5) {
    mem.weakTopics[topic] = (mem.weakTopics[topic] || 0) + 1;
    const entries = Object.entries(mem.weakTopics);
    if (entries.length > 20) mem.weakTopics = Object.fromEntries(entries.slice(0, 10));
  }
  if (score >= 8) {
    mem.strongTopics[topic] = (mem.strongTopics[topic] || 0) + 1;
  }
  mem.totalAnswers++;
  memoryStore.update(u => u.userId === userId, () => mem);
}
function getWeakTopics(userId) {
  const mem = getMemory(userId);
  return Object.entries(mem.weakTopics).sort((a,b)=>b[1]-a[1]).map(([t])=>t);
}
function getAverageScore(userId) {
  const mem = getMemory(userId);
  if (mem.lastScores.length === 0) return 5;
  return mem.lastScores.reduce((a,b)=>a+b,0) / mem.lastScores.length;
}
function isTopicMastered(userId, topic) {
  const mem = getMemory(userId);
  const strongCount = mem.strongTopics?.[topic] || 0;
  const avgScore = getAverageScore(userId);
  return strongCount >= 3 && avgScore >= 7;
}

// =====================
// 🎯 ЕКЗАМЕНАЦІЙНИЙ FLOW ТА ТИПИ ПИТАНЬ
// =====================
const EXAM_FLOW = [
  "polish symbols",
  "polish history",
  "polish culture",
  "polish geography",
  "famous poles",
  "polish traditions"
];
const QUESTION_TYPES = ["fact", "explanation", "comparison"];

function getNextTopicIndex(session) {
  const askedTopics = session.askedTopics || [];
  for (let i = 0; i < EXAM_FLOW.length; i++) {
    if (!askedTopics.includes(EXAM_FLOW[i])) return i;
  }
  return 0;
}
function getQuestionType(lastScore, topic, session, userId) {
  const mem = getMemory(userId);
  const strongCount = mem.strongTopics?.[topic] || 0;
  const weakCount = mem.weakTopics?.[topic] || 0;
  if (weakCount >= 2 && strongCount === 0) return "explanation";
  if (strongCount >= 2) return "comparison";
  if (lastScore >= 8) return "explanation";
  return "fact";
}

// =====================
// 🤖 AI СЕРВІС (з системним промптом)
// =====================
const SYSTEM_PROMPT = `
You are a Polish consul conducting a Karta Polaka interview.

ROLE:
You are NOT a chatbot.
You are NOT a teacher.
You are an examiner.

GOAL:
- verify real knowledge about Poland
- detect weak areas
- adapt questions dynamically

RULES:
- ask only about: history, culture, traditions, geography, famous people
- NEVER ask about: visa, documents, job, migration, "why do you want to come to Poland"
- You must maintain logical progression of topics.
- Do NOT jump randomly between unrelated subjects.
- If the user gives an incorrect answer → stay on the same topic until their understanding improves.
- Vary question types: fact, explanation, comparison.

BEHAVIOR:
- control conversation
- adjust difficulty based on answers
- if user is weak → simplify and repeat topic
- if user is strong → increase difficulty and move to next logical topic
- avoid random questions

STYLE:
- formal
- short
- like real consul

STRICTNESS:
- If the user answer is weak (score < 5):
  - be slightly strict
  - ask again (or rephrase the question)
  - do not move forward too quickly

You think before asking.
If a question includes forbidden topics → DO NOT generate it.
`;

class AIService {
  async _callOnce(messages) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.OPENAI_TIMEOUT);
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.API_KEY}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages,
          temperature: 0.2,
          response_format: { type: "json_object" }
        }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.choices?.[0]?.message?.content) throw new Error("Invalid OpenAI response");
      return data.choices[0].message.content;
    } catch (err) {
      if (err.name === "AbortError") throw new Error("OpenAI timeout");
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  async call(systemPrompt, userPrompt, retries = 2) {
    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ];
    for (let i = 0; i <= retries; i++) {
      try {
        return await this._callOnce(messages);
      } catch (err) {
        if (i < retries) {
          console.log(`🔁 Retry OpenAI ${i + 1}`);
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        console.error("❌ OpenAI FAILED:", err.message);
        incMetric("aiFails");
        return null;
      }
    }
  }

  async evaluateAnswer(question, answer, userId, session) {
    const keywords = session.currentQuestion?.answerKeywords || [];
    let fuzzyResult = null;
    if (keywords.length > 0) {
      fuzzyResult = fuzzyScorer.calculateScore(answer, keywords);
      if (fuzzyResult.score >= 8 && answer.length >= 15) {
        return {
          totalScore: fuzzyResult.score,
          feedback: "Dobra odpowiedź.",
          strengths: ["Poprawna treść"],
          weaknesses: [],
          correctedVersion: null,
          scores: { content: fuzzyResult.score, grammar: fuzzyResult.score, vocabulary: fuzzyResult.score, fluency: fuzzyResult.score, completeness: fuzzyResult.score }
        };
      }
    }

    const prevAnswers = session.answersDetails?.slice(-3).map(a =>
      `Q: ${a.question}\nA: ${a.answer}\nScore: ${a.score}`
    ).join('\n') || 'Brak';

    const userPrompt = `
User profile:
- age: ${session.profile?.age || "?"}
- level: ${session.profile?.level || "?"}

Performance:
- average score: ${getAverageScore(userId).toFixed(1)}/10
- weak topics: ${getWeakTopics(userId).join(", ") || "brak"}

Previous question:
${session.currentQuestion?.question}

User answer:
${answer}

HISTORIA ROZMOWY (ostatnie 3 pytania):
${prevAnswers}

OBECNE PYTANIE: "${question}"
OBECNA ODPOWIEDŹ: "${answer}"

WAŻNE: ZAWSZE popraw błędy gramatyczne.
- Napisz poprawną wersję zdania.
- Wyjaśnij krótko, co było błędem (1–2 zdania).
- Oceń według kryteriów (0-10):
  1. Poprawność merytoryczna (content)
  2. Gramatyka i poprawność językowa (grammar)
  3. Bogactwo słownictwa (vocabulary)
  4. Płynność i spójność (fluency)
  5. Kompletność (completeness)

Dodatkowo:
- Wypisz maksymalnie 2 mocne strony.
- Wypisz maksymalnie 2 słabe strony.
- Podaj krótki feedback po polsku.

Zwróć JSON:
{
  "scores": {
    "content": number,
    "grammar": number,
    "vocabulary": number,
    "fluency": number,
    "completeness": number
  },
  "totalScore": number,
  "strengths": ["string", "string"],
  "weaknesses": ["string", "string"],
  "correctedVersion": "string | null",
  "grammarExplanation": "string | null",
  "feedback": "string"
}
`;
    try {
      const resp = await this.call(SYSTEM_PROMPT, userPrompt);
      if (!resp) throw new Error("No AI response");
      const evalResult = safeJSONParse(resp, null);
      if (!evalResult || !evalResult.scores) throw new Error("Invalid AI JSON");
      const scores = evalResult.scores;
      const total = scores ? Object.values(scores).reduce((a,b)=>a+b,0)/5 : evalResult.totalScore;
      evalResult.totalScore = Math.min(10, Math.max(0, Math.round(total)));

      if (session.mode === "exam") {
        evalResult.totalScore = Math.max(0, evalResult.totalScore - 1);
        if (fuzzyResult && evalResult.totalScore > 7) evalResult.totalScore = 7;
      }
      return evalResult;
    } catch (err) {
      console.error("Evaluation error:", err);
      incMetric("aiFails");
      if (fuzzyResult) return { totalScore: Math.min(fuzzyResult.score, 6), feedback: "Ocena automatyczna", strengths: [], weaknesses: [] };
      return { totalScore: 5, feedback: 'Dziękuję za odpowiedź.', strengths: [], weaknesses: [] };
    }
  }
}
const aiService = new AIService();
// =====================
// 🧩 ДОПОМІЖНІ AI-ФУНКЦІЇ
// =====================
async function generateAIQuestion(topic, difficulty, lastScore, type, session, userId) {
  const ageInfo = session.profile?.age ? `Wiek: ${session.profile.age}` : "";
  const levelInfo = session.profile?.level ? `Samooocena: ${session.profile.level}/5` : "";
  const avgScore = getAverageScore(userId);
  const weakTopics = getWeakTopics(userId).join(", ");

  const userPrompt = `
User profile:
${ageInfo}
${levelInfo}

Performance:
- average score: ${avgScore.toFixed(1)}/10
- weak topics: ${weakTopics || "brak"}

Last question score: ${lastScore}/10
Question type: ${type}

Instruction for question type:
- fact: ask about a specific fact, date, name, or event.
- explanation: ask "Why...", "Explain...", "What was the reason..."
- comparison: ask "Compare...", "What is the difference between..."

Wygeneruj jedno pytanie egzaminacyjne do Karty Polaka.

RESTRYKCJE:
- TYLKO o: historia, kultura, tradycje, geografia, symbole, sławni Polacy.
- NIGDY o: wiza, dokumenty, praca, migracja, "dlaczego chcesz przyjechać".
- Pytanie max 200 znaków.

Zwróć JSON:
{
  "question": "treść",
  "keywords": ["słowo1", "słowo2"],
  "hint": "podpowiedź",
  "intro": "krótkie wprowadzenie"
}
`;
  try {
    const response = await aiService.call(SYSTEM_PROMPT, userPrompt);
    if (!response) return null;
    const parsed = safeJSONParse(response, null);
    if (!parsed?.question) return null;
    if (!isGoodQuestion(parsed)) return null;
    if (!validateQuestion(parsed)) return null;
    if (!parsed.keywords?.length) parsed.keywords = [topic];
    return parsed;
  } catch { return null; }
}

async function generateFollowUpQuestion(originalQuestion, userAnswer, weaknesses, score) {
  const safeWeaknesses = (weaknesses || []).join(', ');
  let instruction = "";
  if (score <= 2) {
    instruction = "User answer is very weak. Repeat the SAME question but rephrase it differently. Do not change the meaning.";
  } else if (score <= 4) {
    instruction = "Ask a SIMPLER question on the same topic to help the user understand better.";
  } else if (score >= 8) {
    instruction = "User answered well. Ask a MORE DIFFICULT, follow-up question on the same topic to test deeper knowledge.";
  } else {
    instruction = "Ask a neutral follow-up question to clarify the answer.";
  }
  const prompt = `
Użytkownik odpowiedział na pytanie: "${originalQuestion}"
Jego odpowiedź: "${userAnswer}"
Słabe strony: ${safeWeaknesses}
Ocena: ${score}/10

${instruction}
Zwróć JSON: { "question": "...", "hint": "..." }
`;
  try {
    const resp = await aiService.call(SYSTEM_PROMPT, prompt);
    if (!resp) return null;
    return safeJSONParse(resp, null);
  } catch { return null; }
}

// =====================
// 🎯 ВИБІР НАСТУПНОГО ПИТАННЯ (з індексами)
// =====================
async function getNextQuestion(userId, session, lastScore) {
  const weakTopics = getWeakTopics(userId);
  const avgScore = getAverageScore(userId);
  const askedQuestionIds = new Set(session.askedQuestions || []);

  let targetTopic;
  let targetDifficulty;

  if (lastScore < 5) {
    targetTopic = session.currentTopic;
    targetDifficulty = "easy";
  } else if (lastScore >= 8) {
    let nextIdx = getNextTopicIndex(session);
    targetTopic = EXAM_FLOW[nextIdx];
    targetDifficulty = "hard";
  } else {
    targetTopic = session.currentTopic;
    targetDifficulty = avgScore >= 7 ? "medium" : (avgScore <= 5 ? "easy" : "medium");
  }
  if (!targetTopic) targetTopic = EXAM_FLOW[0];

  if (isTopicMastered(userId, targetTopic)) {
    const nextIdx = (getNextTopicIndex(session) + 1) % EXAM_FLOW.length;
    targetTopic = EXAM_FLOW[nextIdx];
  }

  const targetType = getQuestionType(lastScore, targetTopic, session, userId);
  const key = `${targetTopic}_${targetDifficulty}_${targetType}`;
  let candidates = questionIndex.get(key) || [];
  candidates = candidates.filter(q => !askedQuestionIds.has(q.id));

  if (candidates.length === 0) {
    const fallbackKey = `${targetTopic}_${targetDifficulty}_fact`;
    candidates = questionIndex.get(fallbackKey) || [];
    candidates = candidates.filter(q => !askedQuestionIds.has(q.id));
  }
  if (candidates.length === 0) {
    candidates = questionBank.filter(q => q.topic === targetTopic && !askedQuestionIds.has(q.id));
  }
  if (candidates.length === 0) {
    candidates = questionBank.filter(q => !askedQuestionIds.has(q.id));
  }

  let selected = null;
  if (candidates.length === 0) {
    session.askedQuestions = [];
    selected = questionBank.find(q => q.topic === targetTopic) || questionBank[0];
  } else {
    candidates.sort((a, b) => {
      const diffOrder = { "easy": 0, "medium": 1, "hard": 2 };
      return diffOrder[a.difficulty] - diffOrder[b.difficulty];
    });
    selected = candidates[0];
  }

  const useAI = (weakTopics.includes(targetTopic) && candidates.length < 2) && (lastScore < 7);
  if (useAI) {
    const aiQuestion = await generateAIQuestion(targetTopic, targetDifficulty, lastScore, targetType, session, userId);
    if (aiQuestion && isGoodQuestion(aiQuestion) && validateQuestion(aiQuestion)) {
      aiQuestion.id = `ai_${Date.now()}`;
      aiQuestion.topic = targetTopic;
      aiQuestion.difficulty = targetDifficulty;
      aiQuestion.type = targetType;
      aiQuestion.answerKeywords = aiQuestion.keywords || [targetTopic];
      aiQuestion.intro = aiQuestion.intro || "Pytanie od konsula:";
      return aiQuestion;
    } else {
      console.warn(`⚠️ AI failed to generate good question for topic ${targetTopic}, fallback to static`);
    }
  }
  return selected;
}

// =====================
// 📜 СЕРТИФІКАТИ
// =====================
function generateToken(userId, score, date) {
  const payload = `${userId}:${score}:${date}`;
  const sig = crypto.createHmac("sha256", CONFIG.CERT_SECRET).update(payload).digest("hex");
  return `${Buffer.from(payload).toString("base64")}.${sig}`;
}
function verifyToken(token) {
  const [b64, sig] = token.split(".");
  if (!b64 || !sig) return null;
  const payload = Buffer.from(b64, "base64").toString();
  const expected = crypto.createHmac("sha256", CONFIG.CERT_SECRET).update(payload).digest("hex");
  if (sig !== expected) return null;
  const [userId, score, date] = payload.split(":");
  return { userId, score: parseFloat(score), date: parseInt(date) };
}

// =====================
// 🎮 КОНТРОЛЕР ІНТЕРВ'Ю (збереження сесії)
// =====================
class InterviewController {
  getSession(userId) {
  let user = usersDB.findOne(u => u.userId === userId);

  if (!user) {
    return this.createSession(userId);
  }

  if (!user.session) {
    return this.createSession(userId);
  }

  if (user.session.finished) {
    return this.createSession(userId);
  }

  return user.session;
}
  createSession(userId) {
    const session = {
      userId,
      mode: "learning",
      step: "choose_mode",
      answers: [],
      answersDetails: [],
      askedTopics: [],
      askedQuestions: [],
      questionIndex: 0,
      followUpCount: 0,
      lastFollowUpTopic: null,
      finished: false,
      profile: { age: null, gender: null, level: null, goal: "karta_polaka" }
    };
    const existing = usersDB.findOne(u => u.userId === userId);
    if (existing) {
      usersDB.update(u => u.userId === userId, u => ({ ...u, session }));
    } else {
      usersDB.insert({ userId, session, createdAt: Date.now() });
    }
    metrics.totalSessions++;
    return session;
  }
  saveSession(userId, session) {
    usersDB.update(u => u.userId === userId, u => ({ ...u, session }));
  }
  async handleMessage(req, res) {
    const userId = req.user.userId;
    let { message } = req.body;

    // ВАЛІДАЦІЯ ТА ОЧИЩЕННЯ
    if (message !== undefined) {
      if (typeof message !== "string") {
        return res.status(400).json({ error: "Invalid message type" });
      }
      message = message.trim();
      if (message.length === 0 || message.length > 500) {
        return res.status(400).json({ error: "Invalid message length" });
      }
    }

    let session = this.getSession(userId);
    if (session.finished) this.createSession(userId);
    session = this.getSession(userId);

    // ---- Вибір режиму ----
    if (session.step === "choose_mode") {
      session.step = "choosing_mode";
      this.saveSession(userId, session);
      return res.json({ type: "question", question: "Wybierz tryb: napisz 'nauka' lub 'egzamin'.", mode: session.mode });
    }
    if (session.step === "choosing_mode") {
      const msg = (message || "").toLowerCase();
      session.mode = msg.includes("egzamin") ? "exam" : "learning";
      session.step = "ask_name";
      this.saveSession(userId, session);
      return res.json({ type: "info", message: `Wybrano tryb: ${session.mode === "exam" ? "Egzamin (bez pomocy)" : "Nauka (z podpowiedziami)"}`, mode: session.mode });
    }

    // ---- Ім'я ----
    if (session.step === "ask_name") {
      session.step = "waiting_name";
      this.saveSession(userId, session);
      return res.json({ type: "question", question: "Dzień dobry. Proszę podać swoje imię.", mode: session.mode });
    }
    if (session.step === "waiting_name") {
      if (!message || message.length < 2) {
        return res.json({ type: "question", question: "Proszę podać poprawne imię.", mode: session.mode });
      }
      session.name = message;
      session.step = "ask_profile";
      this.saveSession(userId, session);
      return res.json({ type: "question", question: "Proszę podać swój wiek:", mode: session.mode });
    }

    // ---- Профіль: вік ----
    if (session.step === "ask_profile") {
      const age = parseInt(message);
      if (isNaN(age) || age < 18 || age > 100) {
        return res.json({ type: "question", question: "Proszę podać poprawny wiek (18-100).", mode: session.mode });
      }
      session.profile.age = age;
      session.profile.gender = detectGender(session.name);
      session.step = "ask_level";
      this.saveSession(userId, session);
      return res.json({ type: "question", question: "Jak ocenia Pan/Pani swój poziom wiedzy o Polsce? (1-5)", mode: session.mode });
    }

    // ---- Профіль: рівень знань ----
    if (session.step === "ask_level") {
      const level = parseInt(message);
      session.profile.level = isNaN(level) ? 3 : Math.min(5, Math.max(1, level));
      session.step = "ready";
      const first = questionBank[0];
      session.currentQuestion = first;
      session.askedQuestions.push(first.id);
      session.currentTopic = first.topic;
      if (!session.askedTopics) session.askedTopics = [];
      session.askedTopics.push(first.topic);
      this.saveSession(userId, session);
      return res.json({
        type: "question",
        intro: first.intro || "Proszę odpowiedzieć.",
        question: first.question,
        hint: session.mode === "learning" ? first.hint : null,
        index: 1,
        total: CONFIG.QUESTIONS_PER_SESSION,
        progress: 0,
        mode: session.mode
      });
    }

    // ---- Головна логіка інтерв'ю ----
    if (session.step === "ready") {
      try {
        if (!message) return res.json({ type: "error", message: "No answer", mode: session.mode });

        let evaluation;
        try {
          evaluation = await aiService.evaluateAnswer(session.currentQuestion.question, message, userId, session);
        } catch (err) {
          console.error("AI evaluation failed, using fuzzy fallback", err);
          const keywords = session.currentQuestion?.answerKeywords || [];
          const fuzzy = fuzzyScorer.calculateScore(message, keywords);
          evaluation = { totalScore: fuzzy.score, feedback: "Ocena tymczasowa (AI niedostępne)", strengths: [], weaknesses: [] };
        }

        const score = evaluation.totalScore || 5;

        // Запобігання зациклюванню follow-up
        if (session.lastFollowUpTopic === session.currentTopic && score < 3) {
          session.followUpCount = 2;
          incMetric("repeats");
        }

        // Жорсткий follow-up + стоп на дуже погані відповіді
        if (session.mode === "learning" && (session.followUpCount || 0) < 2) {
          if (score <= 2 && session.followUpCount >= 1) {
            updateMemory(userId, session.currentTopic, score);
            this.saveSession(userId, session);
            return res.json({
              type: "repeat_topic",
              message: "Musimy wrócić do tego tematu. Na tym etapie nie przejdziesz dalej. Proszę odpowiedzieć poprawnie lub przejrzeć materiał.",
              topic: session.currentTopic,
              hint: session.currentQuestion.hint || "Przypomnij sobie podstawowe informacje."
            });
          }
          if (score < 5 && message.length > 5) {
            session.followUpCount = (session.followUpCount || 0) + 1;
            session.lastFollowUpTopic = session.currentTopic;
            incMetric("followUps");
            const followUp = await generateFollowUpQuestion(session.currentQuestion.question, message, evaluation.weaknesses, score);
            if (followUp?.question) {
              session.currentQuestion = {
                id: `followup_${Date.now()}`,
                topic: session.currentTopic,
                question: followUp.question,
                hint: followUp.hint || "",
                intro: "Dopytam bardziej szczegółowo:",
                answerKeywords: []
              };
              this.saveSession(userId, session);
              return res.json({
                type: "question",
                intro: session.currentQuestion.intro,
                question: session.currentQuestion.question,
                hint: session.currentQuestion.hint,
                followUp: true,
                mode: session.mode
              });
            }
          }
        }

        // Збереження відповіді
        session.answers.push(score);
        session.questionIndex++;
        session.progress = Math.round((session.questionIndex / CONFIG.QUESTIONS_PER_SESSION) * 100);
        updateMemory(userId, session.currentTopic, score);
        if (score >= 6) session.followUpCount = 0;

        // Adaptive mode switching
        const newAvg = getAverageScore(userId);
        if (session.mode !== "exam" && newAvg >= 8) {
          session.mode = "exam";
          console.log(`📈 User ${userId} promoted to EXAM mode (avg: ${newAvg})`);
        } else if (session.mode !== "learning" && newAvg <= 5) {
          session.mode = "learning";
          console.log(`📉 User ${userId} demoted to LEARNING mode (avg: ${newAvg})`);
        }

        if (!session.answersDetails) session.answersDetails = [];
        session.answersDetails.push({
          question: session.currentQuestion.question,
          answer: message,
          score,
          feedback: evaluation.feedback,
          strengths: evaluation.strengths,
          weaknesses: evaluation.weaknesses,
          correctedVersion: evaluation.correctedVersion,
          grammarExplanation: evaluation.grammarExplanation
        });
        if (session.answersDetails.length > 10) session.answersDetails.shift();

        // Finish session
        if (session.questionIndex >= CONFIG.QUESTIONS_PER_SESSION) {
          const total = session.answers.reduce((a,b)=>a+b,0);
          const avg = total / session.answers.length;
          const weak = getWeakTopics(userId);
          const final = {
            type: "final",
            mode: session.mode,
            level: avg >= 8 ? "bardzo dobry" : avg >= 6 ? "dobry" : "dostateczny",
            recommendation: avg >= 6 ? "ready" : "not_ready",
            averageScore: avg.toFixed(1),
            weakTopics: weak,
            progress: 100
          };
          session.finished = true;
          resultsDB.insert({ userId, answers: session.answers, finalReport: final, createdAt: new Date().toISOString() });
          if (final.recommendation === "ready") {
            const cert = { verificationUrl: `${CONFIG.APP_URL}/api/certificate/verify?token=${generateToken(userId, avg, Date.now())}` };
            final.certificate = cert;
          }
          this.saveSession(userId, session);
          return res.json(final);
        }

        // Наступне питання
        const nextQ = await getNextQuestion(userId, session, score);
        session.currentQuestion = nextQ;
        session.currentTopic = nextQ.topic;
        session.askedQuestions.push(nextQ.id);
        if (!session.askedTopics.includes(nextQ.topic)) session.askedTopics.push(nextQ.topic);
        this.saveSession(userId, session);

        return res.json({
          type: "next_question",
          evaluation: {
            score,
            feedback: session.mode === "learning" ? evaluation.feedback : "Odpowiedź przyjęta",
            strengths: evaluation.strengths?.slice(0, 2),
            weaknesses: evaluation.weaknesses?.slice(0, 2),
            correctedVersion: evaluation.correctedVersion,
            grammarExplanation: evaluation.grammarExplanation
          },
          nextQuestion: {
            intro: nextQ.intro || "Proszę odpowiedzieć.",
            question: nextQ.question,
            hint: session.mode === "learning" ? nextQ.hint : null,
            index: session.questionIndex + 1
          },
          progress: session.progress,
          current: session.questionIndex,
          total: CONFIG.QUESTIONS_PER_SESSION,
          mode: session.mode
        });
      } catch (err) {
        console.error("🔥 CRITICAL ERROR:", err);
        return res.json({ type: "error", message: "Temporary issue, try again", mode: session.mode });
      }
    }
    return res.json({ type: "error", message: "Unknown step", mode: session.mode });
  }
}
const interviewController = new InterviewController();

// =====================
// 💰 ПІДПИСКИ ТА ДОСТУП
// =====================
const PLANS = {
  demo: { name: "Demo", maxQuestions: 3, price: 0, durationDays: null },
  basic: { name: "Start", maxQuestions: 20, price: 39, durationDays: 30 },
  pro: { name: "Profi", maxQuestions: Infinity, price: 79, durationDays: 30 },
  business: { name: "Biznes", maxQuestions: Infinity, price: 599, durationDays: null }
};

function upgradeUserPlan(userId, planKey) {
  const user = usersDB.findOne(u => u.userId === userId);
  if (!user) return false;
  user.plan = planKey;
  if (planKey !== 'business' && PLANS[planKey]?.durationDays) {
    user.subscriptionExpiresAt = Date.now() + PLANS[planKey].durationDays * 24 * 60 * 60 * 1000;
  } else {
    user.subscriptionExpiresAt = null;
  }
  usersDB.update(u => u.userId === userId, () => user);
  return true;
}

function checkAccess(req, res, next) {
  const userId = req.user.userId;
  const user = usersDB.findOne(u => u.userId === userId);
  if (!user) return res.status(401).json({ error: "User not found" });

  const planKey = user.plan || "demo";
  const plan = PLANS[planKey];

  if (planKey !== "demo" && planKey !== "business" && user.subscriptionExpiresAt && Date.now() > user.subscriptionExpiresAt) {
    return res.json({
      type: "expired",
      message: "Twoja subskrypcja wygasła. Odnów dostęp.",
      plans: [
        { name: "Start (39 zł/mies.)", link: "https://flexiway.pl/cennik/" },
        { name: "Profi (79 zł/mies.)", link: "https://flexiway.pl/cennik/" },
        { name: "Biznes (599 zł na zawsze)", link: "https://flexiway.pl/cennik/" }
      ]
    });
  }

  if (planKey === "demo") {
    const session = user.session || {};
    const questionsUsed = session.questionIndex || 0;
    if (questionsUsed >= plan.maxQuestions) {
      return res.json({
        type: "paywall",
        message: "Koniec wersji demo. Wykup pełny dostęp, aby kontynuować przygotowania do rozmowy.",
        plans: [
          { name: "Start (39 zł/mies.)", price: "39 zł", link: "https://flexiway.pl/cennik/" },
          { name: "Profi (79 zł/mies.)", price: "79 zł", link: "https://flexiway.pl/cennik/" },
          { name: "Biznes (599 zł na zawsze)", price: "599 zł", link: "https://flexiway.pl/cennik/" }
        ]
      });
    }
  }
  next();
}

// =====================
// АВТЕНТИФІКАЦІЯ ТА RATE LIMIT
// =====================
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Access token required" });
  jwt.verify(token, CONFIG.JWT_SECRET, { algorithms: ["HS256"] }, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  });
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, skipSuccessfulRequests: true });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => `${req.user?.userId}_${req.ip}`
});

// =====================
// МАРШРУТИ
// =====================
app.post('/api/register', authLimiter,
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 6 }),
  body('name').optional().isString().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password, name } = req.body;
    const existing = usersDB.findOne(u => u.email === email);
    if (existing) return res.status(400).json({ error: "User already exists" });
    const hashed = await bcrypt.hash(password, 10);
    const userId = `user_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
    const session = interviewController.createSession(userId);

usersDB.insert({
  userId,
  email,
  password: hashed,
  name: name || email.split('@')[0],
  plan: "demo",
  subscriptionExpiresAt: null,
  createdAt: Date.now(),
  session
});
    res.status(201).json({ message: "User created", userId });
  }
);

app.post('/api/login', authLimiter,
  body('email').isEmail(),
  body('password').notEmpty(),
  async (req, res) => {
    const { email, password } = req.body;
    const user = usersDB.findOne(u => u.email === email);
    if (!user) return res.status(401).json({ error: "Invalid credentials" });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign({ userId: user.userId, email: user.email, name: user.name }, CONFIG.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.userId, email: user.email, name: user.name } });
  }
);

app.get('/api/user/subscription', authenticateToken, (req, res) => {
  const user = usersDB.findOne(u => u.userId === req.user.userId);
  if (!user) return res.status(404).json({ error: "User not found" });
  const plan = PLANS[user.plan] || PLANS.demo;
  res.json({
    plan: user.plan,
    planName: plan.name,
    expiresAt: user.subscriptionExpiresAt,
    isDemo: user.plan === "demo",
    questionsUsed: user.session?.questionIndex || 0,
    limit: plan.maxQuestions
  });
});

app.post('/chat', authenticateToken, checkAccess, chatLimiter, aiLimiter, (req, res) => interviewController.handleMessage(req, res));

app.get("/health", (req, res) => res.json({ status: "healthy", version: "5.2", metrics }));
app.get("/api/certificate/verify", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Missing token" });
  const data = verifyToken(token);
  if (!data) return res.status(400).json({ error: "Invalid certificate" });
  res.json({ valid: true, userId: data.userId, score: data.score, issuedAt: new Date(data.date).toISOString() });
});

app.use("/api/admin", (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (key !== CONFIG.ADMIN_API_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
});
app.get("/api/admin/stats", (req, res) => {
  res.json({ users: usersDB.findAll().length, results: resultsDB.findAll().length, metrics });
});

// =====================
// ФРОНТЕНД
// =====================
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, "client/dist")));
app.get("*", (req, res) => {
  if (!req.path.startsWith("/api")) {
    const filePath = path.join(__dirname, "client/dist/index.html");
    if (fs.existsSync(filePath)) res.sendFile(filePath);
    else res.send("Frontend not built");
  }
});

// =====================
// ЗАПУСК
// =====================
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
