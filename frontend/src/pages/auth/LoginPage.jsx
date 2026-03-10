import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Tabs, Form, Input, Button, Typography, message, Divider, Space, Modal } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MobileOutlined,
  MailOutlined,
  WechatOutlined,
  AlipayCircleOutlined,
  QrcodeOutlined,
  ThunderboltOutlined,
  SafetyOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { authApi } from '../../api/auth';
import { useAuth } from '../../store/AuthContext';

const { Title, Text } = Typography;

const FEATURES = [
  { icon: <ThunderboltOutlined />, text: 'AI 智能讲解' },
  { icon: <SafetyOutlined />, text: '知识深度解析' },
  { icon: <RocketOutlined />, text: '高效学习助手' },
];

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [qrModal, setQrModal] = useState({ open: false, type: '' });
  const [loginTab, setLoginTab] = useState('password');
  const [otpSent, setOtpSent] = useState(false);
  const navigate = useNavigate();
  const { login, fetchUser } = useAuth();

  const handleOtpLogin = async (values) => {
    setLoading(true);
    try {
      const res = await authApi.loginOtp({ account: values.account, otp: values.otp });
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

  const handleSendOtp = async (account) => {
    if (!account) { message.warning('请输入手机号或邮箱'); return; }
    try {
      const data = account.includes('@') ? { email: account } : { phone: account };
      await authApi.sendOtp(data);
      setOtpSent(true);
      message.success('验证码已发送');
      setTimeout(() => setOtpSent(false), 60000);
    } catch (err) {
      message.error(err.message);
    }
  };

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
      const errMsg = err.message || '登录失败';
      if (errMsg.includes('尚未注册') || errMsg.includes('不存在')) {
        Modal.confirm({
          title: '账号未注册',
          content: '该账号尚未注册，是否立即创建新账号？',
          okText: '去注册',
          cancelText: '取消',
          onOk: () => navigate('/register'),
        });
      } else {
        message.error(errMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleOAuth = (provider) => {
    setQrModal({ open: true, type: provider });
    window.open(`/api/auth/oauth/${provider}`, '_blank', 'width=600,height=700');
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

      {/* Right login card */}
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
            <Title level={3} style={{ marginBottom: 6, color: '#1a2332' }}>欢迎回来</Title>
            <Text style={{ color: '#5a6a7e', fontSize: 13 }}>
              登录 AI 藏经阁，开启智能学习之旅
            </Text>
          </div>

          <Tabs
            activeKey={loginTab}
            onChange={setLoginTab}
            centered
            size="small"
            style={{ marginBottom: 4 }}
            items={[
              {
                key: 'password',
                label: '账号密码',
                children: (
                  <Form layout="vertical" onFinish={onFinish} size="large" autoComplete="off" style={{ marginTop: 8 }}>
                    <Form.Item name="account" rules={[{ required: true, message: '请输入用户名、邮箱或手机号' }]}>
                      <Input
                        prefix={<UserOutlined style={{ color: '#aab4be' }} />}
                        placeholder="用户名 / 邮箱 / 手机号"
                        style={inputStyle}
                      />
                    </Form.Item>
                    <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                      <Input.Password
                        prefix={<LockOutlined style={{ color: '#aab4be' }} />}
                        placeholder="密码"
                        style={inputStyle}
                      />
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
                        登 录
                      </Button>
                    </Form.Item>
                  </Form>
                ),
              },
              {
                key: 'otp',
                label: '验证码登录',
                children: (
                  <Form layout="vertical" onFinish={handleOtpLogin} size="large" autoComplete="off" style={{ marginTop: 8 }}>
                    <Form.Item name="account" rules={[{ required: true, message: '请输入手机号或邮箱' }]}>
                      <Input
                        prefix={<MobileOutlined style={{ color: '#aab4be' }} />}
                        placeholder="手机号 / 邮箱"
                        style={inputStyle}
                      />
                    </Form.Item>
                    <Form.Item name="otp" rules={[{ required: true, message: '请输入验证码' }]}>
                      <Space.Compact style={{ width: '100%' }}>
                        <Input
                          prefix={<MailOutlined style={{ color: '#aab4be' }} />}
                          placeholder="6位验证码"
                          maxLength={6}
                          style={{ ...inputStyle, flex: 1 }}
                        />
                        <Button
                          disabled={otpSent}
                          style={{ height: 44, borderRadius: '0 10px 10px 0', fontWeight: 500 }}
                          onClick={(e) => {
                            const form = e.target.closest('form');
                            const input = form?.querySelector('input');
                            handleSendOtp(input?.value);
                          }}
                        >
                          {otpSent ? '已发送' : '获取验证码'}
                        </Button>
                      </Space.Compact>
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0 }}>
                      <Button
                        type="primary"
                        htmlType="submit"
                        block
                        loading={loading}
                        style={{
                          height: 46, borderRadius: 12, fontSize: 16, fontWeight: 600,
                          background: 'linear-gradient(135deg, #2dce89, #11cdef)',
                          border: 'none',
                          boxShadow: '0 6px 20px rgba(45,206,137,0.4)',
                          letterSpacing: '1px',
                        }}
                      >
                        登 录
                      </Button>
                    </Form.Item>
                  </Form>
                ),
              },
            ]}
          />

          <Divider plain style={{ margin: '20px 0' }}>
            <Text style={{ color: '#aab4be', fontSize: 12 }}>快捷登录</Text>
          </Divider>

          <Space style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }} size={20}>
            {[
              { icon: <WechatOutlined style={{ fontSize: 24, color: '#07c160' }} />, provider: 'wechat', label: '微信' },
              { icon: <AlipayCircleOutlined style={{ fontSize: 24, color: '#1677ff' }} />, provider: 'alipay', label: '支付宝' },
            ].map(({ icon, provider, label }) => (
              <button
                key={provider}
                onClick={() => handleOAuth(provider)}
                title={`${label}扫码登录`}
                style={{
                  width: 52, height: 52, borderRadius: 14,
                  border: '1px solid #e2eaf3',
                  background: 'rgba(240,244,248,0.5)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'rgba(45,206,137,0.4)';
                  e.currentTarget.style.background = 'rgba(45,206,137,0.05)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#e2eaf3';
                  e.currentTarget.style.background = 'rgba(240,244,248,0.5)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {icon}
              </button>
            ))}
          </Space>

          <Divider plain style={{ margin: '0 0 16px' }}>
            <Text style={{ color: '#aab4be', fontSize: 12 }}>还没有账号？</Text>
          </Divider>

          <Button
            block
            onClick={() => navigate('/register')}
            style={{
              height: 42, borderRadius: 10,
              border: '1px solid #e2eaf3',
              color: '#5a6a7e', fontWeight: 500,
              background: 'rgba(240,244,248,0.5)',
              transition: 'all 0.2s ease',
            }}
          >
            注册新账号
          </Button>
        </div>
      </div>

      <Modal
        open={qrModal.open}
        title={
          <Space>
            <QrcodeOutlined />
            {qrModal.type === 'wechat' ? '微信扫码登录' : '支付宝扫码登录'}
          </Space>
        }
        footer={null}
        onCancel={() => setQrModal({ open: false, type: '' })}
        width={400}
        centered
      >
        <div style={{ textAlign: 'center', padding: '24px 0' }}>
          <div style={{
            width: 200, height: 200, margin: '0 auto 16px',
            background: '#fafafa', borderRadius: 12,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid #f0f0f0',
          }}>
            <QrcodeOutlined style={{ fontSize: 64, color: '#ccc' }} />
          </div>
          <Text type="secondary">
            {qrModal.type === 'wechat' ? '请使用微信扫描二维码登录' : '请使用支付宝扫描二维码登录'}
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>扫码后将自动完成登录</Text>
        </div>
      </Modal>
    </div>
  );
}
