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

const { Text, Paragraph } = Typography;
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
      <Card style={{ 
        borderRadius: 14, 
        textAlign: 'center', 
        padding: 48,
        border: '1px solid rgba(226,234,243,0.8)',
        boxShadow: '0 2px 16px rgba(0,0,0,0.02)'
      }}>
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={<Text style={{ color: '#8896a8' }}>{emptyText}</Text>}
        >
          <Text style={{ fontSize: 13, color: '#aab4be' }}>
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
                  hoverable
                  onClick={() => setDetailPost(post)}
                  style={{ 
                    borderRadius: 14, 
                    height: '100%',
                    border: '1px solid rgba(226,234,243,0.8)',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.03)',
                    overflow: 'hidden',
                    display: 'flex',
                    flexDirection: 'column'
                  }}
                  styles={{ 
                    body: { padding: '16px 20px', flex: 1, display: 'flex', flexDirection: 'column' }
                  }}
                  cover={
                    coverSrc ? (
                      <div style={{ height: 180, overflow: 'hidden' }}>
                        <img
                          src={coverSrc}
                          alt={post.title}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s ease' }}
                          onError={(e) => { e.target.style.display = 'none'; }}
                          onMouseEnter={(e) => e.target.style.transform = 'scale(1.05)'}
                          onMouseLeave={(e) => e.target.style.transform = 'scale(1)'}
                        />
                      </div>
                    ) : (
                      <div style={{
                        height: 180,
                        background: type === 'xhs'
                          ? 'linear-gradient(135deg, rgba(255,107,107,0.1) 0%, rgba(255,36,66,0.1) 100%)'
                          : 'linear-gradient(135deg, rgba(67,233,123,0.1) 0%, rgba(56,249,215,0.1) 100%)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {type === 'xhs'
                          ? <HeartOutlined style={{ fontSize: 48, color: '#ff2442', opacity: 0.8 }} />
                          : <WechatOutlined style={{ fontSize: 48, color: '#07c160', opacity: 0.8 }} />
                        }
                      </div>
                    )
                  }
                >
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                    <Text ellipsis={{ tooltip: post.title }} strong style={{ fontSize: 16, color: '#1a2332', marginBottom: 8 }}>
                      {post.title}
                    </Text>
                    <Paragraph ellipsis={{ rows: 2 }} style={{ color: '#5a6a7e', fontSize: 13, marginBottom: 16, flex: 1 }}>
                      {post.content || '暂无内容'}
                    </Paragraph>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'auto' }}>
                      <Text style={{ fontSize: 12, color: '#8896a8', display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CalendarOutlined />
                        {dayjs(post.created_at).format('MM-DD HH:mm')}
                      </Text>
                      {post.image_status === 'ready' && (
                        <Tag color="success" style={{ margin: 0, borderRadius: 6, border: 'none', background: 'rgba(45,206,137,0.1)', color: '#2dce89' }}>
                          <PictureOutlined style={{ marginRight: 4 }} /> 已配图
                        </Tag>
                      )}
                    </div>
                  </div>
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
            <span style={{ fontWeight: 600 }}>{type === 'xhs' ? '小红书图文详情' : '朋友圈图文详情'}</span>
          </Space>
        }
        open={!!detailPost}
        onCancel={() => setDetailPost(null)}
        footer={
          detailPost ? (
            <Space>
              <Button style={{ borderRadius: 10 }} onClick={() => setDetailPost(null)}>关闭</Button>
              <Button 
                type="primary" 
                icon={<CopyOutlined />} 
                onClick={() => handleCopy(detailPost)}
                style={{ 
                  borderRadius: 10,
                  background: 'linear-gradient(135deg, #2dce89, #11cdef)',
                  border: 'none',
                  boxShadow: '0 4px 14px rgba(45,206,137,0.3)'
                }}
              >
                复制内容
              </Button>
            </Space>
          ) : null
        }
        width={560}
        destroyOnClose
        styles={{ 
          content: { borderRadius: 16 }, 
          header: { marginBottom: 16 } 
        }}
      >
        {detailPost && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {resolveCoverUrl(detailPost.cover_url) && (
              <div style={{ textAlign: 'center' }}>
                <Image
                  src={resolveCoverUrl(detailPost.cover_url)}
                  alt="封面图"
                  style={{ maxWidth: '100%', maxHeight: 280, borderRadius: 12, objectFit: 'cover', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
                />
              </div>
            )}
            <div>
              <Text style={{ fontSize: 13, color: '#8896a8', marginBottom: 6, display: 'block' }}>标题</Text>
              <div style={{ padding: '12px 16px', background: 'rgba(240,244,248,0.5)', borderRadius: 10, fontWeight: 600, fontSize: 15, color: '#1a2332', border: '1px solid rgba(226,234,243,0.8)' }}>
                {detailPost.title}
              </div>
            </div>
            <div>
              <Text style={{ fontSize: 13, color: '#8896a8', marginBottom: 6, display: 'block' }}>正文内容</Text>
              <div style={{
                padding: '16px', background: 'rgba(240,244,248,0.3)', borderRadius: 10,
                fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto',
                border: '1px solid rgba(226,234,243,0.8)',
                color: '#334155'
              }}>
                {detailPost.content}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: 12, color: '#aab4be' }}>
                生成于：{dayjs(detailPost.created_at).format('YYYY-MM-DD HH:mm:ss')}
              </Text>
              {detailPost.image_status === 'ready'
                ? <Tag color="success" style={{ borderRadius: 6, border: 'none', background: 'rgba(45,206,137,0.1)', color: '#2dce89' }}><PictureOutlined /> 封面图已生成</Tag>
                : <Tag color="processing" style={{ borderRadius: 6, border: 'none', background: 'rgba(17,205,239,0.1)', color: '#11cdef' }}>封面图生成中...</Tag>
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
        <div style={{ fontSize: 26, fontWeight: 800, color: '#1a2332', letterSpacing: '-0.5px', marginBottom: 4 }}>
          分享中心
        </div>
        <Text style={{ color: '#8896a8', fontSize: 13 }}>
          AI 生成的小红书 & 朋友圈图文，点击卡片查看详情和复制
        </Text>
      </div>
      <Tabs 
        items={tabItems} 
        size="large" 
        destroyInactiveTabPane
        tabBarStyle={{ marginBottom: 24 }}
      />
    </div>
  );
}
