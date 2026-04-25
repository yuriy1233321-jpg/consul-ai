import axios from 'axios';

const api = axios.create({
  baseURL: '/',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

export const login = (email, password) =>
  api.post('/api/login', { email, password });

export const register = (email, password, name) =>
  api.post('/api/register', { email, password, name });

export const sendMessage = (message) =>
  api.post('/chat', { message });

export default api;
