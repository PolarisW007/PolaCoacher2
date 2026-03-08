import client from './client';

export const authApi = {
  register: (data) => client.post('/auth/register', data),
  login: (data) => client.post('/auth/login', data),
  sendOtp: (data) => client.post('/auth/send-otp', data),
  loginOtp: (data) => client.post('/auth/login-otp', data),
  getMe: () => client.get('/auth/me'),
  getOAuthUrl: (provider) => `/api/auth/oauth/${provider}`,
};
