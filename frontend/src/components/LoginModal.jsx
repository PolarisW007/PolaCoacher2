import { useState } from 'react';
import { Modal, Tabs, Form, Input, Button, message, Space, Divider } from 'antd';
import {
  UserOutlined,
  LockOutlined,
  MailOutlined,
  MobileOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import { authApi } from '../api/auth';
import { useAuth } from '../store/AuthContext';

export default function LoginModal({ open, onClose }) {
  const { login, fetchUser } = useAuth();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('password');
  const [otpSent, setOtpSent] = useState(false);

  const handlePasswordLogin = async (values) => {
    setLoading(true);
    try {
      const res = await authApi.login({
        account: values.account,
        password: values.password,
      });
      login(res.data.access_token);
      await fetchUser();
      message.success('登录成功');
      onClose?.();
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSendOtp = async (account) => {
    if (!account) {
      message.warning('请输入手机号或邮箱');
      return;
    }
    try {
      const data = account.includes('@') ? { email: account } : { phone: account };
      await authApi.sendOtp(data);
      setOtpSent(true);
      message.success('验证码已发送');
    } catch (err) {
      message.error(err.message);
    }
  };

  const handleOtpLogin = async (values) => {
    setLoading(true);
    try {
      const res = await authApi.loginOtp({
        account: values.account,
        otp: values.otp,
      });
      login(res.data.access_token);
      await fetchUser();
      message.success('登录成功');
      onClose?.();
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      title="登录 AI 藏经阁"
      centered
      width={420}
      destroyOnClose
    >
      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        centered
        items={[
          {
            key: 'password',
            label: '账号密码登录',
            children: (
              <Form onFinish={handlePasswordLogin} layout="vertical" size="large">
                <Form.Item name="account" rules={[{ required: true, message: '请输入账号' }]}>
                  <Input prefix={<UserOutlined />} placeholder="邮箱 / 手机号 / 用户名" />
                </Form.Item>
                <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
                  <Input.Password prefix={<LockOutlined />} placeholder="密码" />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={loading} block>
                    登录
                  </Button>
                </Form.Item>
              </Form>
            ),
          },
          {
            key: 'otp',
            label: '验证码登录',
            children: (
              <Form onFinish={handleOtpLogin} layout="vertical" size="large">
                <Form.Item name="account" rules={[{ required: true, message: '请输入手机号或邮箱' }]}>
                  <Input
                    prefix={<MobileOutlined />}
                    placeholder="手机号 / 邮箱"
                    suffix={
                      <Button
                        type="link"
                        size="small"
                        disabled={otpSent}
                        onClick={(e) => {
                          e.stopPropagation();
                          const input = e.target.closest('form')?.querySelector('input');
                          handleSendOtp(input?.value);
                        }}
                      >
                        {otpSent ? '已发送' : '获取验证码'}
                      </Button>
                    }
                  />
                </Form.Item>
                <Form.Item name="otp" rules={[{ required: true, message: '请输入验证码' }]}>
                  <Input prefix={<MailOutlined />} placeholder="验证码" maxLength={6} />
                </Form.Item>
                <Form.Item>
                  <Button type="primary" htmlType="submit" loading={loading} block>
                    登录
                  </Button>
                </Form.Item>
              </Form>
            ),
          },
        ]}
      />
      <Divider plain style={{ margin: '8px 0 16px' }}>快捷登录</Divider>
      <Space style={{ width: '100%', justifyContent: 'center' }}>
        <Button
          icon={<WechatOutlined style={{ color: '#07c160' }} />}
          shape="circle"
          size="large"
          onClick={() => {
            window.open(authApi.getOAuthUrl('wechat'), '_blank', 'width=600,height=500');
          }}
        />
      </Space>
    </Modal>
  );
}
