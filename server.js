
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Fuse from "fuse.js";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { body, validationResult } from "express-validator";

const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

const app = express();
app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;

// =====================
// КОНФІГУРАЦІЯ
// =====================
const CONFIG = {
  API_KEY: process.env.OPENAI_API_KEY,
  QUESTIONS_PER_SESSION: 10,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY || "admin123",
  CERT_SECRET: process.env.CERT_SECRET || crypto.randomBytes(32).toString("hex"),
  APP_URL: process.env.APP_URL || "http://localhost:3000",
  JWT_SECRET: process.env.JWT_SECRET,
  OPENAI_TIMEOUT: 8000,
};

if (!CONFIG.API_KEY) {
  console.error("❌ OPENAI_API_KEY is required");
  process.exit(1);
}
if (!CONFIG.JWT_SECRET) {
  console.error("❌ JWT_SECRET is required");
  process.exit(1);
}

// =====================
// БЕЗПЕКА
// =====================
app.use(helmet());
app.use(cors({ origin: CONFIG.APP_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));
// ❌ Видалено дублюючий static зверху – залишиться тільки в кінці

// =====================
// ДОПОМІЖНІ ФУНКЦІЇ
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
// ФАЙЛОВІ СХОВИЩА (з атомарним записом)
// =====================
class DataStore {
  constructor(file) { this.file = file; this.data = this.load(); }
  load() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return []; } }
  save() {
    const tempFile = this.file + ".tmp";
    fs.writeFileSync(tempFile, JSON.stringify(this.data, null, 2));
    fs.renameSync(tempFile, this.file);
  }
  findAll() { return this.data; }
  findOne(pred) { return this.data.find(pred); }
  insert(item) { this.data.push(item); this.save(); return item; }
  update(pred, updater) { const idx = this.data.findIndex(pred); if (idx !== -1) { this.data[idx] = updater(this.data[idx]); this.save(); return true; } return false; }
}

const usersDB = new DataStore("users.json");
const resultsDB = new DataStore("results.json");
const memoryStore = new DataStore("memory.json");

// =====================
// БАНК ПИТАНЬ
// =====================
let questionBank = [];
try {
  if (fs.existsSync("questions.json")) {
    questionBank = JSON.parse(fs.readFileSync("questions.json", "utf8"));
    console.log(`✅ Loaded ${questionBank.length} questions`);
  } else {
    questionBank = [
      { id:"sym_001", topic:"polish symbols", difficulty:"easy", question:"Jakie są trzy polskie symbole narodowe?", answerKeywords:["orzeł","flaga","hymn"], hint:"Orzeł, flaga, hymn", intro:"Symbole narodowe" }
    ];
    fs.writeFileSync("questions.json", JSON.stringify(questionBank, null, 2));
  }
} catch(e) { console.error("Question bank error", e); }

