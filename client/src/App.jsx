import { useState } from 'react';
import { login, register, sendMessage } from './services/api';

function App() {
  const [token, setToken] = useState(localStorage.getItem('token'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');

  const handleLogin = async () => {
    const res = await login(email, password);
    localStorage.setItem('token', res.data.token);
    setToken(res.data.token);
  };

  const handleRegister = async () => {
    await register(email, password, email);
    alert('Registered! Now login');
  };

  const send = async () => {
    const res = await sendMessage(input);
    setMessages([...messages, { q: input, a: JSON.stringify(res.data) }]);
    setInput('');
  };

  if (!token) {
    return (
      <div style={{ padding: 20 }}>
        <h2>Login</h2>
        <input placeholder="email" onChange={e => setEmail(e.target.value)} />
        <input placeholder="password" type="password" onChange={e => setPassword(e.target.value)} />
        <button onClick={handleLogin}>Login</button>
        <button onClick={handleRegister}>Register</button>
      </div>
    );
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>CONSUL AI</h2>
      <div>
        {messages.map((m, i) => (
          <div key={i}>
            <b>You:</b> {m.q} <br />
            <b>AI:</b> {m.a}
          </div>
        ))}
      </div>
      <input value={input} onChange={e => setInput(e.target.value)} />
      <button onClick={send}>Send</button>
    </div>
  );
}

export default App;
