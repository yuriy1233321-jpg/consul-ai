import axios from 'axios';

const api = axios.create({
  baseURL: '/',
  headers: { 'Content-Type': 'application/json' },
});

// 🔐 Додаємо токен до кожного запиту
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// 🚪 Автоматичний вихід при 401
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/';
    }
    return Promise.reject(err);
  }
);

// 🧱 НОВИЙ ПЕРЕХОПЛЮВАЧ ДЛЯ PAYWALL / EXPIRED
api.interceptors.response.use(
  (response) => {
    // Якщо відповідь містить paywall або expired – диспатчимо подію
    if (response.data?.type === 'paywall' || response.data?.type === 'expired') {
      // Створюємо кастомну подію, яку зможе зловити App.jsx
      window.dispatchEvent(new CustomEvent('show-paywall', { detail: response.data }));
    }
    return response;
  },
  (error) => Promise.reject(error) // залишаємо обробку помилок як було
);

// 📦 API функції
export const register = (email, password, name) =>
  api.post('/api/register', { email, password, name });

export const login = (email, password) =>
  api.post('/api/login', { email, password });

export const sendMessage = (message) =>
  api.post('/chat', { message });

export default api;
