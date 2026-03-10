import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Typography,
  Tabs,
  Row,
  Col,
  Input,
  Avatar,
  Spin,
  Empty,
  Button,
  message,
} from 'antd';
import {
  HeartOutlined,
  MessageOutlined,
  PlayCircleOutlined,
  SearchOutlined,
  EyeOutlined,
  UserOutlined,
  FireOutlined,
  StarOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { communityApi } from '../../api/community';
import { useAuth } from '../../store/AuthContext';

const { Text, Paragraph } = Typography;

const categoryTags = ['全部', '计算机', '人工智能', '文学', '经济', '历史', '哲学', '其他'];

const CARD_GRADIENTS = [
  'linear-gradient(135deg, #5b4fd4 0%, #8b5cf6 100%)',
  'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
  'linear-gradient(135deg, #2dce89 0%, #11cdef 100%)',
  'linear-gradient(135deg, #f43f5e 0%, #fb923c 100%)',
  'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
  'linear-gradient(135deg, #0f766e 0%, #2dce89 100%)',
];

function LectureCard({ doc }) {
  const navigate = useNavigate();
  const [hovered, setHovered] = useState(false);
  const gradIdx = doc.id % CARD_GRADIENTS.length;

  return (
    <div
      className="community-card"
      onClick={() => navigate(`/community/${doc.id}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        borderRadius: 14,
        overflow: 'hidden',
        background: '#fff',
        border: '1px solid rgba(226,234,243,0.8)',
        boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
      }}
    >
      {/* Cover */}
      <div style={{
        height: 148,
        background: CARD_GRADIENTS[gradIdx],
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{
          position: 'absolute', inset: 0,
          background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(0,0,0,0.15) 100%)',
          pointerEvents: 'none',
        }} />

        {doc.cover_url && (
          <img
            src={(() => {
              const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
              return doc.cover_url.startsWith('http')
                ? doc.cover_url
                : `${BASE}${doc.cover_url}`;
            })()}
            alt={doc.title}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        )}

        {!doc.cover_url && (
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center',
          }}>
            <PlayCircleOutlined style={{ fontSize: 44, color: 'rgba(255,255,255,0.85)' }} />
          </div>
        )}

        {/* Hover summary overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          background: 'rgba(10,15,25,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 14, zIndex: 2,
          opacity: hovered && doc.summary ? 1 : 0,
          transition: 'opacity 0.25s ease',
        }}>
          <Text style={{ color: 'rgba(255,255,255,0.9)', fontSize: 12, lineHeight: 1.6, textAlign: 'center' }}>
            {doc.summary?.slice(0, 100)}{doc.summary?.length > 100 ? '...' : ''}
          </Text>
        </div>

        {/* Play count badge */}
        <div style={{
          position: 'absolute', bottom: 8, right: 8,
          background: 'rgba(0,0,0,0.4)', color: '#fff',
          borderRadius: 8, fontSize: 11, padding: '2px 8px',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          <EyeOutlined style={{ fontSize: 10 }} /> {doc.play_count || 0}
        </div>
      </div>

      {/* Body */}
      <div style={{ padding: '12px 14px 14px' }}>
        <Paragraph
          ellipsis={{ rows: 2 }}
          style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, minHeight: 40, color: '#1a2332', lineHeight: 1.5 }}
        >
          {doc.title}
        </Paragraph>

        {doc.tags?.length > 0 && (
          <div style={{ marginBottom: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
            {doc.tags.slice(0, 2).map((t) => (
              <span key={t} style={{
                padding: '1px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                background: 'rgba(45,206,137,0.1)', color: '#2dce89',
              }}>
                {t}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {doc.owner && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Avatar size={18} icon={<UserOutlined />} src={doc.owner?.avatar_url} style={{ backgroundColor: '#2dce89' }} />
              <Text style={{ fontSize: 12, color: '#8896a8' }}>{doc.owner?.username}</Text>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 12, color: '#aab4be', display: 'flex', alignItems: 'center', gap: 3 }}>
              <HeartOutlined style={{ fontSize: 11 }} /> {doc.like_count || 0}
            </span>
            <span style={{ fontSize: 12, color: '#aab4be', display: 'flex', alignItems: 'center', gap: 3 }}>
              <MessageOutlined style={{ fontSize: 11 }} /> {doc.comment_count || 0}
            </span>
          </div>
        </div>
      </div>
    </div>
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
    { key: 'recommend', label: <span><StarOutlined /> 推荐</span> },
    { key: 'latest', label: '最新' },
    { key: 'hot', label: <span><FireOutlined /> 热门</span> },
    ...(user ? [{ key: 'mine', label: '我的发布' }] : []),
  ];

  return (
    <div className="fade-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
      {/* Header */}
      <div style={{
        marginBottom: 24,
        display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
        flexWrap: 'wrap', gap: 12,
      }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 800, color: '#1a2332', letterSpacing: '-0.5px', marginBottom: 4 }}>
            知识社区
          </div>
          <Text style={{ color: '#8896a8', fontSize: 13 }}>发现优质讲解，与他人共同学习成长</Text>
        </div>
        <Input
          placeholder="搜索讲解..."
          prefix={<SearchOutlined style={{ color: '#aab4be' }} />}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: 220, borderRadius: 10 }}
          allowClear
        />
      </div>

      {/* Tabs + tag filters */}
      <div style={{ marginBottom: 16 }}>
        <Tabs
          activeKey={sort}
          onChange={setSort}
          items={tabItems}
          style={{ marginBottom: 12 }}
        />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {categoryTags.map((t) => (
            <button
              key={t}
              onClick={() => setSelectedTag(t)}
              style={{
                padding: '5px 14px', borderRadius: 20, fontSize: 13,
                border: selectedTag === t ? '1px solid #2dce89' : '1px solid #e2eaf3',
                background: selectedTag === t
                  ? 'linear-gradient(135deg, rgba(45,206,137,0.15), rgba(17,205,239,0.08))'
                  : 'rgba(255,255,255,0.8)',
                color: selectedTag === t ? '#2dce89' : '#5a6a7e',
                fontWeight: selectedTag === t ? 600 : 400,
                cursor: 'pointer',
                transition: 'all 0.2s ease',
              }}
            >
              {t}
            </button>
          ))}
        </div>
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
                <Button
                  loading={loading}
                  onClick={() => setPage((p) => p + 1)}
                  style={{
                    borderRadius: 20, height: 38, paddingInline: 28,
                    border: '1px solid rgba(45,206,137,0.4)', color: '#2dce89',
                    fontWeight: 500,
                  }}
                >
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
