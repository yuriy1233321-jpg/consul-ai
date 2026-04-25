import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const messagesEndRef = useRef(null);

  const userId = localStorage.getItem('userId') || `user_${Date.now()}`;
  localStorage.setItem('userId', userId);

  useEffect(() => {
    axios.post('/chat', { userId, message: 'start' }).then(res => {
      const data = res.data;
      if (data.type === 'question') {
        setMessages([{
          role: 'consul',
          text: data.question,
          hint: data.hint,
          intro: data.intro
        }]);
        setProgress(data.progress || 0);
      }
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setLoading(true);

    try {
      const res = await axios.post('/chat', { userId, message: userMsg });
      const data = res.data;

      if (data.type === 'question') {
        setMessages(prev => [...prev, {
          role: 'consul',
          text: data.question,
          hint: data.hint,
          intro: data.intro
        }]);
        setProgress(data.progress || 0);
      }
      else if (data.type === 'next_question') {
        setMessages(prev => [...prev, {
          role: 'consul',
          text: data.nextQuestion.question,
          hint: data.nextQuestion.hint,
          evaluation: data.evaluation,
          intro: data.nextQuestion.intro
        }]);
        setProgress(data.progress || 0);
      }
      else if (data.type === 'final') {
        setMessages(prev => [...prev, {
          role: 'consul',
          text: `Twój wynik: ${data.averageScore}/10. ${data.recommendation === 'ready' ? 'Gratulacje! Jesteś gotowy do egzaminu.' : 'Ćwicz dalej!'}`,
          final: true,
          certificate: data.certificate,
          weakTopics: data.weakTopics
        }]);
        setProgress(100);
      }
      else if (data.type === 'limit_reached') {
        setMessages(prev => [...prev, {
          role: 'system',
          text: `⚠️ ${data.message} Kliknij tutaj, aby wykupić PRO: ${data.upgradeUrl || '/pricing'}`
        }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'system', text: '❌ Błąd połączenia. Spróbuj ponownie.' }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ background: 'linear-gradient(135deg, #dc143c, #8b0000)', color: 'white', padding: '16px 24px', borderRadius: '16px', marginBottom: '20px', textAlign: 'center' }}>
        <h1 style={{ margin: 0 }}>🎯 CONSUL.AI</h1>
        <p style={{ margin: '5px 0 0', opacity: 0.9 }}>Symulator rozmowy na Kartę Polaka</p>
      </div>

      {progress > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', marginBottom: '5px' }}>
            <span>Postęp rozmowy</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <div style={{ background: '#e0e0e0', borderRadius: '10px', height: '8px', overflow: 'hidden' }}>
            <div style={{ width: `${progress}%`, background: '#dc143c', height: '100%', transition: 'width 0.3s' }} />
          </div>
        </div>
      )}

      <div style={{ background: '#f9f9f9', borderRadius: '16px', padding: '16px', height: '500px', overflowY: 'auto', marginBottom: '20px' }}>
        {messages.map((msg, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: '16px' }}>
            <div style={{
              maxWidth: '80%',
              background: msg.role === 'user' ? '#dc143c' : (msg.role === 'system' ? '#ffcc00' : 'white'),
              color: msg.role === 'user' ? 'white' : (msg.role === 'system' ? '#333' : '#333'),
              padding: '10px 16px',
              borderRadius: msg.role === 'user' ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
              boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
              border: msg.role === 'consul' ? '1px solid #e0e0e0' : 'none'
            }}>
              {msg.intro && <div style={{ fontSize: '12px', color: '#888', marginBottom: '5px' }}>{msg.intro}</div>}
              <div>{msg.text}</div>
              {msg.hint && <div style={{ fontSize: '12px', color: '#dc143c', marginTop: '8px', borderTop: '1px solid #eee', paddingTop: '5px' }}>💡 {msg.hint}</div>}
              {msg.evaluation && (
                <div style={{ marginTop: '8px', fontSize: '12px', background: '#f0f0f0', borderRadius: '8px', padding: '6px' }}>
                  📊 Ocena: {msg.evaluation.score}/10<br />{msg.evaluation.feedback}
                </div>
              )}
              {msg.final && msg.weakTopics?.length > 0 && (
                <div style={{ marginTop: '10px', fontSize: '12px', background: '#fff3cd', padding: '8px', borderRadius: '8px' }}>
                  ⚠️ Słabe tematy: {msg.weakTopics.join(', ')}
                </div>
              )}
              {msg.certificate && (
                <div style={{ marginTop: '10px' }}>
                  <a href={msg.certificate.verificationUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#dc143c' }}>📜 Pobierz certyfikat</a>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && <div style={{ display: 'flex', justifyContent: 'flex-start' }}><div style={{ background: 'white', padding: '10px 16px', borderRadius: '20px' }}>✍️ Konsul pisze...</div></div>}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <textarea value={input} onChange={e => setInput(e.target.value)} onKeyDown={handleKeyPress} placeholder="Napisz odpowiedź po polsku..." rows="2" style={{ flex: 1, padding: '12px', border: '2px solid #e0e0e0', borderRadius: '16px', fontFamily: 'inherit', fontSize: '14px', resize: 'vertical' }} disabled={loading} />
        <button onClick={sendMessage} disabled={loading || !input.trim()} style={{ background: '#dc143c', color: 'white', border: 'none', borderRadius: '16px', padding: '0 24px', fontSize: '18px', cursor: 'pointer' }}>➤</button>
      </div>
      <div style={{ fontSize: '11px', textAlign: 'center', marginTop: '10px', color: '#888' }}>Shift+Enter = nowa linia</div>
    </div>
  );
}

export default App;
