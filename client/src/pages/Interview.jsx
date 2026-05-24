import { useState } from "react";
import { useNavigate } from "react-router-dom";

function Interview() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [language, setLanguage] = useState(localStorage.getItem("language") || null);
  const [mode, setMode] = useState(null);
  const [started, setStarted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [limitMessage, setLimitMessage] = useState("");
  const [remaining, setRemaining] = useState(5);
  const navigate = useNavigate();

  function text(ua, pl, ru) {
    if (language === "polski") return pl;
    if (language === "русский") return ru;
    return ua;
  }

  async function sendToAI(textInput, selectedLanguage = language, selectedMode = mode) {
    let deviceId = localStorage.getItem("deviceId");
    if (!deviceId) {
      deviceId = crypto.randomUUID();
      localStorage.setItem("deviceId", deviceId);
    }

    try {
      const response = await fetch("http://localhost:3000/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-id": deviceId,
        },
        body: JSON.stringify({
          message: textInput,
          language: selectedLanguage,
          mode: selectedMode,
          history: messages,
        }),
      });

      const data = await response.json();

      if (response.status === 403) {
        setBlocked(true);
        setLimitMessage(data.message);
        return;
      }

      setBlocked(false);
      setRemaining(data.remaining ?? 5);

      setMessages((prev) => [
        ...prev,
        { role: "user", content: textInput },
        { role: "assistant", content: data.answer },
      ]);
    } catch (err) {
      console.error(err);
      alert(text("Немає з'єднання", "Brak połączenia", "Нет соединения"));
    }
  }

  function chooseLanguage(lang) {
    localStorage.setItem("language", lang);
    setLanguage(lang);
    setMessages([]);
    setMode(null);
    setStarted(false);
    setBlocked(false);
    setLimitMessage("");
    setRemaining(5);
  }

  async function chooseMode(selectedMode) {
    setStarted(true);
    setMode(selectedMode);

    const currentLanguage = localStorage.getItem("language") || language;
    const firstMessage =
      selectedMode === "interview"
        ? text("Почати пробну співбесіду", "Rozpocznij rozmowę próbną", "Начать пробное интервью")
        : text("Почати навчання", "Rozpocznij naukę", "Начать обучение");

    await sendToAI(firstMessage, currentLanguage, selectedMode);
  }

  async function sendMessage() {
    if (!input.trim()) return;
    await sendToAI(input);
    setInput("");
  }

  const maxMessages = mode === "study" ? 20 : 10;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#f5f7fb",
        padding: "40px 20px",
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      }}
    >
      <div
        style={{
          maxWidth: "950px",
          margin: "0 auto",
          background: "white",
          padding: "32px 36px",
          borderRadius: "28px",
          boxShadow: "0 12px 48px rgba(0,0,0,0.08)",
        }}
      >
        {/* Хедер з лічильником */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "36px",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div>
            <h1 style={{ fontSize: "44px", margin: 0, fontWeight: "800", letterSpacing: "-0.5px" }}>
              CONSUL.AI
            </h1>
            <p style={{ color: "#5a6a7a", marginTop: "8px", fontSize: "15px" }}>
              {text("AI підготовка до Карти Поляка", "AI przygotowanie do Karty Polaka", "AI подготовка к Карте Поляка")}
            </p>
          </div>

          <div
            style={{
              background: "#fff0f0",
              padding: "10px 20px",
              borderRadius: "40px",
              fontWeight: "700",
              color: "#c1272d",
              fontSize: "15px",
              boxShadow: "inset 0 0 0 1px rgba(193,39,45,0.2)",
            }}
          >
            {text(`Залишилось: ${remaining}/${maxMessages}`, `Pozostało: ${remaining}/${maxMessages}`, `Осталось: ${remaining}/${maxMessages}`)}
          </div>
        </div>

        {/* Вибір мови */}
        {!language && (
          <div style={{ display: "flex", gap: "12px", marginBottom: "32px", flexWrap: "wrap" }}>
            <button onClick={() => chooseLanguage("українська")} style={buttonStyle}>
              🇺🇦 Українська
            </button>
            <button onClick={() => chooseLanguage("polski")} style={buttonStyle}>
              🇵🇱 Polski
            </button>
            <button onClick={() => chooseLanguage("русский")} style={buttonStyle}>
              🇷🇺 Русский
            </button>
          </div>
        )}

        {/* Вибір режиму */}
        {language && !started && (
          <div style={{ display: "flex", gap: "16px", marginBottom: "32px", flexWrap: "wrap" }}>
            <button onClick={() => chooseMode("study")} style={{ ...buttonStyle, background: "#f0f2f5" }}>
              📚 {text("Навчання", "Nauka", "Обучение")}
            </button>
            <button onClick={() => chooseMode("interview")} style={{ ...buttonStyle, background: "#f0f2f5" }}>
              🎭 {text("Пробна співбесіда", "Próbna rozmowa", "Пробное интервью")}
            </button>
          </div>
        )}

        {/* Чат у вигляді бульбашок */}
        {started && (
          <>
            <div
              style={{
                maxHeight: "520px",
                overflowY: "auto",
                marginBottom: "24px",
                paddingRight: "8px",
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              {messages.map((msg, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "flex",
                    justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                  }}
                >
                  <div
                    style={{
                      maxWidth: "78%",
                      padding: "12px 18px",
                      borderRadius: "24px",
                      background: msg.role === "user" ? "#d62828" : "#eef2f5",
                      color: msg.role === "user" ? "#ffffff" : "#1e2a36",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.03)",
                      lineHeight: "1.5",
                      fontSize: "15px",
                      fontWeight: 400,
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: 500,
                        opacity: msg.role === "user" ? 0.8 : 0.65,
                        marginBottom: "6px",
                        letterSpacing: "0.3px",
                      }}
                    >
                      {msg.role === "user" ? text("Ви", "Ty", "Вы") : "CONSUL"}
                    </div>
                    <div style={{ wordBreak: "break-word" }}>{msg.content}</div>
                  </div>
                </div>
              ))}
              {blocked && (
                <div
                  style={{
                    background: "#fff2f0",
                    padding: "14px",
                    borderRadius: "20px",
                    color: "#c1272d",
                    textAlign: "center",
                    fontWeight: 500,
                  }}
                >
                  🚫 {limitMessage}
                </div>
              )}
            </div>

            {/* Інпут + кнопка */}
            <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                disabled={blocked}
                placeholder={text("Напишіть відповідь...", "Napisz odpowiedź...", "Напишите ответ...")}
                style={{
                  flex: 1,
                  padding: "14px 20px",
                  border: "1px solid #dfe4e9",
                  borderRadius: "40px",
                  fontSize: "16px",
                  outline: "none",
                  transition: "all 0.2s",
                  fontFamily: "inherit",
                  background: "#fff",
                  color: "#1a2a3a",
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = "#d62828";
                  e.target.style.boxShadow = "0 0 0 3px rgba(214,40,40,0.1)";
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = "#dfe4e9";
                  e.target.style.boxShadow = "none";
                }}
              />
              <button
                onClick={sendMessage}
                disabled={blocked}
                style={{
                  background: blocked ? "#c0c8d0" : "#d62828",
                  color: "white",
                  border: "none",
                  borderRadius: "40px",
                  height: "52px",
                  minWidth: "130px",
                  fontSize: "16px",
                  fontWeight: "600",
                  cursor: blocked ? "not-allowed" : "pointer",
                  transition: "0.2s",
                  fontFamily: "inherit",
                  boxShadow: blocked ? "none" : "0 2px 8px rgba(214,40,40,0.3)",
                }}
                onMouseEnter={(e) => !blocked && (e.target.style.background = "#b11e1e")}
                onMouseLeave={(e) => !blocked && (e.target.style.background = "#d62828")}
              >
                {text("Надіслати", "Wyślij", "Отправить")}
              </button>
            </div>
          </>
        )}

        {/* Додаткові кнопки внизу */}
        <div style={{ display: "flex", gap: "12px", marginTop: "32px", justifyContent: "flex-end" }}>
          <button
            onClick={() => {
              localStorage.removeItem("language");
              setLanguage(null);
              setStarted(false);
              setMode(null);
              setMessages([]);
            }}
            style={smallButtonStyle}
          >
            🌐 {text("Змінити мову", "Zmień język", "Изменить язык")}
          </button>
          <button onClick={() => navigate("/dashboard")} style={smallButtonStyle}>
            📊 {text("Прогрес", "Postęp", "Прогресс")}
          </button>
        </div>
      </div>
    </div>
  );
}

const buttonStyle = {
  background: "white",
  border: "1px solid #dce2e8",
  borderRadius: "60px",
  padding: "12px 28px",
  fontSize: "15px",
  fontWeight: "500",
  cursor: "pointer",
  transition: "0.2s",
  fontFamily: "inherit",
  color: "#1f2a3e",
  boxShadow: "0 1px 2px rgba(0,0,0,0.02)",
};

const smallButtonStyle = {
  background: "transparent",
  border: "none",
  color: "#6c7a8e",
  fontSize: "14px",
  cursor: "pointer",
  padding: "8px 14px",
  borderRadius: "30px",
  transition: "0.2s",
  fontWeight: 500,
};

export default Interview;