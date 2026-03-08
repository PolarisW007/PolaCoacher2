import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography,
  Card,
  List,
  Tag,
  Button,
  Empty,
  Spin,
  Pagination,
  Modal,
  Tabs,
  message,
} from 'antd';
import {
  ReadOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { historyApi } from '../api/documents';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

const { Title, Text } = Typography;

const actionConfig = {
  read: { label: '阅读', color: 'blue', icon: <ReadOutlined />, route: '/reader' },
  play: { label: '播放', color: 'green', icon: <PlayCircleOutlined />, route: '/play' },
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

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  useEffect(() => {
    setPage(1);
  }, [actionFilter]);

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
    { key: 'read', label: '阅读' },
    { key: 'play', label: '播放' },
  ];

  return (
    <div className="fade-in" style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>
          历史记录
        </Title>
        <Text type="secondary" style={{ fontSize: 15 }}>
          阅读和播放历史
        </Text>
      </div>

      <Tabs
        activeKey={actionFilter}
        onChange={(key) => setActionFilter(key)}
        items={tabItems}
        size="large"
        style={{ marginBottom: 16 }}
      />

      <Spin spinning={loading}>
        {items.length === 0 && !loading ? (
          <Card style={{ borderRadius: 12, textAlign: 'center', padding: 48 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="暂无历史记录"
            />
          </Card>
        ) : (
          <Card style={{ borderRadius: 12 }} styles={{ body: { padding: 0 } }}>
            <List
              dataSource={items}
              renderItem={(item) => {
                const cfg = actionConfig[item.action] || actionConfig.read;
                return (
                  <List.Item
                    style={{
                      padding: '16px 24px',
                      cursor: 'pointer',
                      transition: 'background 0.2s',
                    }}
                    onClick={() =>
                      navigate(`${cfg.route}/${item.document_id || item.id}`)
                    }
                    actions={[
                      <Button
                        key="delete"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(item.id);
                        }}
                      />,
                    ]}
                  >
                    <List.Item.Meta
                      avatar={
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            background: item.action === 'play' ? '#e8faf0' : '#e8f4fd',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 18,
                          }}
                        >
                          {cfg.icon}
                        </div>
                      }
                      title={
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Text strong ellipsis={{ tooltip: true }} style={{ maxWidth: 400 }}>
                            {item.document_title || item.title || '未命名文档'}
                          </Text>
                          <Tag color={cfg.color}>{cfg.label}</Tag>
                        </div>
                      }
                      description={
                        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                          {item.last_page != null && (
                            <Text type="secondary" style={{ fontSize: 13 }}>
                              读到第 {item.last_page} 页
                            </Text>
                          )}
                          {item.duration != null && (
                            <Text type="secondary" style={{ fontSize: 13 }}>
                              <ClockCircleOutlined style={{ marginRight: 4 }} />
                              {formatDuration(item.duration)}
                            </Text>
                          )}
                          <Text type="secondary" style={{ fontSize: 13 }}>
                            {dayjs(item.created_at || item.timestamp).fromNow()}
                          </Text>
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
          <div style={{ textAlign: 'center', marginTop: 32 }}>
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
