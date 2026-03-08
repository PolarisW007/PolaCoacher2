import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Typography,
  Tabs,
  Card,
  Row,
  Col,
  Input,
  Tag,
  Avatar,
  Space,
  Spin,
  Empty,
  Button,
  message,
} from 'antd';
import {
  HeartOutlined,
  HeartFilled,
  MessageOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  EyeOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { communityApi } from '../../api/community';
import { useAuth } from '../../store/AuthContext';

const { Title, Text, Paragraph } = Typography;

const categoryTags = ['全部', '计算机', '人工智能', '文学', '经济', '历史', '哲学', '其他'];

function LectureCard({ doc }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);

  return (
    <Card
      className="card-hover"
      hoverable
      onClick={() => navigate(`/community/${doc.id}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{ borderRadius: 12, overflow: 'hidden' }}
      styles={{ body: { padding: 16 } }}
    >
      <div
        style={{
          height: 140,
          background: `linear-gradient(135deg, #${((doc.id * 123456) % 0xffffff).toString(16).padStart(6, '0')} 0%, #${((doc.id * 654321) % 0xffffff).toString(16).padStart(6, '0')} 100%)`,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* AI 生成封面图或书籍封面（优先），fallback 到渐变色 */}
        {doc.cover_url && (
          <img
            src={(() => {
              const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
              return doc.cover_url.startsWith('http')
                ? doc.cover_url
                : `${BASE}/api${doc.cover_url}`;
            })()}
            alt={doc.title}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )}
        {!doc.cover_url && (
          <PlayCircleOutlined style={{ fontSize: 40, color: 'rgba(255,255,255,0.9)', position: 'relative', zIndex: 1 }} />
        )}
        {/* Hover 时显示简介 */}
        {hovered && doc.summary && (
          <div style={{
            position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 12, transition: 'opacity 0.25s', zIndex: 2,
          }}>
            <Text style={{ color: '#fff', fontSize: 12, lineHeight: 1.5, textAlign: 'center' }} ellipsis={{ rows: 5 }}>
              {doc.summary?.slice(0, 100)}{doc.summary?.length > 100 ? '...' : ''}
            </Text>
          </div>
        )}
      </div>

      <Paragraph
        ellipsis={{ rows: 2 }}
        style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, minHeight: 42 }}
      >
        {doc.title}
      </Paragraph>

      {doc.tags?.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          {doc.tags.slice(0, 2).map((t) => (
            <Tag key={t} style={{ borderRadius: 4, fontSize: 11 }}>
              {t}
            </Tag>
          ))}
        </div>
      )}

      {doc.owner && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
          <Avatar size={20} icon={<UserOutlined />} src={doc.owner?.avatar_url} />
          <Text type="secondary" style={{ fontSize: 12 }}>{doc.owner?.username}</Text>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space size={12}>
          <Text type="secondary" style={{ fontSize: 12 }}><EyeOutlined /> {doc.play_count}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}><HeartOutlined /> {doc.like_count}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}><MessageOutlined /> {doc.comment_count}</Text>
        </Space>
      </div>
    </Card>
  );
}

export default function CommunityPage() {
  const { user } = useAuth();
  const [lectures, setLectures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState('latest');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState('全部');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchIdRef = useRef(0);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(search), 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [search]);

  const fetchLectures = useCallback(async (fetchPage) => {
    const currentFetchId = ++fetchIdRef.current;
    setLoading(true);
    try {
      let res;
      if (sort === 'mine') {
        res = await communityApi.myPublications({ page: fetchPage, page_size: 20 });
      } else {
        const params = { page: fetchPage, page_size: 20, sort };
        if (debouncedSearch) params.search = debouncedSearch;
        if (selectedTag !== '全部') params.tag = selectedTag;
        res = await communityApi.listLectures(params);
      }
      if (currentFetchId !== fetchIdRef.current) return;
      const items = res.data?.items || [];
      setLectures(fetchPage === 1 ? items : (prev) => [...prev, ...items]);
      setTotal(res.data?.total || 0);
    } catch (err) {
      if (currentFetchId === fetchIdRef.current) {
        message.error(err.message || '加载失败');
      }
    } finally {
      if (currentFetchId === fetchIdRef.current) setLoading(false);
    }
  }, [sort, debouncedSearch, selectedTag]);

  useEffect(() => {
    setPage(1);
    fetchLectures(1);
  }, [sort, debouncedSearch, selectedTag, fetchLectures]);

  useEffect(() => {
    if (page > 1) fetchLectures(page);
  }, [page, fetchLectures]);

  const tabItems = [
    { key: 'recommend', label: '推荐' },
    { key: 'latest', label: '最新' },
    { key: 'hot', label: '热门' },
    ...(user ? [{ key: 'mine', label: '我的发布' }] : []),
  ];

  return (
    <div className="fade-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ marginBottom: 4 }}>
          知识社区
        </Title>
        <Text type="secondary">发现优质讲解，与他人共同学习成长</Text>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <Tabs
          activeKey={sort}
          onChange={setSort}
          items={tabItems}
          style={{ marginBottom: 0 }}
        />
        <Input
          placeholder="搜索讲解..."
          prefix={<SearchOutlined />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220, borderRadius: 8 }}
          allowClear
        />
      </div>

      <div style={{ marginBottom: 20 }}>
        <Space wrap>
          {categoryTags.map((t) => (
            <Tag.CheckableTag
              key={t}
              checked={selectedTag === t}
              onChange={() => setSelectedTag(t)}
              style={{
                padding: '4px 14px',
                borderRadius: 16,
                fontSize: 13,
                border: '1px solid #e9ecef',
              }}
            >
              {t}
            </Tag.CheckableTag>
          ))}
        </Space>
      </div>

      <Spin spinning={loading && page === 1}>
        {lectures.length === 0 && !loading ? (
          <Empty description="暂无公开讲解" style={{ paddingTop: 80 }} />
        ) : (
          <>
            <Row gutter={[20, 20]}>
              {lectures.map((doc) => (
                <Col key={doc.id} xs={24} sm={12} md={8} lg={6}>
                  <LectureCard doc={doc} />
                </Col>
              ))}
            </Row>
            {lectures.length < total && (
              <div style={{ textAlign: 'center', marginTop: 32 }}>
                <Button loading={loading} onClick={() => setPage((p) => p + 1)}>
                  加载更多
                </Button>
              </div>
            )}
          </>
        )}
      </Spin>
    </div>
  );
}
