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
  Button,
  Modal,
  Space,
  Tag,
  message,
} from 'antd';
import {
  CopyOutlined,
  HeartOutlined,
  WechatOutlined,
  PictureOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import { shareApi } from '../api/documents';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function PostGrid({ fetcher, emptyText, type }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [detailPost, setDetailPost] = useState(null);
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

  useEffect(() => { load(); }, [load]);

  const resolveCoverUrl = (url) => {
    if (!url) return null;
    if (url.startsWith('http')) return url;
    return `${BASE}${url}`;
  };

  const handleCopy = (post) => {
    const text = `${post.title}\n\n${post.content}`;
    navigator.clipboard.writeText(text).then(() => {
      message.success('已复制到剪贴板');
    }).catch(() => message.info('请手动复制'));
  };

  if (!loading && posts.length === 0) {
    return (
      <Card style={{ borderRadius: 12, textAlign: 'center', padding: 48 }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={emptyText}
        >
          <Text type="secondary" style={{ fontSize: 13 }}>
            在文档学习页读完后，点击「分享{type === 'xhs' ? '小红书' : '朋友圈'}」即可生成图文
          </Text>
        </Empty>
      </Card>
    );
  }

  return (
    <>
      <Spin spinning={loading}>
        <Row gutter={[20, 20]}>
          {posts.map((post) => {
            const coverSrc = resolveCoverUrl(post.cover_url);
            return (
              <Col xs={24} sm={12} md={8} key={post.id}>
                <Card
                  className="card-hover"
                  hoverable
                  onClick={() => setDetailPost(post)}
                  style={{ borderRadius: 12, height: '100%' }}
                  cover={
                    coverSrc ? (
                      <div style={{ height: 180, overflow: 'hidden', borderRadius: '12px 12px 0 0' }}>
                        <img
                          src={coverSrc}
                          alt={post.title}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => { e.target.style.display = 'none'; }}
                        />
                      </div>
                    ) : (
                      <div style={{
                        height: 180, borderRadius: '12px 12px 0 0',
                        background: type === 'xhs'
                          ? 'linear-gradient(135deg, #ff6b6b 0%, #ff2442 100%)'
                          : 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {type === 'xhs'
                          ? <HeartOutlined style={{ fontSize: 48, color: '#fff' }} />
                          : <WechatOutlined style={{ fontSize: 48, color: '#fff' }} />
                        }
                      </div>
                    )
                  }
                >
                  <Card.Meta
                    title={<Text ellipsis={{ tooltip: post.title }} strong>{post.title}</Text>}
                    description={
                      <>
                        <Paragraph ellipsis={{ rows: 2 }} style={{ color: '#636e72', marginBottom: 8 }}>
                          {post.content || '暂无内容'}
                        </Paragraph>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            <CalendarOutlined style={{ marginRight: 4 }} />
                            {dayjs(post.created_at).format('MM-DD HH:mm')}
                          </Text>
                          {post.image_status === 'ready' && (
                            <Tag color="green" style={{ fontSize: 10, margin: 0 }}>
                              <PictureOutlined /> 已配图
                            </Tag>
                          )}
                        </div>
                      </>
                    }
                  />
                </Card>
              </Col>
            );
          })}
        </Row>

        {total > pageSize && (
          <div style={{ textAlign: 'center', marginTop: 32 }}>
            <Pagination
              current={page} pageSize={pageSize} total={total}
              onChange={(p) => setPage(p)} showSizeChanger={false}
            />
          </div>
        )}
      </Spin>

      <Modal
        title={
          <Space>
            {type === 'xhs'
              ? <HeartOutlined style={{ color: '#ff2442' }} />
              : <WechatOutlined style={{ color: '#07c160' }} />}
            {type === 'xhs' ? '小红书图文详情' : '朋友圈图文详情'}
          </Space>
        }
        open={!!detailPost}
        onCancel={() => setDetailPost(null)}
        footer={
          detailPost ? (
            <Space>
              <Button onClick={() => setDetailPost(null)}>关闭</Button>
              <Button type="primary" icon={<CopyOutlined />} onClick={() => handleCopy(detailPost)}>
                复制内容
              </Button>
            </Space>
          ) : null
        }
        width={560}
        destroyOnClose
      >
        {detailPost && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {resolveCoverUrl(detailPost.cover_url) && (
              <div style={{ textAlign: 'center' }}>
                <Image
                  src={resolveCoverUrl(detailPost.cover_url)}
                  alt="封面图"
                  style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 10, objectFit: 'cover' }}
                />
              </div>
            )}
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>标题</Text>
              <div style={{ padding: '10px 14px', background: '#f6f8ff', borderRadius: 8, fontWeight: 600, fontSize: 15 }}>
                {detailPost.title}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>正文内容</Text>
              <div style={{
                padding: '12px 14px', background: '#fafafa', borderRadius: 8,
                fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto',
                border: '1px solid #f0f0f0',
              }}>
                {detailPost.content}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                {dayjs(detailPost.created_at).format('YYYY-MM-DD HH:mm:ss')}
              </Text>
              {detailPost.image_status === 'ready'
                ? <Tag color="green"><PictureOutlined /> 封面图已生成</Tag>
                : <Tag color="orange">封面图生成中...</Tag>
              }
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

const tabItems = [
  {
    key: 'xhs',
    label: '小红书',
    children: <PostGrid fetcher={shareApi.xhsPosts} emptyText="暂无小红书图文" type="xhs" />,
  },
  {
    key: 'moments',
    label: '朋友圈',
    children: <PostGrid fetcher={shareApi.momentsPosts} emptyText="暂无朋友圈图文" type="moments" />,
  },
];

export default function ShareCenterPage() {
  return (
    <div className="fade-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>分享中心</Title>
        <Text type="secondary" style={{ fontSize: 15 }}>
          AI 生成的小红书 & 朋友圈图文，点击卡片查看详情和复制
        </Text>
      </div>
      <Tabs items={tabItems} size="large" destroyInactiveTabPane />
    </div>
  );
}
