import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Typography, List, Card, Badge, Button, Space, Empty, message, Spin, Tag } from 'antd';
import {
  HeartOutlined,
  MessageOutlined,
  BellOutlined,
  CheckOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { notificationApi } from '../api/community';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

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
          alignItems: 'center',
          marginBottom: 24,
        }}
      >
        <Title level={2} style={{ margin: 0 }}>
          通知中心
        </Title>
        <Button icon={<CheckOutlined />} onClick={handleMarkAllRead}>
          全部已读
        </Button>
      </div>

      <Spin spinning={loading}>
        {notifications.length === 0 ? (
          <Card style={{ borderRadius: 12 }}>
            <Empty description="暂无通知" />
          </Card>
        ) : (
          <Card style={{ borderRadius: 12 }} styles={{ body: { padding: 0 } }}>
            <List
              dataSource={notifications}
              renderItem={(item) => (
                <List.Item
                  style={{
                    padding: '16px 24px',
                    cursor: 'pointer',
                    background: item.is_read ? 'transparent' : '#f0faf5',
                    transition: 'background 0.2s',
                  }}
                  onClick={async () => {
                    if (!item.is_read) await notificationApi.markRead(item.id);
                    if (item.document_id) navigate(`/community/${item.document_id}`);
                    fetch();
                  }}
                >
                  <List.Item.Meta
                    avatar={
                      <div style={{ fontSize: 20, marginTop: 4 }}>
                        {typeIcons[item.type] || <BellOutlined />}
                      </div>
                    }
                    title={
                      <Space>
                        <Text strong={!item.is_read}>
                          {item.sender?.username || '系统'}
                        </Text>
                        {!item.is_read && <Badge status="processing" />}
                      </Space>
                    }
                    description={
                      <>
                        <Text style={{ color: '#636e72' }}>
                          {item.content_preview}
                        </Text>
                        <br />
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          {dayjs(item.created_at).format('YYYY-MM-DD HH:mm')}
                        </Text>
                      </>
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
