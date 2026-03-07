import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Card, Form, Input, Button, Typography, message, Divider } from 'antd';
import { UserOutlined, LockOutlined } from '@ant-design/icons';
import { authApi } from '../../api/auth';
import { useAuth } from '../../store/AuthContext';

const { Title, Text, Paragraph } = Typography;

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { login, fetchUser } = useAuth();

  const onFinish = async (values) => {
    setLoading(true);
    try {
      const res = await authApi.login({
        account: values.account,
        password: values.password,
      });
      login(res.data.access_token);
      await fetchUser();
      message.success('登录成功');
      navigate('/');
    } catch (err) {
      message.error(err.message || '登录失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #f7f8fa 0%, #e8faf0 50%, #e0f7fa 100%)',
        padding: 24,
      }}
    >
      <Card
        style={{
          width: 420,
          borderRadius: 16,
          boxShadow: '0 8px 40px rgba(0,0,0,0.08)',
          border: 'none',
        }}
        styles={{ body: { padding: '40px 36px' } }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 14,
              background: 'linear-gradient(135deg, #2dce89 0%, #11cdef 100%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 22,
              marginBottom: 16,
            }}
          >
            AI
          </div>
          <Title level={3} style={{ marginBottom: 4 }}>
            欢迎回来
          </Title>
          <Text type="secondary">登录 AI 藏经阁，开启智能学习之旅</Text>
        </div>

        <Form layout="vertical" onFinish={onFinish} size="large" autoComplete="off">
          <Form.Item
            name="account"
            rules={[{ required: true, message: '请输入用户名、邮箱或手机号' }]}
          >
            <Input prefix={<UserOutlined />} placeholder="用户名 / 邮箱 / 手机号" />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: '请输入密码' }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="密码" />
          </Form.Item>

          <Form.Item style={{ marginBottom: 16 }}>
            <Button type="primary" htmlType="submit" block loading={loading}>
              登 录
            </Button>
          </Form.Item>
        </Form>

        <Divider plain>
          <Text type="secondary" style={{ fontSize: 12 }}>
            还没有账号？
          </Text>
        </Divider>

        <Button block onClick={() => navigate('/register')}>
          注册新账号
        </Button>
      </Card>
    </div>
  );
}
