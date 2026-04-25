
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import { body, validationResult } from "express-validator";
import crypto from "crypto";
import Fuse from "fuse.js";
import QRCode from "qrcode";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import pg from "pg";
import Redis from "ioredis";
import winston from "winston";
import * as Sentry from "@sentry/node";

const fetch = (...args) => import("node-fetch").then(({ default: fetch }) => fetch(...args));

// =====================
// КОНФІГУРАЦІЯ
// =====================
const {
  DATABASE_URL,
  REDIS_URL,
  AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY,
  AWS_REGION,
  AWS_CERTIFICATE_BUCKET,
  JWT_SECRET,
  OPENAI_API_KEY,
  ADMIN_API_KEY,
  CERT_SECRET,
  APP_URL,
  SENTRY_DSN,
  NODE_ENV = "production",
  PORT = 3000,
} = process.env;

// Перевірка критичних змінних
if (!DATABASE_URL) throw new Error("DATABASE_URL required");
if (!REDIS_URL) throw new Error("REDIS_URL required");
if (!JWT_SECRET) throw new Error("JWT_SECRET required");
if (!OPENAI_API_KEY) throw new Error("OPENAI_API_KEY required");

// Ініціалізація логера
const logger = winston.createLogger({
  level: NODE_ENV === "production" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});

// Sentry (додаткова діагностика)
if (SENTRY_DSN) {
  Sentry.init({ dsn: SENTRY_DSN, environment: NODE_ENV });
}

const app = express();

// =====================
// БАЗА ДАНИХ (POSTGRESQL)
// =====================
const pool = new pg.Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.on("error", (err) => logger.error("Unexpected PG error", err));

// Redis
const redis = new Redis(REDIS_URL);
redis.on("error", (err) => logger.error("Redis error", err));

// S3 для сертифікатів
const s3 = new S3Client({ region: AWS_REGION, credentials: { accessKeyId: AWS_ACCESS_KEY_ID, secretAccessKey: AWS_SECRET_ACCESS_KEY } });

