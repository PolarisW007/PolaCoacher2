import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Spin, Empty, Button, Space, Typography, Tag, Card, Input, Divider,
  message, Tooltip, Badge,
} from 'antd';
import {
  ArrowLeftOutlined, LeftOutlined, RightOutlined,
  EditOutlined, BulbOutlined,
  BookOutlined, TranslationOutlined, SaveOutlined,
  GlobalOutlined, LockOutlined,
} from '@ant-design/icons';
import { docApi, lectureNoteApi } from '../../api/documents';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export default function DocumentPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const [showTranslation, setShowTranslation] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [notes, setNotes] = useState({});
  const [savingNote, setSavingNote] = useState(false);

  const saveTimerRef = useRef(null);

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

  const fetchNotes = useCallback(async () => {
    try {
      const res = await lectureNoteApi.list(id);
      const noteMap = {};
      if (res.data && Array.isArray(res.data)) {
        res.data.forEach((n) => { noteMap[n.page_number] = n.content; });
      }
      setNotes(noteMap);
    } catch { /* ignore */ }
  }, [id]);

  useEffect(() => {
    fetchDoc();
    fetchNotes();
  }, [fetchDoc, fetchNotes]);

  useEffect(() => {
    setNoteContent(notes[currentPage + 1] || '');
  }, [currentPage, notes]);

  const handleNoteChange = (val) => {
    setNoteContent(val);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNote(val), 1000);
  };

  const saveNote = async (content) => {
    setSavingNote(true);
    try {
      await lectureNoteApi.upsert(id, currentPage + 1, content);
      setNotes((prev) => ({ ...prev, [currentPage + 1]: content }));
    } catch { /* ignore */ }
    setSavingNote(false);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
        <Spin size="large" tip="加载讲解中..." />
      </div>
    );
  }

  if (!doc) return <Empty description="文档不存在" />;

  const slides = doc.lecture_slides || [];
  if (slides.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Card style={{ textAlign: 'center', borderRadius: 16, maxWidth: 500 }}>
          <Empty
            description="该文档尚未生成讲解内容"
            image={Empty.PRESENTED_IMAGE_SIMPLE}
          />
          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => navigate(`/reader/${id}`)}>返回阅读器</Button>
            <Button type="primary" onClick={() => navigate('/')}>返回书架</Button>
          </Space>
        </Card>
      </div>
    );
  }

  const slide = slides[currentPage] || {};
  const totalPages = slides.length;
  const hasPrev = currentPage > 0;
  const hasNext = currentPage < totalPages - 1;

  return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* 顶部控制栏 */}
      <div
        style={{
          padding: '8px 20px',
          background: '#fff',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <Space>
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/reader/${id}`)}>
            返回
          </Button>
          <Text strong style={{ fontSize: 15 }}>{doc.title}</Text>
          <Tag color={doc.lecture_visibility === 'public' ? 'green' : 'default'}>
            {doc.lecture_visibility === 'public' ? <><GlobalOutlined /> 公开</> : <><LockOutlined /> 私有</>}
          </Tag>
        </Space>
        <Space>
          <Tooltip title={showTranslation ? '隐藏译文' : '显示译文'}>
            <Button
              size="small"
              type={showTranslation ? 'primary' : 'default'}
              icon={<TranslationOutlined />}
              onClick={() => setShowTranslation(!showTranslation)}
            />
          </Tooltip>
          <Tooltip title={showNotes ? '收起备注' : '展开备注'}>
            <Button
              size="small"
              type={showNotes ? 'primary' : 'default'}
              icon={<EditOutlined />}
              onClick={() => setShowNotes(!showNotes)}
            >
              备注
            </Button>
          </Tooltip>
          <Text type="secondary">{currentPage + 1} / {totalPages}</Text>
        </Space>
      </div>

      {/* 三栏主体 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* 左栏 — 缩略图导航 */}
        <div
          style={{
            width: 160,
            flexShrink: 0,
            borderRight: '1px solid #f0f0f0',
            overflowY: 'auto',
            background: '#fafafa',
            padding: '8px 0',
          }}
        >
          {slides.map((s, idx) => (
            <div
              key={idx}
              onClick={() => setCurrentPage(idx)}
              style={{
                padding: '10px 12px',
                cursor: 'pointer',
                background: idx === currentPage ? '#e6fffb' : 'transparent',
                borderLeft: idx === currentPage ? '3px solid #2dce89' : '3px solid transparent',
                transition: 'all 0.2s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Badge
                  count={idx + 1}
                  style={{
                    backgroundColor: idx === currentPage ? '#2dce89' : '#d9d9d9',
                    fontSize: 11,
                    minWidth: 22,
                    height: 22,
                    lineHeight: '22px',
                  }}
                />
                <Text
                  ellipsis
                  style={{
                    fontSize: 12,
                    fontWeight: idx === currentPage ? 600 : 400,
                    color: idx === currentPage ? '#2dce89' : '#666',
                  }}
                >
                  {s.title || `第 ${idx + 1} 页`}
                </Text>
              </div>
              {notes[idx + 1] && (
                <EditOutlined style={{ fontSize: 10, color: '#faad14', marginLeft: 30, marginTop: 2 }} />
              )}
            </div>
          ))}
        </div>

        {/* 中栏 — 讲解内容 */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '24px 32px',
            background: '#fff',
          }}
        >
          {/* 页面标题 */}
          <div style={{ marginBottom: 20 }}>
            <Tag color="blue" style={{ marginBottom: 8 }}>
              第 {slide.slide || currentPage + 1} 页
            </Tag>
            <Title level={3} style={{ margin: 0 }}>
              {slide.title}
            </Title>
          </div>

          {/* 核心要点 */}
          {slide.points && slide.points.length > 0 && (
            <Card
              size="small"
              style={{
                marginBottom: 20,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #f6ffed 0%, #e6fffb 100%)',
                border: '1px solid #b7eb8f',
              }}
            >
              <Text strong style={{ color: '#52c41a', fontSize: 13 }}>
                <BulbOutlined /> 核心要点
              </Text>
              <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
                {slide.points.map((p, i) => (
                  <li key={i} style={{ marginBottom: 4, lineHeight: 1.6, fontSize: 14 }}>{p}</li>
                ))}
              </ul>
            </Card>
          )}

          {/* 讲解文本 */}
          <Card
            size="small"
            style={{ marginBottom: 20, borderRadius: 10 }}
            title={
              <Space>
                <BookOutlined style={{ color: '#1890ff' }} />
                <Text strong>AI 讲解</Text>
              </Space>
            }
          >
            <Paragraph
              style={{
                fontSize: 15,
                lineHeight: 2,
                whiteSpace: 'pre-wrap',
                color: '#333',
              }}
            >
              {slide.lecture_text || '暂无讲解内容'}
            </Paragraph>
          </Card>

          {/* 译文（可切换） */}
          {showTranslation && slide.translation && (
            <Card
              size="small"
              style={{
                marginBottom: 20,
                borderRadius: 10,
                background: '#fffbe6',
                border: '1px solid #ffe58f',
              }}
              title={
                <Space>
                  <TranslationOutlined style={{ color: '#faad14' }} />
                  <Text strong>Translation</Text>
                </Space>
              }
            >
              <Paragraph
                style={{
                  fontSize: 14,
                  lineHeight: 1.8,
                  whiteSpace: 'pre-wrap',
                  color: '#666',
                  fontStyle: 'italic',
                }}
              >
                {slide.translation}
              </Paragraph>
            </Card>
          )}

          {/* 原文摘录 */}
          {slide.page_text && (
            <Card
              size="small"
              style={{ borderRadius: 10, background: '#f9f9f9' }}
              title={<Text type="secondary" style={{ fontSize: 12 }}>原文摘录</Text>}
            >
              <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>
                {slide.page_text}
              </Text>
            </Card>
          )}

          {/* 翻页按钮 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: 32,
              paddingBottom: 24,
            }}
          >
            <Button
              disabled={!hasPrev}
              icon={<LeftOutlined />}
              onClick={() => setCurrentPage((p) => p - 1)}
            >
              上一页
            </Button>
            <Button
              disabled={!hasNext}
              type="primary"
              onClick={() => setCurrentPage((p) => p + 1)}
            >
              下一页 <RightOutlined />
            </Button>
          </div>
        </div>

        {/* 右栏 — 备注面板（可收起） */}
        {showNotes && (
          <div
            style={{
              width: 320,
              flexShrink: 0,
              borderLeft: '1px solid #f0f0f0',
              display: 'flex',
              flexDirection: 'column',
              background: '#fafafa',
            }}
          >
            <div
              style={{
                padding: '12px 16px',
                borderBottom: '1px solid #f0f0f0',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Text strong>
                <EditOutlined /> 第 {currentPage + 1} 页备注
              </Text>
              {savingNote ? (
                <Text type="secondary" style={{ fontSize: 12 }}>保存中...</Text>
              ) : (
                <Text type="success" style={{ fontSize: 12 }}>
                  <SaveOutlined /> 自动保存
                </Text>
              )}
            </div>
            <div style={{ flex: 1, padding: 12 }}>
              <TextArea
                value={noteContent}
                onChange={(e) => handleNoteChange(e.target.value)}
                placeholder="在这里记录你对本页的学习笔记、心得体会..."
                style={{
                  height: '100%',
                  resize: 'none',
                  border: 'none',
                  background: '#fff',
                  borderRadius: 8,
                  fontSize: 14,
                  lineHeight: 1.8,
                }}
                autoSize={false}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

