import axios from 'axios';

const client = axios.create({
  baseURL: '/api',
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

client.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (res) => {
    const data = res.data;
    if (data.code !== 0 && data.code !== undefined) {
      return Promise.reject(new Error(data.msg || '请求失败'));
    }
    return data;
  },
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    const msg = err.response?.data?.detail || err.response?.data?.msg || err.message;
    return Promise.reject(new Error(msg));
  }
);

export default client;
