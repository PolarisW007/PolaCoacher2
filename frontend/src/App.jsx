import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ConfigProvider, App as AntdApp, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { theme } from './styles/theme';
import { AuthProvider, useAuth } from './store/AuthContext';
import MainLayout from './layouts/MainLayout';

const LoginPage = lazy(() => import('./pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('./pages/auth/RegisterPage'));
const OAuthCallbackPage = lazy(() => import('./pages/auth/OAuthCallbackPage'));
const BookshelfPage = lazy(() => import('./pages/bookshelf/BookshelfPage'));
const CommunityPage = lazy(() => import('./pages/community/CommunityPage'));
const CommunityDetailPage = lazy(() => import('./pages/community/CommunityDetailPage'));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage'));
const DocumentReaderPage = lazy(() => import('./pages/reader/DocumentReaderPage'));
const DocumentStudyPage = lazy(() => import('./pages/study/DocumentStudyPage'));
const AiLecturePage = lazy(() => import('./pages/AiLecturePage'));
const ShareCenterPage = lazy(() => import('./pages/ShareCenterPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const DocumentLibraryPage = lazy(() => import('./pages/DocumentLibraryPage'));

const PageLoader = (
  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
    <Spin size="large" />
  </div>
);


function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <Spin style={{ display: 'block', margin: '200px auto' }} size="large" />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AppRoutes() {
  return (
    <Suspense fallback={PageLoader}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/oauth/callback" element={<OAuthCallbackPage />} />
        <Route element={<MainLayout />}>
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <BookshelfPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/documents"
            element={
              <ProtectedRoute>
                <DocumentLibraryPage />
              </ProtectedRoute>
            }
          />
          <Route path="/community" element={<CommunityPage />} />
          <Route path="/community/:id" element={<CommunityDetailPage />} />
          <Route
            path="/notifications"
            element={
              <ProtectedRoute>
                <NotificationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/ai-lecture"
            element={
              <ProtectedRoute>
                <AiLecturePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/study/:id"
            element={
              <ProtectedRoute>
                <DocumentStudyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/play/:id"
            element={
              <ProtectedRoute>
                <DocumentStudyPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/share"
            element={
              <ProtectedRoute>
                <ShareCenterPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/history"
            element={
              <ProtectedRoute>
                <HistoryPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <SettingsPage />
              </ProtectedRoute>
            }
          />
        </Route>
        {/* 全屏阅读器，脱出 MainLayout 侧边栏 */}
        <Route
          path="/reader/:id"
          element={
            <ProtectedRoute>
              <DocumentReaderPage />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  return (
    <ConfigProvider locale={zhCN} theme={theme}>
      <AntdApp>
        <BrowserRouter basename={import.meta.env.BASE_URL}>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  );
}