// =====================
// НЕЧІТКИЙ SCORER
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
// ПАМ'ЯТЬ (з обмеженням розміру weakTopics)
// =====================
function getMemory(userId) {
  let mem = memoryStore.findOne(u => u.userId === userId);
  if (!mem) {
    mem = { userId, weakTopics: {}, lastScores: [], totalAnswers: 0 };
    memoryStore.insert(mem);
  }
  return mem;
}
function updateMemory(userId, topic, score) {
  const mem = getMemory(userId);
  mem.lastScores.push(score);
  if (mem.lastScores.length > 10) mem.lastScores.shift();
  if (score < 5) {
    mem.weakTopics[topic] = (mem.weakTopics[topic] || 0) + 1;
    // Обмеження розміру weakTopics
    const entries = Object.entries(mem.weakTopics);
    if (entries.length > 20) {
      mem.weakTopics = Object.fromEntries(entries.slice(0, 10));
    }
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

// =====================
// AI СЕРВІС (з retry, таймаутом, обробкою помилок)
// =====================
class AIService {
  async _callOnce(prompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.OPENAI_TIMEOUT);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${CONFIG.API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.2
      }),
      signal: controller.signal
    });

    // ❗ HTTP помилка (401, 429, 500 і т.д.)
    if (!res.ok) {
      const text = await res.text();
      console.error("❌ OpenAI HTTP ERROR:", res.status, text);
      throw new Error(`OpenAI HTTP ${res.status}`);
    }

    // ❗ JSON парсинг
    let data;
    try {
      data = await res.json();
    } catch (e) {
      console.error("❌ JSON parse error");
      throw new Error("Invalid JSON from OpenAI");
    }

    // ❗ структура відповіді
    if (!data?.choices?.[0]?.message) {
      console.error("❌ Bad OpenAI structure:", JSON.stringify(data).slice(0, 300));
      throw new Error("Invalid OpenAI response structure");
    }

    const content = data.choices[0].message.content;

    // ❗ пуста відповідь
    if (!content || typeof content !== "string") {
      throw new Error("Empty OpenAI response");
    }

    return content;

  } catch (err) {
    if (err.name === "AbortError") {
      console.error("❌ OpenAI TIMEOUT");
      throw new Error("OpenAI timeout");
    }

    console.error("❌ OpenAI FULL ERROR:", err.message);
    throw err;

  } finally {
    clearTimeout(timeout);
  }
}

  async call(prompt, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await this._callOnce(prompt);
    } catch (err) {
      if (i < retries) {
        console.log(`🔁 Retry OpenAI ${i + 1}`);
        await new Promise(r => setTimeout(r, 500));
        continue;
      }
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

    const prompt = `
Jesteś egzaminatorem do Karty Polaka. Oceń odpowiedź kandydata.

HISTORIA ROZMOWY (ostatnie 3 pytania):
${prevAnswers}

OBECNE PYTANIE: "${question}"
OBECNA ODPOWIEDŹ: "${answer}"

Oceń według kryteriów (0-10):
1. Poprawność merytoryczna (content)
2. Gramatyka i poprawność językowa (grammar)
3. Bogactwo słownictwa (vocabulary)
4. Płynność i spójność (fluency)
5. Kompletność (completeness)

Dodatkowo:
- Wypisz maksymalnie 2 mocne strony.
- Wypisz maksymalnie 2 słabe strony.
- Podaj poprawioną wersję (jeśli potrzeba).
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
  "feedback": "string"
}
`;

    try {
      const resp = await this.call(prompt);
      const evalResult = safeJSONParse(resp, null);
      if (!evalResult) throw new Error('Invalid JSON');
      const scores = evalResult.scores;
      const total = scores ? Object.values(scores).reduce((a,b)=>a+b,0)/5 : evalResult.totalScore;
      evalResult.totalScore = Math.min(10, Math.max(0, Math.round(total)));
      return evalResult;
    } catch (err) {
      console.error('Evaluation error:', err);
      if (fuzzyResult) return { totalScore: Math.min(fuzzyResult.score, 6), feedback: "Ocena automatyczna", strengths: [], weaknesses: [] };
      return { totalScore: 5, feedback: 'Dziękuję za odpowiedź.', strengths: [], weaknesses: [] };
    }
  }
}
const aiService = new AIService();

// =====================
// ДОПОМІЖНІ AI-ФУНКЦІЇ
// =====================
async function generateAIQuestion(topic, difficulty, userAvgScore) {
  const prompt = `
Jesteś konsulem. Wygeneruj jedno pytanie do rozmowy o Kartę Polaka.
Temat: ${topic}
Poziom trudności: ${difficulty}
Średni wynik użytkownika: ${userAvgScore}/10 (niższy = łatwiejsze pytanie)

Pytanie: język polski, konkretne, max 200 znaków.
Zwróć JSON:
{
  "question": "treść",
  "keywords": ["kluczowe słowo1", "słowo2"],
  "hint": "podpowiedź",
  "intro": "krótkie wprowadzenie"
}
`;
  try {
    const response = await aiService.call(prompt);
    const parsed = safeJSONParse(response, null);
    if (!parsed || !parsed.question) return null;
    if (parsed.question.length > 200) return null;
    if (!parsed.keywords || parsed.keywords.length === 0) parsed.keywords = [topic];
    return parsed;
  } catch (e) {
    console.log('AI generation failed', e);
    return null;
  }
}

