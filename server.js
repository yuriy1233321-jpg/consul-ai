import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import Fuse from "fuse.js";
import rateLimit from "express-rate-limit";
import helmet from 'helmet';
import { authenticateToken } from './security/auth.js';
import { validateChatInput, handleValidationErrors, validateLogin, validateRegister } from './security/validation.js';
import { authLimiter, chatLimiter } from './security/rateLimit.js';
import { loginUser, registerUser } from './security/auth.js';

const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));
const app = express();
const PORT = process.env.PORT || 3000;

const CONFIG = {
  API_KEY: process.env.OPENAI_API_KEY,
  QUESTIONS_PER_SESSION: 10,
  ADMIN_API_KEY: process.env.ADMIN_API_KEY || "admin123",
  CERT_SECRET: process.env.CERT_SECRET || crypto.randomBytes(32).toString("hex"),
  APP_URL: process.env.APP_URL || "http://localhost:3000",
};

if (!CONFIG.API_KEY) {
  console.error("❌ OPENAI_API_KEY required");
  process.exit(1);
}

function detectGender(name) {
  if (!name) return "male";
  const n = name.toLowerCase().trim();
  if (n.endsWith("a") && !["kuba", "barnaba"].includes(n)) return "female";
  return "male";
}
function getPolishForm(name) { return detectGender(name) === "female" ? "Pani" : "Pan"; }
function safeJSONParse(str, fallback = {}) {
  try { return JSON.parse(str); } catch { return fallback; }
}

class DataStore {
  constructor(file) { this.file = file; this.data = this.load(); }
  load() { try { return JSON.parse(fs.readFileSync(this.file, "utf8")); } catch { return []; } }
  save() { fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2)); }
  findAll() { return this.data; }
  findOne(pred) { return this.data.find(pred); }
  insert(item) { this.data.push(item); this.save(); return item; }
  update(pred, updater) { const idx = this.data.findIndex(pred); if (idx !== -1) { this.data[idx] = updater(this.data[idx]); this.save(); return true; } return false; }
}
const usersDB = new DataStore("users.json");
const resultsDB = new DataStore("results.json");

let questionBank = [];
try {
  if (fs.existsSync("questions.json")) {
    questionBank = JSON.parse(fs.readFileSync("questions.json", "utf8"));
    console.log(`✅ Loaded ${questionBank.length} questions`);
  } else {
    questionBank = [
      { id:"sym_001", topic:"polish symbols", difficulty:"easy", question:"Jakie są trzy polskie symbole narodowe?", answerKeywords:["orzeł","flaga","hymn"], hint:"Orzeł, flaga, hymn", intro:"Symbole narodowe" },
      { id:"his_001", topic:"polish history", difficulty:"easy", question:"Kto był pierwszym królem Polski?", answerKeywords:["bolesław chrobry","chrobry"], hint:"Bolesław Chrobry", intro:"Historia" },
      { id:"geo_001", topic:"polish geography", difficulty:"easy", question:"Jaka rzeka jest najdłuższa w Polsce?", answerKeywords:["wisła"], hint:"Wisła", intro:"Geografia" }
    ];
    fs.writeFileSync("questions.json", JSON.stringify(questionBank, null, 2));
  }
} catch(e) { console.error("Question bank error", e); }

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

class MemoryEngine {
  constructor() { this.file = "memory.json"; this.sessions = new Map(); this.load(); setInterval(() => this.save(), 60000); }
  load() { try { const d = JSON.parse(fs.readFileSync(this.file)); this.sessions = new Map(Object.entries(d)); } catch(e) {} }
  save() { fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.sessions), null, 2)); }
  get(userId) { if (!this.sessions.has(userId)) this.sessions.set(userId, { weakTopics: {}, lastScores: [], totalAnswers: 0 }); return this.sessions.get(userId); }
  addAnswer(userId, topic, score) {
    const mem = this.get(userId);
    mem.lastScores.push(score); if (mem.lastScores.length > 10) mem.lastScores.shift();
    if (score < 5) mem.weakTopics[topic] = (mem.weakTopics[topic] || 0) + 1;
    mem.totalAnswers++; this.save();
  }
  getWeakTopics(userId) { return Object.entries(this.get(userId).weakTopics).sort((a,b)=>b[1]-a[1]).map(([t])=>t); }
  getAverageScore(userId) {
    const scores = this.get(userId).lastScores;
    return scores.length ? scores.reduce((a,b)=>a+b,0)/scores.length : 5;
  }
}
const memoryEngine = new MemoryEngine();

