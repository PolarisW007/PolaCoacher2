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
  Breadcrumb,
  Tooltip,
} from 'antd';
import {
  BookOutlined,
  FolderOutlined,
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
  HomeOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { useAuth } from '../store/AuthContext';
import { notificationApi } from '../api/community';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const breadcrumbMap = {
  '/': '书架',
  '/documents': '文档库',
  '/ai-lecture': 'AI 讲堂',
  '/community': '社区',
  '/share': '分享中心',
  '/history': '历史记录',
  '/settings': '设置',
  '/notifications': '通知中心',
};

const menuItems = [
  { key: '/', icon: <BookOutlined />, label: '书架' },
  { key: '/documents', icon: <FolderOutlined />, label: '文档库' },
  { key: '/ai-lecture', icon: <PlayCircleOutlined />, label: 'AI 讲堂' },
  { key: '/community', icon: <GlobalOutlined />, label: '社区' },
  { key: '/share', icon: <ShareAltOutlined />, label: '分享中心' },
  { key: '/history', icon: <HistoryOutlined />, label: '历史记录' },
  { type: 'divider' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

const MENU_ICON_MAP = {
  '/': BookOutlined,
  '/documents': FolderOutlined,
  '/ai-lecture': PlayCircleOutlined,
  '/community': GlobalOutlined,
  '/share': ShareAltOutlined,
  '/history': HistoryOutlined,
  '/settings': SettingOutlined,
};

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

  const getBreadcrumbItems = () => {
    const path = location.pathname;
    const items = [
      {
        title: (
          <span
            onClick={() => navigate('/')}
            style={{ cursor: 'pointer', color: '#5a6a7e', display: 'flex', alignItems: 'center', gap: 4 }}
          >
            <HomeOutlined style={{ fontSize: 13 }} /> 首页
          </span>
        ),
      },
    ];

    if (path.startsWith('/study/')) {
      items.push({ title: '文档学习' });
    } else if (path.startsWith('/reader/') || path.startsWith('/play/')) {
      items.push({ title: '文档学习' });
    } else if (path.startsWith('/community/') && path !== '/community') {
      items.push({
        title: (
          <span onClick={() => navigate('/community')} style={{ cursor: 'pointer' }}>
            社区
          </span>
        ),
      });
      items.push({ title: '讲解详情' });
    } else if (breadcrumbMap[path]) {
      items.push({ title: breadcrumbMap[path] });
    }

    return items;
  };

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

  const siderBg = '#ffffff';
  const activePath = location.pathname;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {/* ===== SIDER ===== */}
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        trigger={null}
        width={220}
        style={{
          background: siderBg,
          borderRight: '1px solid #edf2f7',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
          zIndex: 100,
          overflow: 'hidden',
          boxShadow: '2px 0 20px rgba(0,0,0,0.04)',
        }}
      >
        {/* Subtle top glow accent */}
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          background: 'linear-gradient(90deg, #2dce89, #11cdef, #2dce89)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 3s linear infinite',
        }} />

        {/* Logo */}
        <div
          style={{
            height: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : 'flex-start',
            padding: collapsed ? 0 : '0 20px',
            borderBottom: '1px solid #edf2f7',
            cursor: 'pointer',
            gap: 10,
          }}
          onClick={() => navigate('/')}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #2dce89 0%, #11cdef 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              fontWeight: 800,
              fontSize: 15,
              flexShrink: 0,
              boxShadow: '0 4px 14px rgba(45, 206, 137, 0.45)',
              position: 'relative',
            }}
          >
            AI
          </div>
          {!collapsed && (
            <div>
              <div style={{
                fontSize: 15,
                fontWeight: 700,
                color: '#1a2332',
                letterSpacing: '-0.3px',
                lineHeight: 1.2,
              }}>
                AI 藏经阁
              </div>
              <div style={{
                fontSize: 10,
                color: '#2dce89',
                fontWeight: 500,
                letterSpacing: '0.5px',
                opacity: 0.8,
              }}>
                SMART LEARNING
              </div>
            </div>
          )}
        </div>

        {/* Menu */}
        <div style={{ padding: '10px 0' }}>
          {menuItems.map((item) => {
            if (item.type === 'divider') {
              return (
                <div
                  key="divider"
                  style={{
                    margin: '8px 14px',
                    height: 1,
                    background: 'linear-gradient(90deg, transparent, #e2eaf3, transparent)',
                  }}
                />
              );
            }

            const isActive = activePath === item.key;
            return (
              <Tooltip
                key={item.key}
                title={collapsed ? item.label : ''}
                placement="right"
              >
                <div
                  onClick={() => navigate(item.key)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: collapsed ? '10px 0' : '10px 14px',
                    margin: '2px 8px',
                    borderRadius: 10,
                    cursor: 'pointer',
                    justifyContent: collapsed ? 'center' : 'flex-start',
                    background: isActive
                      ? 'linear-gradient(135deg, rgba(45,206,137,0.12), rgba(17,205,239,0.06))'
                      : 'transparent',
                    border: isActive
                      ? '1px solid rgba(45, 206, 137, 0.22)'
                      : '1px solid transparent',
                    color: isActive ? '#2dce89' : '#5a6a7e',
                    fontWeight: isActive ? 600 : 400,
                    fontSize: 14,
                    transition: 'all 0.2s ease',
                    position: 'relative',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'rgba(45, 206, 137, 0.06)';
                      e.currentTarget.style.color = '#1a2332';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.background = 'transparent';
                      e.currentTarget.style.color = '#5a6a7e';
                    }
                  }}
                >
                  {/* Active indicator bar */}
                  {isActive && (
                    <div style={{
                      position: 'absolute',
                      left: 0,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      width: 3,
                      height: '60%',
                      borderRadius: '0 3px 3px 0',
                      background: 'linear-gradient(180deg, #2dce89, #11cdef)',
                    }} />
                  )}
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
                  {!collapsed && <span>{item.label}</span>}
                </div>
              </Tooltip>
            );
          })}
        </div>

        {/* Bottom user card (expanded mode) */}
        {!collapsed && user && (
          <div style={{
            position: 'absolute',
            bottom: 16,
            left: 12,
            right: 12,
            padding: '10px 12px',
            borderRadius: 10,
            background: 'linear-gradient(135deg, rgba(45,206,137,0.06), rgba(17,205,239,0.04))',
            border: '1px solid rgba(45,206,137,0.12)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}>
            <Avatar
              src={user.avatar_url}
              icon={!user.avatar_url && <UserOutlined />}
              size={28}
              style={{ backgroundColor: '#2dce89', flexShrink: 0 }}
            />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#1a2332', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.username}
              </div>
              <div style={{ fontSize: 10, color: '#2dce89', display: 'flex', alignItems: 'center', gap: 3 }}>
                <ThunderboltOutlined style={{ fontSize: 10 }} /> 学习中
              </div>
            </div>
          </div>
        )}
      </Sider>

      {/* ===== MAIN ===== */}
      <Layout style={{ marginLeft: collapsed ? 80 : 220, transition: 'margin-left 0.25s ease' }}>
        {/* Header */}
        <Header
          style={{
            background: 'rgba(255, 255, 255, 0.92)',
            backdropFilter: 'blur(20px)',
            WebkitBackdropFilter: 'blur(20px)',
            padding: '0 24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(226, 234, 243, 0.8)',
            position: 'sticky',
            top: 0,
            zIndex: 99,
            height: 60,
          }}
        >
          <Space>
            <Button
              type="text"
              icon={
                collapsed
                  ? <MenuUnfoldOutlined style={{ color: '#5a6a7e' }} />
                  : <MenuFoldOutlined style={{ color: '#5a6a7e' }} />
              }
              onClick={() => setCollapsed(!collapsed)}
              style={{ borderRadius: 8 }}
            />
            <Breadcrumb
              items={getBreadcrumbItems()}
              style={{ fontSize: 13 }}
            />
          </Space>

          <Space size={8}>
            {user ? (
              <>
                <Badge
                  count={unread}
                  size="small"
                  offset={[-4, 4]}
                  style={{ boxShadow: '0 2px 8px rgba(245,54,92,0.3)' }}
                >
                  <Button
                    type="text"
                    icon={<BellOutlined style={{ fontSize: 18, color: '#5a6a7e' }} />}
                    onClick={() => navigate('/notifications')}
                    style={{ borderRadius: 10, width: 40, height: 40 }}
                  />
                </Badge>
                <Dropdown menu={userMenu} placement="bottomRight">
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    padding: '6px 12px',
                    borderRadius: 24,
                    border: '1px solid #edf2f7',
                    transition: 'all 0.2s ease',
                    background: 'rgba(255,255,255,0.8)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'rgba(45,206,137,0.3)';
                    e.currentTarget.style.background = 'rgba(45,206,137,0.04)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = '#edf2f7';
                    e.currentTarget.style.background = 'rgba(255,255,255,0.8)';
                  }}
                  >
                    <Avatar
                      src={user.avatar_url}
                      icon={!user.avatar_url && <UserOutlined />}
                      size={28}
                      style={{ backgroundColor: '#2dce89' }}
                    />
                    <Text style={{ fontSize: 13, color: '#1a2332', fontWeight: 500 }}>
                      {user.username}
                    </Text>
                  </div>
                </Dropdown>
              </>
            ) : (
              <Button
                type="primary"
                icon={<LoginOutlined />}
                onClick={() => navigate('/login')}
                style={{
                  background: 'linear-gradient(135deg, #2dce89, #11cdef)',
                  border: 'none',
                  borderRadius: 20,
                  height: 36,
                  paddingInline: 20,
                  fontWeight: 500,
                  boxShadow: '0 4px 12px rgba(45, 206, 137, 0.35)',
                }}
              >
                登录
              </Button>
            )}
          </Space>
        </Header>

        <Content
          className="tech-bg"
          style={{ padding: 24, minHeight: 'calc(100vh - 60px)' }}
        >
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
