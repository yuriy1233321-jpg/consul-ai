
import { useState, useEffect } from 'react';
import { login, register, sendMessage } from './services/api';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    if (token) startInterview();
  }, [token]);

  const startInterview = async () => {
    const res = await sendMessage('start');
    setMessages([{ role: 'ai', text: res.data.question }]);
  };

  const handleLogin = async () => {
    const res = await login(email, password);
    localStorage.setItem('token', res.data.token);
    setToken(res.data.token);
  };

  const handleRegister = async () => {
    await register(email, password, email);
    alert('Registered, now login');
  };

  const send = async () => {
    const userMsg = input;
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');

    const res = await sendMessage(userMsg);

    let text = '';

    if (res.data.type === 'question') {
      text = res.data.question;
    } else if (res.data.type === 'next_question') {
      text = `${res.data.evaluation.score}/10\n${res.data.nextQuestion.question}`;
    } else if (res.data.type === 'final') {
      text = `RESULT: ${res.data.averageScore}`;
    } else {
      text = JSON.stringify(res.data);
    }

    setMessages(prev => [...prev, { role: 'ai', text }]);
  };

  if (!token) {
    return (
      <div style={{ padding: 40 }}>
        <h2>CONSUL AI</h2>
        <input placeholder="email" onChange={e => setEmail(e.target.value)} /><br />
        <input type="password" placeholder="password" onChange={e => setPassword(e.target.value)} /><br />
        <button onClick={handleLogin}>Login</button>
        <button onClick={handleRegister}>Register</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 40 }}>
      <h2>Chat</h2>
      <div>
        {messages.map((m, i) => (
          <div key={i}>
            <b>{m.role}:</b> {m.text}
          </div>
        ))}
      </div>

      <input value={input} onChange={e => setInput(e.target.value)} />
      <button onClick={send}>Send</button>
    </div>
  );
}

export default App;
