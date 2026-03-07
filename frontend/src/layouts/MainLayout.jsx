import { useState, useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import {
  Layout,
  Menu,
  Avatar,
  Dropdown,
  Badge,
  Button,
  Space,
  Typography,
} from 'antd';
import {
  BookOutlined,
  GlobalOutlined,
  ShareAltOutlined,
  HistoryOutlined,
  SettingOutlined,
  BellOutlined,
  UserOutlined,
  LogoutOutlined,
  LoginOutlined,
  PlayCircleOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
} from '@ant-design/icons';
import { useAuth } from '../store/AuthContext';
import { notificationApi } from '../api/community';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const menuItems = [
  { key: '/', icon: <BookOutlined />, label: '书架' },
  { key: '/ai-lecture', icon: <PlayCircleOutlined />, label: 'AI 讲堂' },
  { key: '/community', icon: <GlobalOutlined />, label: '社区' },
  { key: '/share', icon: <ShareAltOutlined />, label: '分享中心' },
  { key: '/history', icon: <HistoryOutlined />, label: '历史记录' },
  { type: 'divider' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

export default function MainLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!user) return;
    notificationApi.unreadCount().then((res) => setUnread(res.data)).catch(() => {});
    const timer = setInterval(() => {
      notificationApi.unreadCount().then((res) => setUnread(res.data)).catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [user]);

  const userMenu = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: '个人中心' },
      { key: 'settings', icon: <SettingOutlined />, label: '设置' },
      { type: 'divider' },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', danger: true },
    ],
    onClick: ({ key }) => {
      if (key === 'logout') {
        logout();
        navigate('/login');
      } else if (key === 'settings') {
        navigate('/settings');
      }
    },
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={220}
        style={{
          background: '#fff',
          borderRight: '1px solid #f0f0f0',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          overflow: 'auto',
        }}
      >
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? 0 : '0 20px',
            borderBottom: '1px solid #f0f0f0',
            cursor: 'pointer',
          }}
          onClick={() => navigate('/')}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              background: 'linear-gradient(135deg, #2dce89 0%, #11cdef 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 700,
              fontSize: 16,
              flexShrink: 0,
            }}
          >
            AI
          </div>
          {!collapsed && (
            <Text
              strong
              style={{ marginLeft: 10, fontSize: 16, whiteSpace: 'nowrap' }}
            >
              AI 藏经阁
            </Text>
          )}
        </div>

        <Menu
          mode="inline"
          selectedKeys={[location.pathname]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ border: 'none', marginTop: 8 }}
        />
      </Sider>

      <Layout style={{ marginLeft: collapsed ? 80 : 220, transition: 'margin-left 0.2s' }}>
        <Header
          style={{
            background: '#fff',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid #f0f0f0',
            position: 'sticky',
            top: 0,
            zIndex: 99,
          }}
        >
          <Button
            type="text"
            icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
            onClick={() => setCollapsed(!collapsed)}
          />

          <Space size={16}>
            {user ? (
              <>
                <Badge count={unread} size="small" offset={[-2, 2]}>
                  <Button
                    type="text"
                    icon={<BellOutlined style={{ fontSize: 18 }} />}
                    onClick={() => navigate('/notifications')}
                  />
                </Badge>
                <Dropdown menu={userMenu} placement="bottomRight">
                  <Space style={{ cursor: 'pointer' }}>
                    <Avatar
                      src={user.avatar_url}
                      icon={!user.avatar_url && <UserOutlined />}
                      style={{ backgroundColor: '#2dce89' }}
                    />
                    <Text>{user.username}</Text>
                  </Space>
                </Dropdown>
              </>
            ) : (
              <Button
                type="primary"
                icon={<LoginOutlined />}
                onClick={() => navigate('/login')}
              >
                登录
              </Button>
            )}
          </Space>
        </Header>

        <Content style={{ padding: 24, minHeight: 'calc(100vh - 64px)' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
