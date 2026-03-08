import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography,
  Card,
  Row,
  Col,
  Button,
  Empty,
  Spin,
  Pagination,
  message,
} from 'antd';
import {
  PlayCircleOutlined,
  FileTextOutlined,
  CalendarOutlined,
} from '@ant-design/icons';
import { docApi } from '../api/documents';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

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

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  return (
    <div className="fade-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 32 }}>
        <Title level={2} style={{ margin: 0 }}>
          AI 讲堂
        </Title>
        <Text type="secondary" style={{ fontSize: 15 }}>
          已生成讲解的文档，快速进入播放器
        </Text>
      </div>

      <Spin spinning={loading}>
        {docs.length === 0 && !loading ? (
          <Card style={{ borderRadius: 12, textAlign: 'center', padding: 48 }}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Text type="secondary">
                  还没有生成讲解的文档，去书架上传文档并生成 AI 讲解吧
                </Text>
              }
            >
              <Button type="primary" onClick={() => navigate('/bookshelf')}>
                前往书架
              </Button>
            </Empty>
          </Card>
        ) : (
          <>
            <Row gutter={[20, 20]}>
              {docs.map((doc) => (
                <Col xs={24} sm={12} md={8} lg={6} key={doc.id}>
                  <Card
                    className="card-hover"
                    hoverable
                    style={{ borderRadius: 12, height: '100%' }}
                    onClick={() => navigate(`/study/${doc.id}`)}
                    actions={[
                      <Button
                        key="play"
                        type="link"
                        icon={<PlayCircleOutlined />}
                        style={{ color: '#2dce89' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/study/${doc.id}`);
                        }}
                      >
                        进入播放
                      </Button>,
                    ]}
                  >
                    <Card.Meta
                      title={
                        <Text ellipsis={{ tooltip: doc.title }} strong>
                          {doc.title}
                        </Text>
                      }
                      description={
                        <div style={{ marginTop: 12 }}>
                          <div style={{ marginBottom: 6, color: '#636e72' }}>
                            <FileTextOutlined style={{ marginRight: 6 }} />
                            {doc.page_count || 0} 页
                          </div>
                          <div style={{ color: '#b2bec3' }}>
                            <CalendarOutlined style={{ marginRight: 6 }} />
                            {dayjs(doc.created_at).format('YYYY-MM-DD')}
                          </div>
                        </div>
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
          </>
        )}
      </Spin>
    </div>
  );
}