class AIService {
  async call(prompt) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.API_KEY}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.2, response_format: { type: "json_object" } })
    });
    const data = await res.json();
    return data.choices[0].message.content;
  }
  async evaluateAnswer(question, answer) {
    const prompt = `Oceń odpowiedź do Karty Polaka. Pytanie: "${question}" Odpowiedź: "${answer}". Zwróć JSON: { "score":0-10, "feedback":"...", "corrected":"..." }`;
    try {
      const resp = await this.call(prompt);
      const evalResult = safeJSONParse(resp, { score: 5, feedback: "Dziękuję." });
      evalResult.score = Math.min(10, Math.max(0, evalResult.score));
      return evalResult;
    } catch { return { score: 5, feedback: "Dziękuję za odpowiedź." }; }
  }
}
const aiService = new AIService();

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

class InterviewController {
  getSession(userId) {
    let user = usersDB.findOne(u => u.userId === userId);
    if (user && !user.session?.finished) return user.session;
    else return this.createSession(userId);
  }
  createSession(userId) {
    const session = { userId, step: "ask_name", answers: [], askedTopics: [], questionIndex: 0, finished: false };
    usersDB.insert({ userId, session, createdAt: Date.now() });
    return session;
  }
  async handleMessage(req, res) {
    let { userId, message } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    let session = this.getSession(userId);
    if (session.finished) {
      usersDB.update(u => u.userId === userId, u => ({ ...u, session: this.createSession(userId) }));
      session = this.getSession(userId);
    }
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
      session.currentTopic = first.topic;
      session.askedTopics = session.askedTopics || [];
      session.askedTopics.push(first.topic);
      return res.json({ type: "question", intro: first.intro || "Proszę odpowiedzieć.", question: first.question, hint: first.hint, index: 1, total: CONFIG.QUESTIONS_PER_SESSION, progress: 0 });
    }
    if (session.step === "ready") {
      if (!message) return res.json({ type: "error", message: "No answer" });
      const evaluation = await aiService.evaluateAnswer(session.currentQuestion.question, message);
      session.answers.push(evaluation.score);
      session.questionIndex++;
      session.progress = Math.round((session.questionIndex / CONFIG.QUESTIONS_PER_SESSION) * 100);
      memoryEngine.addAnswer(userId, session.currentTopic, evaluation.score);
      if (session.questionIndex >= CONFIG.QUESTIONS_PER_SESSION) {
        const total = session.answers.reduce((a,b)=>a+b,0);
        const avg = total / session.answers.length;
        const weak = memoryEngine.getWeakTopics(userId);
        const final = { type: "final", level: avg>=8?"bardzo dobry":avg>=6?"dobry":"dostateczny", recommendation: avg>=6?"ready":"not_ready", averageScore: avg.toFixed(1), weakTopics: weak, progress: 100 };
        session.finished = true;
        resultsDB.insert({ userId, sessionId: session.id, answers: session.answers, finalReport: final, createdAt: new Date().toISOString() });
        if (final.recommendation === "ready") {
          const cert = { verificationUrl: `${CONFIG.APP_URL}/api/certificate/verify?token=${generateToken(userId, avg, Date.now())}` };
          final.certificate = cert;
        }
        return res.json(final);
      }
      const nextIdx = session.askedTopics.length % questionBank.length;
      const nextQ = questionBank[nextIdx];
      session.currentQuestion = nextQ;
      session.currentTopic = nextQ.topic;
      session.askedTopics.push(nextQ.topic);
      return res.json({ type: "next_question", evaluation: { score: evaluation.score, feedback: evaluation.feedback }, nextQuestion: { intro: nextQ.intro || "Proszę odpowiedzieć.", question: nextQ.question, hint: nextQ.hint, index: session.questionIndex+1 }, progress: session.progress, current: session.questionIndex, total: CONFIG.QUESTIONS_PER_SESSION });
    }
    return res.json({ type: "error", message: "Unknown step" });
  }
}
const interviewController = new InterviewController();

const adminLimiter = rateLimit({ windowMs: 15*60*1000, max: 100 });
app.use("/api/admin", adminLimiter);
app.use("/api/admin", (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (key !== CONFIG.ADMIN_API_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
});
app.get("/api/admin/stats", (req, res) => res.json({ users: usersDB.findAll().length, results: resultsDB.findAll().length }));

app.use(cors());
app.use(express.json());
app.post("/chat", (req, res) => interviewController.handleMessage(req, res));
app.get("/health", (req, res) => res.json({ status: "healthy", version: "5.2" }));
app.get("/api/certificate/verify", (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Missing token" });
  const data = verifyToken(token);
  if (!data) return res.status(400).json({ error: "Invalid certificate" });
  res.json({ valid: true, userId: data.userId, score: data.score, issuedAt: new Date(data.date).toISOString() });
});

app.use(express.static("client/dist"));
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return;
  res.sendFile(path.resolve("client/dist/index.html"));
});

app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