async function generateFollowUpQuestion(originalQuestion, userAnswer, weaknesses) {
  const safeWeaknesses = (weaknesses || []).join(', ');
  const prompt = `
Użytkownik odpowiedział słabo na pytanie: "${originalQuestion}"
Jego odpowiedź: "${userAnswer}"
Słabe strony: ${safeWeaknesses}

Zadaj konkretne, prostsze pytanie uzupełniające.
Zwróć JSON: { "question": "...", "hint": "..." }
`;
  try {
    const resp = await aiService.call(prompt);
    return safeJSONParse(resp, null);
  } catch { return null; }
}

// =====================
// РОЗУМНИЙ ВИБІР НАСТУПНОГО ПИТАННЯ
// =====================
async function getNextQuestion(userId, session) {
  const weakTopics = getWeakTopics(userId);
  const avgScore = getAverageScore(userId);
  const askedQuestionIds = new Set(session.askedQuestions || []);

  let difficulty = 'medium';
  if (avgScore >= 8) difficulty = 'hard';
  else if (avgScore <= 5) difficulty = 'easy';

  let targetTopic = weakTopics[0] || null;
  if (!targetTopic) {
    const allTopics = [...new Set(questionBank.map(q => q.topic))];
    const askedTopics = session.askedTopics || [];
    const unused = allTopics.filter(t => !askedTopics.includes(t));
    targetTopic = unused.length ? unused[0] : allTopics[0];
  }

  let candidates = questionBank.filter(q =>
    q.topic === targetTopic &&
    q.difficulty === difficulty &&
    !askedQuestionIds.has(q.id)
  );
  if (candidates.length === 0) {
    candidates = questionBank.filter(q => q.topic === targetTopic && !askedQuestionIds.has(q.id));
  }
  if (candidates.length === 0) {
    candidates = questionBank.filter(q => !askedQuestionIds.has(q.id));
  }

  let selected = null;
  if (candidates.length === 0) {
    session.askedQuestions = [];
    selected = questionBank[Math.floor(Math.random() * questionBank.length)];
  } else {
    selected = candidates[Math.floor(Math.random() * candidates.length)];
  }

  const useAI = weakTopics.length > 0 && Math.random() < 0.3 && avgScore < 8;
  if (useAI && targetTopic) {
    const aiQuestion = await generateAIQuestion(targetTopic, difficulty, avgScore);
    if (aiQuestion && aiQuestion.question) {
      aiQuestion.id = `ai_${Date.now()}`;
      aiQuestion.topic = targetTopic;
      aiQuestion.difficulty = difficulty;
      aiQuestion.answerKeywords = aiQuestion.keywords || [targetTopic];
      aiQuestion.intro = aiQuestion.intro || "Pytanie od konsula:";
      return aiQuestion;
    }
  }
  return selected;
}

