import express from "express";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({ message: "CONSUL AI працює 🚀" });
});

app.post("/chat", (req, res) => {
  const { message } = req.body;

  res.json({
    reply: "Отримано: " + message,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
