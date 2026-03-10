import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Form, Input, Button, Typography, message, Divider } from 'antd';
import { UserOutlined, LockOutlined, MailOutlined, PhoneOutlined, SafetyOutlined, ThunderboltOutlined, RocketOutlined } from '@ant-design/icons';
import { authApi } from '../../api/auth';
import { useAuth } from '../../store/AuthContext';

const { Title, Text } = Typography;

const FEATURES = [
  { icon: <ThunderboltOutlined />, text: 'AI 智能讲解' },
  { icon: <SafetyOutlined />, text: '知识深度解析' },
  { icon: <RocketOutlined />, text: '高效学习助手' },
];

export default function RegisterPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login, fetchUser } = useAuth();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const res = await authApi.register({
        username: values.username,
        password: values.password,
        email: values.email || undefined,
        phone: values.phone || undefined,
      });
      login(res.data.access_token);
      await fetchUser();
      message.success('注册成功');
      navigate('/');
    } catch (err) {
      message.error(err.message || '注册失败');
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = {
    height: 44,
    borderRadius: 10,
    border: '1px solid #e2eaf3',
    background: 'rgba(240, 244, 248, 0.6)',
    fontSize: 14,
  };

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      background: 'linear-gradient(135deg, #0f1923 0%, #0d2436 40%, #0a2a1e 100%)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Animated background blobs */}
      <div style={{
        position: 'absolute', top: '-20%', left: '-10%',
        width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(45,206,137,0.12) 0%, transparent 70%)',
        animation: 'float 8s ease-in-out infinite',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', bottom: '-20%', right: '-10%',
        width: 500, height: 500, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(17,205,239,0.1) 0%, transparent 70%)',
        animation: 'float 10s ease-in-out infinite reverse',
        pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', top: '40%', left: '30%',
        width: 300, height: 300, borderRadius: '50%',
        background: 'radial-gradient(circle, rgba(45,206,137,0.06) 0%, transparent 70%)',
        animation: 'float 12s ease-in-out infinite 2s',
        pointerEvents: 'none',
      }} />

      {/* Grid overlay */}
      <div style={{
        position: 'absolute', inset: 0,
        backgroundImage: 'linear-gradient(rgba(45,206,137,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(45,206,137,0.05) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
        pointerEvents: 'none',
      }} />

      {/* Left brand panel */}
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 80px',
        '@media (max-width: 768px)': { display: 'none' },
      }}>
        {/* Logo */}
        <div style={{
          width: 72, height: 72, borderRadius: 18,
          background: 'linear-gradient(135deg, #2dce89, #11cdef)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontWeight: 800, fontSize: 28,
          marginBottom: 24,
          boxShadow: '0 8px 32px rgba(45,206,137,0.4), 0 0 0 1px rgba(45,206,137,0.2)',
          animation: 'glow 3s ease-in-out infinite',
        }}>
          AI
        </div>

        <div style={{
          fontSize: 36, fontWeight: 800, color: '#ffffff',
          marginBottom: 12, letterSpacing: '-1px', lineHeight: 1.2,
        }}>
          AI 藏经阁
        </div>
        <div style={{
          fontSize: 15, color: 'rgba(255,255,255,0.5)',
          marginBottom: 48, letterSpacing: '0.5px',
        }}>
          SMART LEARNING PLATFORM
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, width: '100%', maxWidth: 280 }}>
          {FEATURES.map((f, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '14px 20px',
              borderRadius: 12,
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(45,206,137,0.15)',
              color: 'rgba(255,255,255,0.75)',
              fontSize: 14,
              animation: `slideInLeft 0.5s ease ${i * 0.1}s both`,
            }}>
              <span style={{
                width: 32, height: 32, borderRadius: 8, flexShrink: 0,
                background: 'linear-gradient(135deg, rgba(45,206,137,0.2), rgba(17,205,239,0.1))',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#2dce89', fontSize: 15,
              }}>
                {f.icon}
              </span>
              {f.text}
            </div>
          ))}
        </div>
      </div>

      {/* Right register card */}
      <div style={{
        width: 460,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
        flexShrink: 0,
      }}>
        <div style={{
          width: '100%',
          maxWidth: 400,
          background: 'rgba(255,255,255,0.97)',
          borderRadius: 20,
          padding: '40px 36px',
          boxShadow: '0 24px 80px rgba(0,0,0,0.35), 0 0 0 1px rgba(255,255,255,0.1)',
          animation: 'slideInRight 0.6s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          {/* Card header */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 52, height: 52, borderRadius: 14,
              background: 'linear-gradient(135deg, #2dce89, #11cdef)',
              marginBottom: 16,
              boxShadow: '0 6px 20px rgba(45,206,137,0.35)',
            }}>
              <span style={{ color: '#fff', fontWeight: 800, fontSize: 20 }}>AI</span>
            </div>
            <Title level={3} style={{ marginBottom: 6, color: '#1a2332' }}>创建账号</Title>
            <Text style={{ color: '#5a6a7e', fontSize: 13 }}>
              加入 AI 藏经阁，重构你的学习体验
            </Text>
          </div>

          <Form layout="vertical" onFinish={onFinish} size="large" autoComplete="off">
            <Form.Item
              name="username"
              rules={[
                { required: true, message: '请输入用户名' },
                { min: 2, max: 32, message: '2-32 个字符' },
              ]}
              style={{ marginBottom: 16 }}
            >
              <Input prefix={<UserOutlined style={{ color: '#aab4be' }} />} placeholder="用户名" style={inputStyle} />
            </Form.Item>

            <Form.Item name="email" rules={[{ type: 'email', message: '请输入有效邮箱' }]} style={{ marginBottom: 16 }}>
              <Input prefix={<MailOutlined style={{ color: '#aab4be' }} />} placeholder="邮箱（选填）" style={inputStyle} />
            </Form.Item>

            <Form.Item name="phone" style={{ marginBottom: 16 }}>
              <Input prefix={<PhoneOutlined style={{ color: '#aab4be' }} />} placeholder="手机号（选填）" style={inputStyle} />
            </Form.Item>

            <Form.Item
              name="password"
              rules={[
                { required: true, message: '请输入密码' },
                { min: 6, message: '至少 6 个字符' },
              ]}
              style={{ marginBottom: 16 }}
            >
              <Input.Password prefix={<LockOutlined style={{ color: '#aab4be' }} />} placeholder="密码" style={inputStyle} />
            </Form.Item>

            <Form.Item
              name="confirmPassword"
              dependencies={['password']}
              rules={[
                { required: true, message: '请确认密码' },
                ({ getFieldValue }) => ({
                  validator(_, value) {
                    if (!value || getFieldValue('password') === value) return Promise.resolve();
                    return Promise.reject(new Error('两次密码不一致'));
                  },
                }),
              ]}
              style={{ marginBottom: 24 }}
            >
              <Input.Password prefix={<LockOutlined style={{ color: '#aab4be' }} />} placeholder="确认密码" style={inputStyle} />
            </Form.Item>

            <Form.Item style={{ marginBottom: 0 }}>
              <Button
                type="primary"
                htmlType="submit"
                block
                loading={loading}
                style={{
                  height: 46,
                  borderRadius: 12,
                  fontSize: 16,
                  fontWeight: 600,
                  background: 'linear-gradient(135deg, #2dce89, #11cdef)',
                  border: 'none',
                  boxShadow: '0 6px 20px rgba(45,206,137,0.4)',
                  letterSpacing: '1px',
                }}
              >
                注 册
              </Button>
            </Form.Item>
          </Form>

          <Divider plain style={{ margin: '20px 0 16px' }}>
            <Text style={{ color: '#aab4be', fontSize: 12 }}>已有账号？</Text>
          </Divider>

          <Button
            block
            onClick={() => navigate('/login')}
            style={{
              height: 42, borderRadius: 10,
              border: '1px solid #e2eaf3',
              color: '#5a6a7e', fontWeight: 500,
              background: 'rgba(240,244,248,0.5)',
              transition: 'all 0.2s ease',
            }}
          >
            返回登录
          </Button>
        </div>
      </div>
    </div>
  );
}
