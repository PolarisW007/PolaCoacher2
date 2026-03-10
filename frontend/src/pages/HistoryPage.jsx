import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  List,
  Button,
  Empty,
  Spin,
  Pagination,
  Modal,
  Tabs,
  message,
  Typography,
} from 'antd';
import {
  ReadOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
  BookOutlined,
} from '@ant-design/icons';
import { historyApi } from '../api/documents';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Text } = Typography;

const actionConfig = {
  read: { label: '阅读', bg: 'rgba(14,165,233,0.1)', color: '#0ea5e9', icon: <ReadOutlined />, route: '/reader' },
  play: { label: '播放', bg: 'rgba(45,206,137,0.1)', color: '#2dce89', icon: <PlayCircleOutlined />, route: '/play' },
};

export default function HistoryPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [actionFilter, setActionFilter] = useState('all');
  const pageSize = 20;

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize };
      if (actionFilter !== 'all') params.action = actionFilter;
      const res = await historyApi.list(params);
      setItems(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      message.error('加载失败：' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [page, actionFilter]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);
  useEffect(() => { setPage(1); }, [actionFilter]);

  const handleDelete = (id) => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这条历史记录吗？',
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await historyApi.delete(id);
          message.success('已删除');
          fetchHistory();
        } catch (err) {
          message.error('删除失败：' + (err.response?.data?.detail || err.message));
        }
      },
    });
  };

  const formatDuration = (seconds) => {
    if (!seconds) return null;
    if (seconds < 60) return `${seconds}秒`;
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}分${s}秒` : `${m}分钟`;
  };

  const tabItems = [
    { key: 'all', label: '全部' },
    { key: 'read', label: <span><ReadOutlined /> 阅读</span> },
    { key: 'play', label: <span><PlayCircleOutlined /> 播放</span> },
  ];

  return (
    <div className="fade-in" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#1a2332', letterSpacing: '-0.5px', marginBottom: 4 }}>
          历史记录
        </div>
        <Text style={{ color: '#8896a8', fontSize: 13 }}>阅读和播放历史</Text>
      </div>

      <Tabs activeKey={actionFilter} onChange={setActionFilter} items={tabItems} style={{ marginBottom: 16 }} />

      <Spin spinning={loading}>
        {items.length === 0 && !loading ? (
          <Card style={{ borderRadius: 14, textAlign: 'center', padding: 48, border: '1px solid rgba(226,234,243,0.8)' }}>
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无历史记录" />
          </Card>
        ) : (
          <Card
            style={{
              borderRadius: 14,
              border: '1px solid rgba(226,234,243,0.8)',
              boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
            }}
            styles={{ body: { padding: 0 } }}
          >
            <List
              dataSource={items}
              renderItem={(item) => {
                const cfg = actionConfig[item.action] || actionConfig.read;
                return (
                  <List.Item
                    style={{
                      padding: '14px 20px',
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                      borderBottom: '1px solid rgba(226,234,243,0.6)',
                    }}
                    onClick={() => navigate(`${cfg.route}/${item.document_id || item.id}`)}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(45,206,137,0.03)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    actions={[
                      <Button
                        key="delete"
                        type="text"
                        danger
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={(e) => { e.stopPropagation(); handleDelete(item.id); }}
                        style={{ borderRadius: 6 }}
                      />,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={
                        <div style={{
                          width: 38, height: 38, borderRadius: 10,
                          background: cfg.bg,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 16, color: cfg.color, flexShrink: 0,
                        }}>
                          {cfg.icon}
                        </div>
                      }
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                          <Text strong ellipsis={{ tooltip: true }} style={{ maxWidth: 400, color: '#1a2332', fontSize: 14 }}>
                            {item.document_title || item.title || '未命名文档'}
                          </Text>
                          <span style={{
                            padding: '1px 7px', borderRadius: 5, fontSize: 11, fontWeight: 500,
                            background: cfg.bg, color: cfg.color,
                          }}>
                            {cfg.label}
                          </span>
                        </div>
                      }
                      description={
                        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
                          {item.last_page != null && (
                            <span style={{ fontSize: 12, color: '#8896a8', display: 'flex', alignItems: 'center', gap: 3 }}>
                              <BookOutlined style={{ fontSize: 11 }} /> 第 {item.last_page} 页
                            </span>
                          )}
                          {item.duration != null && (
                            <span style={{ fontSize: 12, color: '#8896a8', display: 'flex', alignItems: 'center', gap: 3 }}>
                              <ClockCircleOutlined style={{ fontSize: 11 }} /> {formatDuration(item.duration)}
                            </span>
                          )}
                          <span style={{ fontSize: 12, color: '#aab4be' }}>
                            {dayjs(item.created_at || item.timestamp).fromNow()}
                          </span>
                        </div>
                      }
                    />
                  </List.Item>
                );
              }}
            />
          </Card>
        )}

        {total > pageSize && (
          <div style={{ textAlign: 'center', marginTop: 28 }}>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              onChange={(p) => setPage(p)}
              showSizeChanger={false}
            />
          </div>
        )}
      </Spin>
    </div>
  );
}
