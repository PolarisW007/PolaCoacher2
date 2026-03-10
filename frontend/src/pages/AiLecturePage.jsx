import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Row,
  Col,
  Button,
  Empty,
  Spin,
  Pagination,
  message,
  Typography,
  Card,
} from 'antd';
import {
  PlayCircleOutlined,
  FileTextOutlined,
  CalendarOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { docApi } from '../api/documents';
import dayjs from 'dayjs';

const { Text } = Typography;

const CARD_GRADIENTS = [
  'linear-gradient(135deg, #5b4fd4 0%, #8b5cf6 100%)',
  'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)',
  'linear-gradient(135deg, #2dce89 0%, #11cdef 100%)',
  'linear-gradient(135deg, #f43f5e 0%, #fb923c 100%)',
  'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
  'linear-gradient(135deg, #0f766e 0%, #2dce89 100%)',
];

export default function AiLecturePage() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 20;

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const res = await docApi.list({ status: 'ready', page, page_size: pageSize });
      const items = (res.data.items || []).filter((d) => d.lecture_slides);
      setDocs(items);
      setTotal(items.length < pageSize ? (page - 1) * pageSize + items.length : res.data.total || 0);
    } catch (err) {
      message.error('加载失败：' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [page]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  return (
    <div className="fade-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#1a2332', letterSpacing: '-0.5px', marginBottom: 4 }}>
          AI 讲堂
        </div>
        <Text style={{ color: '#8896a8', fontSize: 13 }}>已生成讲解的文档，快速进入播放器</Text>
      </div>

      <Spin spinning={loading}>
        {docs.length === 0 && !loading ? (
          <Card style={{ borderRadius: 14, textAlign: 'center', padding: 48, border: '1px solid rgba(226,234,243,0.8)' }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={<Text style={{ color: '#8896a8' }}>还没有生成讲解的文档，去书架上传文档并生成 AI 讲解吧</Text>}
            >
              <Button
                type="primary"
                onClick={() => navigate('/')}
                style={{
                  background: 'linear-gradient(135deg, #2dce89, #11cdef)',
                  border: 'none', borderRadius: 10,
                  boxShadow: '0 4px 12px rgba(45,206,137,0.3)',
                }}
              >
                前往书架
              </Button>
            </Empty>
          </Card>
        ) : (
          <>
            <Row gutter={[20, 20]}>
              {docs.map((doc, idx) => {
                const gradIdx = idx % CARD_GRADIENTS.length;
                return (
                  <Col xs={24} sm={12} md={8} lg={6} key={doc.id}>
                    <div
                      className="neon-card"
                      style={{
                        borderRadius: 14, overflow: 'hidden', background: '#fff',
                        cursor: 'pointer', height: '100%',
                      }}
                      onClick={() => navigate(`/study/${doc.id}`)}
                    >
                      {/* Cover */}
                      <div style={{
                        height: 120, background: CARD_GRADIENTS[gradIdx],
                        position: 'relative', overflow: 'hidden',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <div style={{
                          position: 'absolute', inset: 0,
                          background: 'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, transparent 50%, rgba(0,0,0,0.15) 100%)',
                        }} />
                        {doc.cover_url ? (
                          <img
                            src={(() => {
                              const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
                              return doc.cover_url.startsWith('http') ? doc.cover_url : `${BASE}${doc.cover_url}`;
                            })()}
                            alt={doc.title}
                            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => { e.target.style.display = 'none'; }}
                          />
                        ) : (
                          <PlayCircleOutlined style={{ fontSize: 40, color: 'rgba(255,255,255,0.85)', position: 'relative', zIndex: 1 }} />
                        )}
                        <div style={{
                          position: 'absolute', top: 8, right: 8,
                          background: 'rgba(45,206,137,0.85)', color: '#fff',
                          borderRadius: 6, fontSize: 10, padding: '2px 7px',
                          fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3,
                        }}>
                          <ThunderboltOutlined style={{ fontSize: 10 }} /> AI讲解
                        </div>
                      </div>

                      {/* Body */}
                      <div style={{ padding: '12px 14px 14px' }}>
                        <Text
                          ellipsis={{ tooltip: doc.title }}
                          strong
                          style={{ display: 'block', marginBottom: 10, color: '#1a2332', fontSize: 13, lineHeight: 1.5 }}
                        >
                          {doc.title}
                        </Text>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                          <span style={{ fontSize: 12, color: '#8896a8', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <FileTextOutlined style={{ fontSize: 11 }} /> {doc.page_count || 0} 页
                          </span>
                          <span style={{ fontSize: 11, color: '#aab4be', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <CalendarOutlined style={{ fontSize: 10 }} /> {dayjs(doc.created_at).format('MM-DD')}
                          </span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); navigate(`/study/${doc.id}`); }}
                          style={{
                            width: '100%', height: 34, borderRadius: 8,
                            background: 'linear-gradient(135deg, #2dce89, #11cdef)',
                            border: 'none', color: '#fff', fontWeight: 600, fontSize: 13,
                            cursor: 'pointer', display: 'flex', alignItems: 'center',
                            justifyContent: 'center', gap: 6,
                            boxShadow: '0 3px 10px rgba(45,206,137,0.3)',
                          }}
                        >
                          <PlayCircleOutlined /> 进入播放
                        </button>
                      </div>
                    </div>
                  </Col>
                );
              })}
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
          </>
        )}
      </Spin>
    </div>
  );
}
