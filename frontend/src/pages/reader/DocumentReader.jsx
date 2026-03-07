import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Typography, Spin, Tag, Button, Space, Divider, Empty, List,
  Input, message, Tooltip, Badge,
} from 'antd';
import {
  ArrowLeftOutlined, BookOutlined, FileTextOutlined, BulbOutlined,
  PlayCircleOutlined, SoundOutlined, ReadOutlined,
} from '@ant-design/icons';
import { docApi } from '../../api/documents';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export default function DocumentReader() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');
  const [generating, setGenerating] = useState(false);

  const fetchDoc = useCallback(async () => {
    try {
      const res = await docApi.get(id);
      setDoc(res.data);
    } catch (err) {
      message.error('文档加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  useEffect(() => {
    if (!doc) return;
    if (doc.status === 'processing' || doc.status === 'pending') {
      const timer = setInterval(fetchDoc, 3000);
      return () => clearInterval(timer);
    }
  }, [doc, fetchDoc]);

  const handleGenerateLecture = async () => {
    setGenerating(true);
    try {
      await docApi.generateLecture(id);
      message.success('讲解生成已启动，请稍候...');
      const timer = setInterval(async () => {
        const res = await docApi.get(id);
        setDoc(res.data);
        if (res.data.lecture_slides && res.data.lecture_slides.length > 0) {
          clearInterval(timer);
          setGenerating(false);
          message.success('讲解生成完成！');
        }
      }, 3000);
      setTimeout(() => { clearInterval(timer); setGenerating(false); }, 120000);
    } catch (err) {
      message.error(err.message || '生成失败');
      setGenerating(false);
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Spin size="large" tip="加载文档中..." />
      </div>
    );
  }

  if (!doc) {
    return <Empty description="文档不存在" />;
  }

  const isProcessing = doc.status === 'processing' || doc.status === 'pending';
  const hasLecture = doc.lecture_slides && doc.lecture_slides.length > 0;
  const hasPpt = doc.ppt_content && doc.ppt_content.length > 0;

  const tabs = [
    { key: 'summary', label: 'AI 摘要', icon: <ReadOutlined /> },
    { key: 'keypoints', label: '知识点', icon: <BulbOutlined /> },
    { key: 'outline', label: 'PPT 大纲', icon: <FileTextOutlined /> },
  ];

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>
      {/* 顶部导航 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>返回书架</Button>
          <Title level={4} style={{ margin: 0 }}>{doc.title}</Title>
          <Tag color={doc.status === 'ready' ? 'green' : doc.status === 'processing' ? 'blue' : 'default'}>
            {doc.status === 'ready' ? '已就绪' : doc.status === 'processing' ? '处理中' : doc.status}
          </Tag>
        </Space>
        <Space>
          {hasLecture ? (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => navigate(`/play/${id}`)}>
              进入讲解播放
            </Button>
          ) : hasPpt ? (
            <Button
              type="primary"
              icon={<SoundOutlined />}
              loading={generating}
              onClick={handleGenerateLecture}
            >
              {generating ? '生成中...' : '生成 AI 讲解'}
            </Button>
          ) : null}
        </Space>
      </div>

      {/* 处理进度 */}
      {isProcessing && (
        <Card style={{ marginBottom: 24, background: 'linear-gradient(135deg, #e8faf0, #e0f7fa)', border: 'none' }}>
          <div style={{ textAlign: 'center', padding: 16 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16 }}>
              <Text strong>AI 正在分析文档...</Text>
              <br />
              <Text type="secondary">进度: {Math.round(doc.progress)}%</Text>
            </div>
          </div>
        </Card>
      )}

      {/* 文档元信息 */}
      <Card size="small" style={{ marginBottom: 24 }}>
        <Space size={24} wrap>
          <Text type="secondary"><BookOutlined /> {doc.filename}</Text>
          <Text type="secondary">格式: {doc.file_type?.toUpperCase()}</Text>
          <Text type="secondary">页数: {doc.page_count || '-'}</Text>
          <Text type="secondary">字数: {doc.word_count ? `${(doc.word_count / 1000).toFixed(1)}K` : '-'}</Text>
          {doc.author && <Text type="secondary">作者: {doc.author}</Text>}
        </Space>
      </Card>

      {/* 内容标签页 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabs.map((tab) => (
          <Button
            key={tab.key}
            type={activeTab === tab.key ? 'primary' : 'default'}
            icon={tab.icon}
            onClick={() => setActiveTab(tab.key)}
            style={{ borderRadius: 8 }}
          >
            {tab.label}
          </Button>
        ))}
      </div>

      {/* 内容区域 */}
      {activeTab === 'summary' && (
        <Card title="AI 生成摘要" style={{ borderRadius: 12 }}>
          {doc.summary ? (
            <Paragraph style={{ fontSize: 15, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
              {doc.summary}
            </Paragraph>
          ) : (
            <Empty description={isProcessing ? 'AI 正在生成摘要...' : '暂无摘要'} />
          )}
        </Card>
      )}

      {activeTab === 'keypoints' && (
        <Card title="关键知识点" style={{ borderRadius: 12 }}>
          {doc.key_points && doc.key_points.length > 0 ? (
            <List
              dataSource={Array.isArray(doc.key_points) ? doc.key_points : [doc.key_points]}
              renderItem={(item, idx) => (
                <List.Item style={{ padding: '12px 0' }}>
                  <Space align="start">
                    <Badge
                      count={idx + 1}
                      style={{ backgroundColor: '#2dce89', fontSize: 12, minWidth: 24 }}
                    />
                    <Text style={{ fontSize: 14 }}>{typeof item === 'string' ? item : JSON.stringify(item)}</Text>
                  </Space>
                </List.Item>
              )}
            />
          ) : (
            <Empty description={isProcessing ? 'AI 正在提取知识点...' : '暂无知识点'} />
          )}
        </Card>
      )}

      {activeTab === 'outline' && (
        <Card title="PPT 内容大纲" style={{ borderRadius: 12 }}>
          {hasPpt ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              {doc.ppt_content.map((slide, idx) => (
                <Card
                  key={idx}
                  size="small"
                  type="inner"
                  title={
                    <Space>
                      <Tag color="blue">第 {slide.slide || idx + 1} 页</Tag>
                      <Text strong>{slide.title}</Text>
                    </Space>
                  }
                  style={{ borderRadius: 8 }}
                >
                  <ul style={{ margin: 0, paddingLeft: 20 }}>
                    {(slide.points || []).map((p, pi) => (
                      <li key={pi} style={{ marginBottom: 6, lineHeight: 1.6 }}>
                        <Text>{p}</Text>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          ) : (
            <Empty description={isProcessing ? 'AI 正在生成大纲...' : '暂无 PPT 大纲'} />
          )}
        </Card>
      )}
    </div>
  );
}
