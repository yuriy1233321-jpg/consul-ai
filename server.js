
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import crypto from "crypto";

import { authenticateToken, registerUser, loginUser } from "./security/auth.js";
import { validateChatInput, handleValidationErrors, validateRegister, validateLogin } from "./security/validation.js";
import { authLimiter, chatLimiter } from "./security/rateLimit.js";

const app = express();
const PORT = process.env.PORT || 3000;

// =====================
// 🔐 ENV CHECK
// =====================
const REQUIRED_ENV = ["OPENAI_API_KEY", "JWT_SECRET", "ADMIN_API_KEY", "CERT_SECRET"];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`❌ Missing ENV: ${key}`);
    process.exit(1);
  }
}

// =====================
// 🔧 CONFIG
// =====================
const CONFIG = {
  API_KEY: process.env.OPENAI_API_KEY,
  CERT_SECRET: process.env.CERT_SECRET,
  APP_URL: process.env.APP_URL || "http://localhost:3000",
};

// =====================
// 🔐 MIDDLEWARE
// =====================
app.use(cors());
app.use(express.json());

// =====================
// 💾 SIMPLE STORAGE
// =====================
const users = new Map();
const sessions = new Map();

// =====================
// 🤖 MOCK AI (поки що)
// =====================
function evaluate(answer) {
  return {
    score: Math.floor(Math.random() * 5) + 5,
    feedback: "Dobrze"
  };
}

// =====================
// 🔐 AUTH ROUTES
// =====================
app.post("/api/register", authLimiter, validateRegister, handleValidationErrors, (req, res) => {
  try {
    const { email, password, name } = req.body;
    const user = registerUser(email, password, name);
    res.json(user);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/api/login", authLimiter, validateLogin, handleValidationErrors, (req, res) => {
  try {
    const { email, password } = req.body;
    const result = loginUser(email, password);
    res.json(result);
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

// =====================
// 💬 CHAT
// =====================
app.post("/chat", authenticateToken, chatLimiter, validateChatInput, handleValidationErrors, (req, res) => {
  const userId = req.user.userId;
  const { message } = req.body;

  if (!sessions.has(userId)) {
    sessions.set(userId, { step: "start" });
  }

  const session = sessions.get(userId);

  if (session.step === "start") {
    session.step = "question";
    return res.json({
      type: "question",
      question: "Jak masz na imię?"
    });
  }

  if (session.step === "question") {
    session.step = "answer";
    return res.json({
      type: "next_question",
      evaluation: evaluate(message),
      nextQuestion: {
        question: "Jakie są symbole Polski?"
      }
    });
  }

  return res.json({
    type: "final",
    averageScore: 7
  });
});

// =====================
// 📜 CERT VERIFY
// =====================
app.get("/api/certificate/verify", (req, res) => {
  res.json({ valid: true });
});

// =====================
// ❤️ HEALTH
// =====================
app.get("/health", (req, res) => {
  res.json({ status: "ok", version: "5.2" });
});

// =====================
// 🌐 FRONTEND
// =====================
app.use(express.static("client/dist"));

app.get("*", (req, res) => {
  if (!req.path.startsWith("/api") && req.path !== "/chat") {
    res.sendFile(path.resolve("client/dist/index.html"));
  }
});

// =====================
// 🚀 START
// =====================
app.listen(PORT, () => {
  console.log(`🚀 Server running on ${PORT}`);
});
