
import React, { useState, useEffect, useRef } from 'react';
import { login, register, sendMessage } from './services/api';

function App() {
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [authError, setAuthError] = useState('');
  const [isAuthenticated, setIsAuthenticated] = useState(!!localStorage.getItem('token'));
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('user');
    return saved ? JSON.parse(saved) : null;
  });

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const messagesEndRef = useRef(null);

  // Paywall modal state
  const [paywallVisible, setPaywallVisible] = useState(false);
  const [paywallMessage, setPaywallMessage] = useState('');
  const [paywallPlans, setPaywallPlans] = useState([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    console.log("AUTH:", isAuthenticated);
    if (isAuthenticated) {
      startInterview().catch(err => console.error(err));
    }
  }, [isAuthenticated]);

  // Listen for paywall events from api interceptor
  useEffect(() => {
    const handlePaywall = (event) => {
      const { type, message, plans } = event.detail;
      setPaywallMessage(message || (type === 'expired' ? 'Twoja subskrypcja wygasła.' : 'Koniec wersji demo.'));
      setPaywallPlans(plans || []);
      setPaywallVisible(true);
    };
    window.addEventListener('show-paywall', handlePaywall);
    return () => window.removeEventListener('show-paywall', handlePaywall);
  }, []);

  const startInterview = async () => {
    try {
      const res = await sendMessage('start');
      const data = res.data;
      if (data.type === 'question') {
        setMessages([{
          role: 'consul',
          text: data.question,
          hint: data.hint,
          intro: data.intro,
        }]);
        setProgress(data.progress || 0);
      }
    } catch (err) {
      console.error('Failed to start interview', err);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await login(email, password);
      const { token, user: userData } = res.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(userData));
      setIsAuthenticated(true);
      setUser(userData);
      setEmail('');
      setPassword('');
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Login failed');
    }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      await register(email, password, name);
      const loginRes = await login(email, password);
      const { token, user: userData } = loginRes.data;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(userData));
      setIsAuthenticated(true);
      setUser(userData);
      setEmail('');
      setPassword('');
      setName('');
    } catch (err) {
      setAuthError(err.response?.data?.error || 'Registration failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setIsAuthenticated(false);
    setUser(null);
    setMessages([]);
    setProgress(0);
  };

  const sendChatMessage = async () => {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setMessages(prev => [...prev, { role: 'user', text: userMsg }]);
    setInput('');
    setLoading(true);
    try {
      const res = await sendMessage(userMsg);
      const data = res.data;
      // Handle paywall/expired responses (should be caught by interceptor, but double-check)
      if (data.type === 'paywall' || data.type === 'expired') {
        setPaywallMessage(data.message || (data.type === 'expired' ? 'Subskrypcja wygasła.' : 'Limit demo osiągnięty.'));
        setPaywallPlans(data.plans || []);
        setPaywallVisible(true);
        return;
      }
      if (data.type === 'question') {
        setMessages(prev => [...prev, {
          role: 'consul',
          text: data.question,
          hint: data.hint,
          intro: data.intro,
        }]);
        setProgress(data.progress || 0);
      } else if (data.type === 'next_question') {
        setMessages(prev => [...prev, {
          role: 'consul',
          text: data.nextQuestion.question,
          hint: data.nextQuestion.hint,
          evaluation: data.evaluation,
          intro: data.nextQuestion.intro,
        }]);
        setProgress(data.progress || 0);
      } else if (data.type === 'final') {
        setMessages(prev => [...prev, {
          role: 'consul',
          text: `Twój wynik: ${data.averageScore}/10. ${data.recommendation === 'ready' ? 'Gratulacje! Jesteś gotowy do egzaminu.' : 'Ćwicz dalej!'}`,
          final: true,
          certificate: data.certificate,
          weakTopics: data.weakTopics,
        }]);
        setProgress(100);
      } else if (data.type === 'limit_reached') {
        setMessages(prev => [...prev, {
          role: 'system',
          text: `⚠️ ${data.message} Kliknij tutaj, aby wykupić PRO: ${data.upgradeUrl || '/pricing'}`,
        }]);
      }
    } catch (err) {
      // Если ошибка уже обработана в interceptor (например, 401), не показываем дополнительное сообщение
      if (!err.handled) {
        setMessages(prev => [...prev, { role: 'system', text: '❌ Błąd połączenia. Spróbuj ponownie.' }]);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage();
    }
  };

  // Modal component for paywall
  const PaywallModal = () => {
    if (!paywallVisible) return null;
    return (
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 1000
      }}>
        <div style={{
          background: 'white', borderRadius: '24px', maxWidth: '500px', width: '90%',
          padding: '24px', textAlign: 'center', boxShadow: '0 20px 35px rgba(0,0,0,0.2)'
        }}>
          <h2 style={{ color: '#dc143c', marginTop: 0 }}>🔒 Dostęp ograniczony</h2>
          <p style={{ fontSize: '16px', marginBottom: '20px' }}>{paywallMessage}</p>
          {paywallPlans.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <p style={{ fontWeight: 'bold' }}>Wybierz plan:</p>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {paywallPlans.map((plan, idx) => (
                  <li key={idx} style={{ margin: '8px 0' }}>
                    <a
                      href={plan.link || 'https://flexiway.pl/cennik/'}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#dc143c', textDecoration: 'none', fontWeight: 'bold' }}
                    >
                      {plan.name || `Plan ${plan.price}`} → {plan.price ? `${plan.price} zł` : ''}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button
            onClick={() => setPaywallVisible(false)}
            style={{
              background: '#dc143c', color: 'white', border: 'none',
              padding: '10px 20px', borderRadius: '40px', cursor: 'pointer'
            }}
          >
            Zamknij
          </button>
        </div>
      </div>
    );
  };

  if (!isAuthenticated) {
    return (
      <>
        <div style={{ maxWidth: '500px', margin: '50px auto', padding: '20px', fontFamily: 'system-ui' }}>
          <div style={{ background: 'linear-gradient(135deg, #dc143c, #8b0000)', color: 'white', padding: '16px', borderRadius: '16px', textAlign: 'center', marginBottom: '24px' }}>
            <h1 style={{ margin: 0 }}>🎯 CONSUL.AI</h1>
            <p style={{ margin: '5px 0 0', opacity: 0.9 }}>Zaloguj się, aby kontynuować</p>
          </div>
          <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
              <button onClick={() => setAuthMode('login')} style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '24px', background: authMode === 'login' ? '#dc143c' : '#f0f0f0', color: authMode === 'login' ? 'white' : '#333', cursor: 'pointer' }}>Zaloguj się</button>
              <button onClick={() => setAuthMode('register')} style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '24px', background: authMode === 'register' ? '#dc143c' : '#f0f0f0', color: authMode === 'register' ? 'white' : '#333', cursor: 'pointer' }}>Zarejestruj się</button>
            </div>
            <form onSubmit={authMode === 'login' ? handleLogin : handleRegister}>
              {authMode === 'register' && (
                <input type="text" placeholder="Imię i nazwisko" value={name} onChange={e => setName(e.target.value)} required style={{ width: '100%', padding: '12px', marginBottom: '12px', border: '1px solid #ddd', borderRadius: '24px', boxSizing: 'border-box' }} />
              )}
              <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required style={{ width: '100%', padding: '12px', marginBottom: '12px', border: '1px solid #ddd', borderRadius: '24px', boxSizing: 'border-box' }} />
              <input type="password" placeholder="Hasło" value={password} onChange={e => setPassword(e.target.value)} required style={{ width: '100%', padding: '12px', marginBottom: '12px', border: '1px solid #ddd', borderRadius: '24px', boxSizing: 'border-box' }} />
              <button type="submit" style={{ width: '100%', background: '#dc143c', color: 'white', border: 'none', padding: '12px', borderRadius: '24px', fontSize: '16px', cursor: 'pointer' }}>
                {authMode === 'login' ? 'Zaloguj się' : 'Zarejestruj się'}
              </button>
            </form>
            {authError && <div style={{ color: 'red', marginTop: '12px', textAlign: 'center' }}>{authError}</div>}
          </div>
        </div>
        <PaywallModal />
      </>
    );
  }

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui' }}>
      <div style={{ background: 'linear-gradient(135deg, #dc143c, #8b0000)', color: 'white', padding: '12px 24px', borderRadius: '16px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0 }}>🎯 CONSUL.AI</h1>
          <p style={{ margin: '5px 0 0', opacity: 0.9, fontSize: '12px' }}>Symulator rozmowy na Kartę Polaka</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{ fontSize: '14px' }}>👤 {user?.name || user?.email}</span>
          <button onClick={handleLogout} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', padding: '6px 12px', borderRadius: '20px', cursor: 'pointer' }}>Wyloguj</button>
        </div>
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
              {msg.hint && <div style={{ fontSize: '12px', color: '#dc143c', marginTop: '8px' }}>💡 {msg.hint}</div>}
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
                  <a href={msg.certificate.verificationUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#dc143c', textDecoration: 'none' }}>📜 Pobierz certyfikat</a>
                </div>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{ background: 'white', padding: '10px 16px', borderRadius: '20px', border: '1px solid #e0e0e0' }}>✍️ Konsul pisze...</div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div style={{ display: 'flex', gap: '10px' }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Napisz odpowiedź po polsku..."
          rows="2"
          style={{ flex: 1, padding: '12px', border: '2px solid #e0e0e0', borderRadius: '16px', fontFamily: 'inherit', fontSize: '14px', resize: 'vertical' }}
          disabled={loading}
        />
        <button
          onClick={sendChatMessage}
          disabled={loading || !input.trim()}
          style={{ background: '#dc143c', color: 'white', border: 'none', borderRadius: '16px', padding: '0 24px', fontSize: '18px', cursor: 'pointer' }}
        >
          ➤
        </button>
      </div>
      <div style={{ fontSize: '11px', textAlign: 'center', marginTop: '10px', color: '#888' }}>Shift+Enter = nowa linia</div>
      <PaywallModal />
    </div>
  );
}

export default App;
