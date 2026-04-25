import { useState } from "react";
import axios from "axios";

export default function App() {
  const [msg, setMsg] = useState("");
  const [reply, setReply] = useState("");

  const send = async () => {
    const res = await axios.post("/chat", { message: msg });
    setReply(res.data.reply);
  };

  return (
    <div style={{ padding: 20 }}>
      <h1>Consul AI</h1>
      <input value={msg} onChange={(e) => setMsg(e.target.value)} />
      <button onClick={send}>Send</button>
      <p>{reply}</p>
    </div>
  );
}
