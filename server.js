
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 3000;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// middleware
app.use(cors());
app.use(express.json());

// тест
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

// тест чат
app.post("/chat", (req, res) => {
  const { message } = req.body;
  res.json({
    reply: `You said: ${message}`,
  });
});

// статика (frontend)
const distPath = path.resolve(__dirname, "client/dist");

app.use(express.static(distPath));

app.get("*", (req, res) => {
  res.sendFile(path.join(distPath, "index.html"));
});

// запуск
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
