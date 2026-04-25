
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
app.use(express.static("client/dist"));

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
  try { return JSON.parse(str); } catch { return fallback; }
}

// =====================
// ФАЙЛОВІ СХОВИЩА
// =====================
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
// ПАМ'ЯТЬ
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
  if (score < 5) mem.weakTopics[topic] = (mem.weakTopics[topic] || 0) + 1;
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
// AI СЕРВІС
// =====================
class AIService {
  async call(prompt) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CONFIG.API_KEY}` },
      body: JSON.stringify({ model: "gpt-4o-mini", messages: [{ role: "user", content: prompt }], temperature: 0.2 })
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
// =====================
// 🧠 HYBRID QUESTION ENGINE
// =====================
async function getNextQuestion(userId, session) {
  const weakTopics = getWeakTopics(userId);
  const avgScore = getAverageScore(userId);

  const useAI = Math.random() < 0.5;
  const preferredTopic = weakTopics[0] || null;

  // 🤖 AI
  if (useAI) {
    try {
      const difficulty =
        avgScore > 8 ? "hard" :
        avgScore > 6 ? "medium" : "easy";

      const prompt = `Return ONLY valid JSON`;

{
  "question": "...",
  "keywords": ["...", "..."],
  "hint": "...",
  "intro": "..."
}

Topic: ${preferredTopic || "general"}
Difficulty: ${difficulty}
`;

      const response = await aiService.call(prompt);
      const data = safeJSONParse(response, null);

      if (data && data.question) {
        return {
          id: `ai_${Date.now()}`,
          topic: preferredTopic || "ai",
          difficulty,
          question: data.question,
          answerKeywords: data.keywords || [],
          hint: data.hint || "",
          intro: data.intro || "Pytanie AI"
        };
      }
    } catch (e) {
      console.log("AI error → fallback static");
    }
  }

  // 📦 STATIC
  // ❌ виключаємо вже використані теми
const used = session.askedQuestions || [];
const unused = questionBank.filter(q => !used.includes(q.id));

// якщо всі теми вже були — ресет
const pool = unused.length > 0 ? unused : questionBank;

// якщо є слабка тема — пріоритет
const filtered = preferredTopic
  ? pool.filter(q => q.topic === preferredTopic)
  : pool;

// якщо після фільтра нічого — беремо pool
const finalPool = filtered.length > 0 ? filtered : pool;
if (finalPool.length === 0) {
  return questionBank[Math.floor(Math.random() * questionBank.length)];
}
// випадкове питання
return finalPool[Math.floor(Math.random() * finalPool.length)];
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
  askedTopics: [],
  askedQuestions: [], // 👈 ДОДАВ
  questionIndex: 0,
  finished: false
};
    usersDB.update(u => u.userId === userId, u => ({ ...u, session })) || usersDB.insert({ userId, session, createdAt: Date.now() });
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
      if (!message) return res.json({ type: "error", message: "No answer" });
      const evaluation = await aiService.evaluateAnswer(session.currentQuestion.question, message);
      session.answers.push(evaluation.score);
      session.questionIndex++;
      session.progress = Math.round((session.questionIndex / CONFIG.QUESTIONS_PER_SESSION) * 100);
      updateMemory(userId, session.currentTopic, evaluation.score);
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
      const nextQ = await getNextQuestion(userId, session);

session.currentQuestion = nextQ;
session.currentTopic = nextQ.topic;

// ✅ контроль унікальності
session.askedQuestions.push(nextQ.id);

// ✅ контроль тем
if (!session.askedTopics.includes(nextQ.topic)) {
  session.askedTopics.push(nextQ.topic);
}
      return res.json({ type: "next_question", evaluation: { score: evaluation.score, feedback: evaluation.feedback }, nextQuestion: { intro: nextQ.intro || "Proszę odpowiedzieć.", question: nextQ.question, hint: nextQ.hint, index: session.questionIndex+1 }, progress: session.progress, current: session.questionIndex, total: CONFIG.QUESTIONS_PER_SESSION });
    }
    return res.json({ type: "error", message: "Unknown step" });
  }
}
const interviewController = new InterviewController();

// =====================
// АВТЕНТИФІКАЦІЯ
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
    usersDB.insert({ id: userId, email, password: hashed, name: name || email.split('@')[0], createdAt: Date.now() });
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
    const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, CONFIG.JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
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

// Адмінка (захист через API-ключ)
app.use("/api/admin", (req, res, next) => {
  const key = req.headers["x-api-key"];
  if (key !== CONFIG.ADMIN_API_KEY) return res.status(401).json({ error: "Unauthorized" });
  next();
});

app.get("/api/admin/stats", (req, res) => {
  res.json({
    users: usersDB.findAll().length,
    results: resultsDB.findAll().length
  });
});

// =====================
// 🌐 FRONTEND (FIXED)
// =====================
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "client/dist")));

app.get("*", (req, res) => {
  if (!req.path.startsWith("/api")) {
    const filePath = path.join(__dirname, "client/dist/index.html");

    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.send("Frontend not built");
    }
  }
});
console.log("STARTING SERVER...");

app.listen(PORT, () => {
  console.log("🚀 Server running on port " + PORT);
});
