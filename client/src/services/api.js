import axios from 'axios';

const api = axios.create({
  baseURL: '/',
  headers: { 'Content-Type': 'application/json' },
});

// Додаємо токен до кожного запиту
api.interceptors.request.use(config => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Обробка 401 – видалення токена та перенаправлення на логін
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/';
    }
    return Promise.reject(error);
  }
);

export const register = (email, password, name) => api.post('/api/register', { email, password, name });
export const login = (email, password) => api.post('/api/login', { email, password });
export const sendMessage = (message) => api.post('/chat', { message });

export default api;
