import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, Result, Typography } from 'antd';
import { useAuth } from '../../store/AuthContext';

const { Text } = Typography;

export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const [status, setStatus] = useState('loading');
  const navigate = useNavigate();
  const { login, fetchUser } = useAuth();

  useEffect(() => {
    const token = searchParams.get('token');
    const error = searchParams.get('error');

    if (error) {
      setStatus('error');
      return;
    }

    if (token) {
      login(token);
      fetchUser().then(() => {
        setStatus('success');
        setTimeout(() => navigate('/'), 1000);
      });
    } else {
      setStatus('error');
    }
  }, [searchParams, login, fetchUser, navigate]);

  if (status === 'loading') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="正在登录中..." />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Result
          status="error"
          title="登录失败"
          subTitle="扫码授权失败，请重试"
          extra={
            <Text
              type="link"
              style={{ cursor: 'pointer' }}
              onClick={() => navigate('/login')}
            >
              返回登录页
            </Text>
          }
        />
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <Result status="success" title="登录成功" subTitle="正在跳转..." />
    </div>
  );
}
