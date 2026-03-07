import { useState, useEffect, useCallback } from 'react';
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

  return (
    <Card
      className="card-hover"
      hoverable
      onClick={() => navigate(`/community/${doc.id}`)}
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
        }}
      >
        <PlayCircleOutlined style={{ fontSize: 40, color: 'rgba(255,255,255,0.9)' }} />
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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space size={12}>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <EyeOutlined /> {doc.play_count}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <HeartOutlined /> {doc.like_count}
          </Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            <MessageOutlined /> {doc.comment_count}
          </Text>
        </Space>
      </div>
    </Card>
  );
}

export default function CommunityPage() {
  const [lectures, setLectures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState('latest');
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState('全部');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const fetchLectures = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: 20, sort };
      if (search) params.search = search;
      if (selectedTag !== '全部') params.tag = selectedTag;
      const res = await communityApi.listLectures(params);
      setLectures(page === 1 ? res.data.items : (prev) => [...prev, ...res.data.items]);
      setTotal(res.data.total);
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, sort, search, selectedTag]);

  useEffect(() => {
    setPage(1);
  }, [sort, search, selectedTag]);

  useEffect(() => {
    fetchLectures();
  }, [fetchLectures]);

  const tabItems = [
    { key: 'latest', label: '最新' },
    { key: 'hot', label: '热门' },
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
