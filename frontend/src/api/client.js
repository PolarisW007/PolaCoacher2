import axios from 'axios';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

const client = axios.create({
  baseURL: `${BASE}/api`,
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
      const loginPath = `${BASE}/login`;
      if (!window.location.pathname.endsWith('/login')) {
        window.location.href = loginPath;
      }
    }
    let msg = err.response?.data?.detail || err.response?.data?.msg || err.message;
    if (typeof msg === 'object') {
      msg = Array.isArray(msg) ? msg.map((e) => e.msg || JSON.stringify(e)).join('; ') : JSON.stringify(msg);
    }
    return Promise.reject(new Error(msg));
  }
);

export default client;