// =====================
// СЕРТИФІКАТИ
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
// КОНТРОЛЕР ІНТЕРВ'Ю
// =====================
class InterviewController {
  getSession(userId) {
    let user = usersDB.findOne(u => u.userId === userId);
    if (user && !user.session?.finished) return user.session;
    else return this.createSession(userId);
  }
  createSession(userId) {
    const session = {
      userId,
      step: "ask_name",
      answers: [],
      answersDetails: [],
      askedTopics: [],
      askedQuestions: [],
      questionIndex: 0,
      followUpCount: 0,
      finished: false
    };
    const existing = usersDB.findOne(u => u.userId === userId);
    if (existing) {
      usersDB.update(u => u.userId === userId, u => ({ ...u, session }));
    } else {
      usersDB.insert({ userId, session, createdAt: Date.now() });
    }
    return session;
  }
  async handleMessage(req, res) {
    const userId = req.user.userId;
    let { message } = req.body;
    let session = this.getSession(userId);
    if (session.finished) this.createSession(userId);
    session = this.getSession(userId);

    if (session.step === "ask_name") {
      session.step = "waiting_name";
      return res.json({ type: "question", question: "Dzień dobry. Proszę podać swoje imię." });
    }
    if (session.step === "waiting_name") {
      if (!message || message.trim().length < 2) return res.json({ type: "question", question: "Proszę podać poprawne imię." });
      session.name = message.trim();
      session.step = "ready";
      const first = questionBank[0];
      session.currentQuestion = first;
      session.askedQuestions.push(first.id);
      session.currentTopic = first.topic;
      session.askedTopics = session.askedTopics || [];
      session.askedTopics.push(first.topic);
      return res.json({ type: "question", intro: first.intro || "Proszę odpowiedzieć.", question: first.question, hint: first.hint, index: 1, total: CONFIG.QUESTIONS_PER_SESSION, progress: 0 });
    }
    if (session.step === "ready") {
  try {
    if (!message) {
      return res.json({ type: "error", message: "No answer" });
    }

    const evaluation = await aiService.evaluateAnswer(
      session.currentQuestion.question,
      message,
      userId,
      session
    );

    // FOLLOW-UP
    if (evaluation.totalScore < 5 && (session.followUpCount || 0) < 2) {
      session.followUpCount++;

      const followUp = await generateFollowUpQuestion(
        session.currentQuestion.question,
        message,
        evaluation.weaknesses
      );

      if (followUp && followUp.question) {
        session.currentQuestion = {
          id: `followup_${Date.now()}`,
          topic: session.currentTopic,
          question: followUp.question,
          hint: followUp.hint || "",
          intro: "Dopytam bardziej szczegółowo:",
          answerKeywords: []
        };

        return res.json({
          type: "question",
          intro: session.currentQuestion.intro,
          question: session.currentQuestion.question,
          hint: session.currentQuestion.hint,
          followUp: true
        });
      }
    }

    // ✅ ЗБЕРЕЖЕННЯ (ПЕРЕНЕСЕНО ВСЕРЕДИНУ try)
    const score = evaluation.totalScore || 5;

    session.answers.push(score);
    session.questionIndex++;
    session.progress = Math.round(
      (session.questionIndex / CONFIG.QUESTIONS_PER_SESSION) * 100
    );

    updateMemory(userId, session.currentTopic, score);

    // answersDetails
    if (!session.answersDetails) session.answersDetails = [];
    session.answersDetails.push({
      question: session.currentQuestion.question,
      answer: message,
      score,
      feedback: evaluation.feedback,
      strengths: evaluation.strengths,
      weaknesses: evaluation.weaknesses
    });
    if (session.answersDetails.length > 10) session.answersDetails.shift();

    // ✅ ЗАВЕРШЕННЯ
    if (session.questionIndex >= CONFIG.QUESTIONS_PER_SESSION) {
      const total = session.answers.reduce((a, b) => a + b, 0);
      const avg = total / session.answers.length;

      const final = {
        type: "final",
        level: avg >= 8 ? "bardzo dobry" : avg >= 6 ? "dobry" : "dostateczny",
        recommendation: avg >= 6 ? "ready" : "not_ready",
        averageScore: avg.toFixed(1),
        progress: 100
      };

      session.finished = true;

      return res.json(final);
    }

    // reset follow-up
    if (score >= 6) session.followUpCount = 0;

    // наступне питання
    const nextQ = await getNextQuestion(userId, session);

    session.currentQuestion = nextQ;
    session.currentTopic = nextQ.topic;
    session.askedQuestions.push(nextQ.id);

    return res.json({
      type: "next_question",
      evaluation: {
        score,
        feedback: evaluation.feedback || "OK"
      },
      nextQuestion: {
        question: nextQ.question,
        hint: nextQ.hint,
        intro: nextQ.intro
      },
      progress: session.progress
    });

  } catch (err) {
    console.error("🔥 CRITICAL ERROR:", err);

    // ❗ НІКОЛИ не даємо 502
    return res.json({
      type: "error",
      message: "Temporary issue, try again"
    });
  }
}

      // Збереження відповіді
      session.answers.push(evaluation.totalScore);
      session.questionIndex++;
      session.progress = Math.round((session.questionIndex / CONFIG.QUESTIONS_PER_SESSION) * 100);
      updateMemory(userId, session.currentTopic, evaluation.totalScore);

      if (!session.answersDetails) session.answersDetails = [];
      session.answersDetails.push({
        question: session.currentQuestion.question,
        answer: message,
        score: evaluation.totalScore,
        feedback: evaluation.feedback,
        strengths: evaluation.strengths,
        weaknesses: evaluation.weaknesses
      });
      if (session.answersDetails.length > 10) session.answersDetails.shift();

      // Перевірка завершення
      if (session.questionIndex >= CONFIG.QUESTIONS_PER_SESSION) {
        const total = session.answers.reduce((a,b)=>a+b,0);
        const avg = total / session.answers.length;
        const weak = getWeakTopics(userId);
        const final = { type: "final", level: avg>=8?"bardzo dobry":avg>=6?"dobry":"dostateczny", recommendation: avg>=6?"ready":"not_ready", averageScore: avg.toFixed(1), weakTopics: weak, progress: 100 };
        session.finished = true;
        resultsDB.insert({ userId, answers: session.answers, finalReport: final, createdAt: new Date().toISOString() });
        if (final.recommendation === "ready") {
          const cert = { verificationUrl: `${CONFIG.APP_URL}/api/certificate/verify?token=${generateToken(userId, avg, Date.now())}` };
          final.certificate = cert;
        }
        return res.json(final);
      }

      if (evaluation.totalScore >= 6) session.followUpCount = 0;

      const nextQ = await getNextQuestion(userId, session);
      session.currentQuestion = nextQ;
      session.currentTopic = nextQ.topic;
      session.askedQuestions.push(nextQ.id);
      if (!session.askedTopics.includes(nextQ.topic)) session.askedTopics.push(nextQ.topic);

      return res.json({
        type: "next_question",
        evaluation: {
          score: evaluation.totalScore,
          feedback: evaluation.feedback,
          strengths: evaluation.strengths?.slice(0,2),
          weaknesses: evaluation.weaknesses?.slice(0,2)
        },
        nextQuestion: {
          intro: nextQ.intro || "Proszę odpowiedzieć.",
          question: nextQ.question,
          hint: nextQ.hint,
          index: session.questionIndex + 1
        },
        progress: session.progress,
        current: session.questionIndex,
        total: CONFIG.QUESTIONS_PER_SESSION
      });
    }
    return res.json({ type: "error", message: "Unknown step" });
  }
}
const interviewController = new InterviewController();

// =====================
// АВТЕНТИФІКАЦІЯ ТА МАРШРУТИ
// =====================
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: "Access token required" });
  jwt.verify(token, CONFIG.JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  });
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, skipSuccessfulRequests: true });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

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
    usersDB.insert({ userId, email, password: hashed, name: name || email.split('@')[0], createdAt: Date.now() });
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

app.post('/chat', authenticateToken, chatLimiter, (req, res) => interviewController.handleMessage(req, res));
app.get("/health", (req, res) => res.json({ status: "healthy", version: "5.2" }));
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
  res.json({ users: usersDB.findAll().length, results: resultsDB.findAll().length });
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
