import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, Result, Typography, Card } from 'antd';
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

  const containerStyle = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #0f1923 0%, #0d2436 40%, #0a2a1e 100%)',
    position: 'relative',
    overflow: 'hidden',
  };

  const cardStyle = {
    width: 400,
    background: 'rgba(255,255,255,0.97)',
    borderRadius: 20,
    padding: '20px',
    boxShadow: '0 24px 80px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.1)',
    textAlign: 'center'
  };

  if (status === 'loading') {
    return (
      <div style={containerStyle}>
        <Card style={cardStyle} bordered={false}>
          <Spin size="large" tip={<span style={{ marginTop: 16, display: 'block', color: '#5a6a7e' }}>正在登录中...</span>} />
        </Card>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={containerStyle}>
        <Card style={cardStyle} bordered={false}>
          <Result
            status="error"
            title={<span style={{ color: '#1a2332' }}>登录失败</span>}
            subTitle={<span style={{ color: '#5a6a7e' }}>扫码授权失败，请重试</span>}
            extra={
              <div
                style={{
                  display: 'inline-block',
                  padding: '10px 24px',
                  borderRadius: 10,
                  background: 'rgba(240,244,248,0.8)',
                  color: '#1a2332',
                  cursor: 'pointer',
                  fontWeight: 500,
                  transition: 'all 0.2s ease',
                  border: '1px solid #e2eaf3'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = '#e2eaf3'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(240,244,248,0.8)'}
                onClick={() => navigate('/login')}
              >
                返回登录页
              </div>
            }
          />
        </Card>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <Card style={cardStyle} bordered={false}>
        <Result 
          status="success" 
          title={<span style={{ color: '#1a2332' }}>登录成功</span>} 
          subTitle={<span style={{ color: '#5a6a7e' }}>正在跳转...</span>} 
        />
      </Card>
    </div>
  );
}
