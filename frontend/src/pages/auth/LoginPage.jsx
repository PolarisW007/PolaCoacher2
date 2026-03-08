import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, Tabs, Form, Input, Button, Typography, message, Divider, Space, Modal } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MobileOutlined,
  MailOutlined,
  WechatOutlined,
  AlipayCircleOutlined,
  QrcodeOutlined,
} from '@ant-design/icons';
import { authApi } from '../../api/auth';
import { useAuth } from '../../store/AuthContext';

const { Title, Text } = Typography;

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

        <Tabs
          activeKey={loginTab}
          onChange={setLoginTab}
          centered
          size="small"
          items={[
            {
              key: 'password',
              label: '账号密码',
              children: (
                <Form layout="vertical" onFinish={onFinish} size="large" autoComplete="off">
                  <Form.Item name="account" rules={[{ required: true, message: '请输入用户名、邮箱或手机号' }]}>
                    <Input prefix={<UserOutlined />} placeholder="用户名 / 邮箱 / 手机号" />
                  </Form.Item>
                  <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                    <Input.Password prefix={<LockOutlined />} placeholder="密码" />
                  </Form.Item>
                  <Form.Item style={{ marginBottom: 16 }}>
                    <Button type="primary" htmlType="submit" block loading={loading}>登 录</Button>
                  </Form.Item>
                </Form>
              ),
            },
            {
              key: 'otp',
              label: '验证码登录',
              children: (
                <Form layout="vertical" onFinish={handleOtpLogin} size="large" autoComplete="off">
                  <Form.Item name="account" rules={[{ required: true, message: '请输入手机号或邮箱' }]}>
                    <Input prefix={<MobileOutlined />} placeholder="手机号 / 邮箱" />
                  </Form.Item>
                  <Form.Item name="otp" rules={[{ required: true, message: '请输入验证码' }]}>
                    <Space.Compact style={{ width: '100%' }}>
                      <Input prefix={<MailOutlined />} placeholder="6位验证码" maxLength={6} style={{ flex: 1 }} />
                      <Button
                        disabled={otpSent}
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
                  <Form.Item style={{ marginBottom: 16 }}>
                    <Button type="primary" htmlType="submit" block loading={loading}>登 录</Button>
                  </Form.Item>
                </Form>
              ),
            },
          ]}
        />

        <Divider plain>
          <Text type="secondary" style={{ fontSize: 12 }}>
            快捷登录
          </Text>
        </Divider>

        <Space
          style={{
            display: 'flex',
            justifyContent: 'center',
            marginBottom: 24,
          }}
          size={24}
        >
          <Button
            type="text"
            icon={<WechatOutlined style={{ fontSize: 28, color: '#07c160' }} />}
            onClick={() => handleOAuth('wechat')}
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              border: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="微信扫码登录"
          />
          <Button
            type="text"
            icon={<AlipayCircleOutlined style={{ fontSize: 28, color: '#1677ff' }} />}
            onClick={() => handleOAuth('alipay')}
            style={{
              width: 56,
              height: 56,
              borderRadius: 16,
              border: '1px solid #f0f0f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            title="支付宝扫码登录"
          />
        </Space>

        <Divider plain>
          <Text type="secondary" style={{ fontSize: 12 }}>
            还没有账号？
          </Text>
        </Divider>

        <Button block onClick={() => navigate('/register')}>
          注册新账号
        </Button>
      </Card>

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
          <div
            style={{
              width: 200,
              height: 200,
              margin: '0 auto 16px',
              background: '#fafafa',
              borderRadius: 12,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '1px solid #f0f0f0',
            }}
          >
            <QrcodeOutlined style={{ fontSize: 64, color: '#ccc' }} />
          </div>
          <Text type="secondary">
            {qrModal.type === 'wechat'
              ? '请使用微信扫描二维码登录'
              : '请使用支付宝扫描二维码登录'}
          </Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>
            扫码后将自动完成登录
          </Text>
        </div>
      </Modal>
    </div>
  );
}