// =====================
// MIDDLEWARE
// =====================
app.use(helmet());
app.use(cors({ origin: APP_URL, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(express.static("client/dist"));

// Ініціалізація таблиць (якщо ще не створені)
async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT,
      plan TEXT DEFAULT 'free',
      subscription_status TEXT DEFAULT 'active',
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS user_sessions (
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      step TEXT,
      answers JSONB,
      asked_topics JSONB,
      question_index INTEGER DEFAULT 0,
      progress INTEGER DEFAULT 0,
      finished BOOLEAN DEFAULT FALSE,
      current_question JSONB,
      current_topic TEXT,
      started_at TIMESTAMP,
      updated_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY,
      user_id TEXT REFERENCES users(id),
      final_report JSONB,
      answers JSONB,
      created_at TIMESTAMP DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS memory (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      weak_topics JSONB,
      last_scores JSONB,
      grammar_issues JSONB,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `);
  logger.info("Database tables ready");
}
await initDatabase();

// Допоміжні функції для роботи з БД
async function getUserById(id) {
  const res = await pool.query("SELECT * FROM users WHERE id = $1", [id]);
  return res.rows[0];
}
async function getUserByEmail(email) {
  const res = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
  return res.rows[0];
}
async function createUser(id, email, hashedPassword, name) {
  await pool.query(
    "INSERT INTO users (id, email, password, name) VALUES ($1, $2, $3, $4)",
    [id, email, hashedPassword, name]
  );
  // Ініціалізуємо порожню сесію і пам'ять
  await pool.query("INSERT INTO user_sessions (user_id) VALUES ($1)", [id]);
  await pool.query("INSERT INTO memory (user_id, weak_topics, last_scores, grammar_issues) VALUES ($1, '{}'::JSONB, '[]'::JSONB, '[]'::JSONB)", [id]);
}
async function updateUserSubscription(userId, data) {
  await pool.query(
    "UPDATE users SET plan = $1, subscription_status = $2, stripe_customer_id = $3, stripe_subscription_id = $4, updated_at = NOW() WHERE id = $5",
    [data.plan, data.status, data.stripeCustomerId, data.stripeSubscriptionId, userId]
  );
}

// =====================
// JWT AUTH
// =====================
function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Access token required" });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Invalid or expired token" });
    req.user = user;
    next();
  });
}

// =====================
// ОБМЕЖЕННЯ (RATE LIMIT)
// =====================
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, skipSuccessfulRequests: true, keyGenerator: (req) => req.ip });
const chatLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, keyGenerator: (req) => req.user?.userId || req.ip });
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });

// =====================
// ФУНКЦІЇ ДЛЯ СТАНУ СЕСІЇ В POSTGRES + КЕШ REDIS
// =====================
async function getSession(userId) {
  const cached = await redis.get(`session:${userId}`);
  if (cached) return JSON.parse(cached);
  const res = await pool.query("SELECT * FROM user_sessions WHERE user_id = $1", [userId]);
  const session = res.rows[0] || null;
  if (session) await redis.setex(`session:${userId}`, 3600, JSON.stringify(session));
  return session;
}
async function updateSession(userId, data) {
  const session = await getSession(userId);
  const updated = { ...session, ...data, updated_at: new Date() };
  await pool.query(
    `UPDATE user_sessions SET step = $1, answers = $2, asked_topics = $3, question_index = $4, progress = $5, finished = $6, current_question = $7, current_topic = $8, started_at = $9, updated_at = NOW() WHERE user_id = $10`,
    [
      updated.step, JSON.stringify(updated.answers || []), JSON.stringify(updated.asked_topics || []),
      updated.question_index, updated.progress, updated.finished,
      JSON.stringify(updated.current_question), updated.current_topic,
      updated.started_at, userId
    ]
  );
  await redis.setex(`session:${userId}`, 3600, JSON.stringify(updated));
  return updated;
}
// Аналогічно для memory
async function getMemory(userId) {
  const cached = await redis.get(`memory:${userId}`);
  if (cached) return JSON.parse(cached);
  const res = await pool.query("SELECT * FROM memory WHERE user_id = $1", [userId]);
  const mem = res.rows[0] || { weak_topics: {}, last_scores: [], grammar_issues: [] };
  await redis.setex(`memory:${userId}`, 3600, JSON.stringify(mem));
  return mem;
}
async function updateMemory(userId, data) {
  await pool.query(
    "UPDATE memory SET weak_topics = $1, last_scores = $2, grammar_issues = $3, updated_at = NOW() WHERE user_id = $4",
    [JSON.stringify(data.weak_topics), JSON.stringify(data.last_scores), JSON.stringify(data.grammar_issues), userId]
  );
  await redis.setex(`memory:${userId}`, 3600, JSON.stringify(data));
}

// =====================
// ЛОГІКА СУБСКРИПЦІЙ З REDIS (ATOMIC DAILY LIMIT)
// =====================
async function canAskQuestion(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const key = `daily:${userId}:${today}`;
  const used = await redis.incr(key);
  if (used === 1) await redis.expire(key, 86400);
  // Отримуємо план користувача з БД (можна кешувати)
  const user = await getUserById(userId);
  const limit = user?.plan === "free" ? 3 : Infinity;
  return used <= limit;
}

// =====================
// ОСНОВНІ КЛАСИ (Core AI – практично не змінені)
// =====================
// (Тут код FuzzyScorer, AIService, InterviewController тощо – беріть з попередньої версії,
//  але замість локальних сховищ використовуйте БД через виклики вище)
// Через обмеження довжини я покажу лише скелет. Реальний код можна взяти з v5.2,
//  замінивши `usersDB`, `memoryEngine`, `resultsDB` на виклики до PostgreSQL/Redis.
class FuzzyScorer { /* як було */ }
class AIService {
  async evaluateAnswer(question, answer) { /* як було, але з OpenAI */ }
}
const aiService = new AIService();
class InterviewController {
  async handleMessage(req, res) {
    const userId = req.user.userId;
    let session = await getSession(userId);
    if (!session) {
      session = { step: "ask_name", answers: [], asked_topics: [], question_index: 0, progress: 0, finished: false };
      await updateSession(userId, session);
    }
    // ... логіка як у v5.2, але всі оновлення пишуться через updateSession та updateMemory
    // Важливо: після фіналу зберігаємо результат у таблицю "results"
  }
}
const interviewController = new InterviewController();

// =====================
// API МАРШРУТИ
// =====================
app.post("/api/register",
  authLimiter,
  body("email").isEmail().normalizeEmail(),
  body("password").isLength({ min: 6 }),
  body("name").optional().isString().trim(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });
    const { email, password, name } = req.body;
    const existing = await getUserByEmail(email);
    if (existing) return res.status(400).json({ error: "User already exists" });
    const hashed = await bcrypt.hash(password, 10);
    const id = `user_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
    await createUser(id, email, hashed, name || email.split("@")[0]);
    res.status(201).json({ message: "User created", userId: id });
  }
);

app.post("/api/login",
  authLimiter,
  body("email").isEmail(),
  body("password").notEmpty(),
  async (req, res) => {
    const { email, password } = req.body;
    const user = await getUserByEmail(email);
    if (!user || !(await bcrypt.compare(password, user.password)))
      return res.status(401).json({ error: "Invalid credentials" });
    const token = jwt.sign({ userId: user.id, email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "30d" });
    res.json({ token, user: { id: user.id, email: user.email, name: user.name } });
  }
);

app.post("/chat", authenticateToken, chatLimiter, async (req, res) => {
  // Перевірка ліміту питань
  const canAsk = await canAskQuestion(req.user.userId);
  if (!canAsk) return res.json({ type: "limit_reached", message: "Osiągnięto limit darmowych pytań. Wykup PRO!", upgradeUrl: "/pricing" });
  return interviewController.handleMessage(req, res);
});

app.get("/health", (req, res) => res.json({ status: "healthy", version: "5.2", uptime: process.uptime() }));
app.get("/api/admin/stats", adminLimiter, (req, res) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== ADMIN_API_KEY) return res.status(401).json({ error: "Unauthorized" });
  // Тут статистика з БД
  res.json({ message: "Admin stats – implement with DB queries" });
});

app.get("/api/certificate/verify", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Missing token" });
  const data = verifyCertificateToken(token);
  if (!data) return res.status(400).json({ error: "Invalid certificate" });
  // Генеруємо завантажувальне посилання з S3
  const url = await getSignedUrl(s3, new GetObjectCommand({ Bucket: AWS_CERTIFICATE_BUCKET, Key: `${data.userId}.pdf` }), { expiresIn: 3600 });
  res.json({ valid: true, userId: data.userId, score: data.score, issuedAt: new Date(data.date).toISOString(), downloadUrl: url });
});

// Catch-all для SPA
app.get("*", (req, res) => {
  if (req.path.startsWith("/api")) return;
  res.sendFile(path.resolve("client/dist/index.html"));
});

// =====================
// ЗАВЕРШЕННЯ
// =====================
const server = app.listen(PORT, () => logger.info(`🚀 Server running on port ${PORT}`));

process.on("SIGTERM", async () => {
  logger.info("SIGTERM received, closing connections...");
  await pool.end();
  await redis.quit();
  server.close(() => process.exit(0));
});
