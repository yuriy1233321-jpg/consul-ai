
import axios from 'axios';

const api = axios.create({
  baseURL: '/',
  headers: {
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      window.location.reload();
    }
    return Promise.reject(err);
  }
);

export const register = (email, password, name) =>
  api.post('/api/register', { email, password, name });

export const login = (email, password) =>
  api.post('/api/login', { email, password });

export const sendMessage = (message) =>
  api.post('/chat', { message });

export default api;
