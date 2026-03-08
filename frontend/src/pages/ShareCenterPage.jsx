import { useState, useEffect, useCallback } from 'react';
import {
  Typography,
  Tabs,
  Card,
  Row,
  Col,
  Empty,
  Spin,
  Pagination,
  Image,
  message,
} from 'antd';
import { shareApi } from '../api/documents';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;

function PostGrid({ fetcher, emptyText }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetcher({ page, page_size: pageSize });
      setPosts(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      message.error('加载失败：' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [fetcher, page]);

  useEffect(() => {
    load();
  }, [load]);

  if (!loading && posts.length === 0) {
    return (
      <Card style={{ borderRadius: 12, textAlign: 'center', padding: 48 }}>
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={emptyText} />
      </Card>
    );
  }

  return (
    <Spin spinning={loading}>
      <Row gutter={[20, 20]}>
        {posts.map((post) => (
          <Col xs={24} sm={12} md={8} key={post.id}>
            <Card
              className="card-hover"
              hoverable
              style={{ borderRadius: 12, height: '100%' }}
              cover={
                post.cover_url ? (
                  <Image
                    src={post.cover_url}
                    alt={post.title}
                    preview={false}
                    style={{
                      height: 180,
                      objectFit: 'cover',
                      borderRadius: '12px 12px 0 0',
                    }}
                  />
                ) : null
              }
            >
              <Card.Meta
                title={
                  <Text ellipsis={{ tooltip: post.title }} strong>
                    {post.title}
                  </Text>
                }
                description={
                  <>
                    <Paragraph
                      ellipsis={{ rows: 2 }}
                      style={{ color: '#636e72', marginBottom: 8 }}
                    >
                      {post.content || '暂无内容'}
                    </Paragraph>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {dayjs(post.created_at).format('YYYY-MM-DD HH:mm')}
                    </Text>
                  </>
                }
              />
            </Card>
          </Col>
        ))}
      </Row>

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
  );
}

const tabItems = [
  {
    key: 'xhs',
    label: '小红书',
    children: (
      <PostGrid
        fetcher={shareApi.xhsPosts}
        emptyText="暂无小红书图文"
      />
    ),
  },
  {
    key: 'moments',
    label: '朋友圈',
    children: (
      <PostGrid
        fetcher={shareApi.momentsPosts}
        emptyText="暂无朋友圈图文"
      />
    ),
  },
];

export default function ShareCenterPage() {
  return (
    <div className="fade-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>
          分享中心
        </Title>
        <Text type="secondary" style={{ fontSize: 15 }}>
          小红书和朋友圈图文管理
        </Text>
      </div>

      <Tabs items={tabItems} size="large" destroyInactiveTabPane />
    </div>
  );
}
