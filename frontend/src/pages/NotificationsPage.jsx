import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, List, Card, Badge, Button, Space, Empty, message, Spin } from 'antd';
import {
  HeartOutlined,
  MessageOutlined,
  BellOutlined,
  CheckOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { notificationApi } from '../api/community';
import dayjs from 'dayjs';

const { Text } = Typography;

const typeIcons = {
  like: <HeartOutlined style={{ color: '#f5365c' }} />,
  comment: <MessageOutlined style={{ color: '#2dce89' }} />,
  reply: <MessageOutlined style={{ color: '#11cdef' }} />,
  import_done: <FileTextOutlined style={{ color: '#2dce89' }} />,
  import_fail: <FileTextOutlined style={{ color: '#f5365c' }} />,
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
    try {
      const res = await notificationApi.list({ page: 1, page_size: 50 });
      setNotifications(res.data.items);
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetch();
  }, [fetch]);

  const handleMarkAllRead = async () => {
    await notificationApi.markAllRead();
    fetch();
    message.success('全部已读');
  };

  return (
    <div className="fade-in" style={{ maxWidth: 800, margin: '0 auto' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 24,
        }}
      >
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1a2332', letterSpacing: '-0.5px', marginBottom: 4 }}>
            通知中心
          </div>
          <Text style={{ color: '#8896a8', fontSize: 13 }}>查看最新动态和消息</Text>
        </div>
        <Button 
          icon={<CheckOutlined />} 
          onClick={handleMarkAllRead}
          style={{ 
            borderRadius: 10,
            border: '1px solid rgba(45,206,137,0.3)',
            color: '#2dce89',
            background: 'rgba(45,206,137,0.05)',
            fontWeight: 500
          }}
        >
          全部已读
        </Button>
      </div>

      <Spin spinning={loading}>
        {notifications.length === 0 ? (
          <Card 
            style={{ 
              borderRadius: 14,
              border: '1px solid rgba(226,234,243,0.8)',
              boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
              textAlign: 'center',
              padding: '40px 0'
            }}
          >
            <Empty description={<Text style={{ color: '#8896a8' }}>暂无通知</Text>} />
          </Card>
        ) : (
          <Card 
            style={{ 
              borderRadius: 14,
              border: '1px solid rgba(226,234,243,0.8)',
              boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
            }} 
            styles={{ body: { padding: 0, overflow: 'hidden', borderRadius: 14 } }}
          >
            <List
              dataSource={notifications}
              renderItem={(item) => (
                <List.Item
                  style={{
                    padding: '20px 24px',
                    cursor: 'pointer',
                    background: item.is_read ? 'transparent' : 'rgba(45,206,137,0.04)',
                    borderBottom: '1px solid rgba(226,234,243,0.6)',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => {
                    if (item.is_read) e.currentTarget.style.background = 'rgba(240,244,248,0.4)';
                  }}
                  onMouseLeave={(e) => {
                    if (item.is_read) e.currentTarget.style.background = 'transparent';
                  }}
                  onClick={async () => {
                    if (!item.is_read) await notificationApi.markRead(item.id);
                    if (item.document_id) navigate(`/community/${item.document_id}`);
                    fetch();
                  }}
                >
                  <List.Item.Meta
                    avatar={
                      <div style={{ 
                        width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                        background: 'linear-gradient(135deg, rgba(240,244,248,1), rgba(226,234,243,0.5))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, border: '1px solid rgba(226,234,243,0.8)'
                      }}>
                        {typeIcons[item.type] || <BellOutlined style={{ color: '#8896a8' }} />}
                      </div>
                    }
                    title={
                      <Space>
                        <Text strong={!item.is_read} style={{ color: '#1a2332', fontSize: 15 }}>
                          {item.sender?.username || '系统'}
                        </Text>
                        {!item.is_read && <Badge status="processing" color="#2dce89" />}
                      </Space>
                    }
                    description={
                      <div style={{ marginTop: 4 }}>
                        <Text style={{ color: '#5a6a7e', fontSize: 14 }}>
                          {item.content_preview}
                        </Text>
                        <div style={{ marginTop: 8 }}>
                          <Text type="secondary" style={{ fontSize: 12, color: '#8896a8' }}>
                            {dayjs(item.created_at).format('YYYY-MM-DD HH:mm')}
                          </Text>
                        </div>
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </Card>
        )}
      </Spin>
    </div>
  );
}
