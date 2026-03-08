import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Card, Typography, Spin, Tag, Button, Space, Divider, Empty, List,
  Input, message, Tooltip, Badge, Popover, Select, Drawer,
} from 'antd';
import {
  ArrowLeftOutlined, BookOutlined, FileTextOutlined, BulbOutlined,
  PlayCircleOutlined, SoundOutlined, ReadOutlined, MessageOutlined,
  SendOutlined, DeleteOutlined, PlusOutlined, TranslationOutlined,
  EditOutlined, CloseOutlined, MenuFoldOutlined, MenuUnfoldOutlined,
} from '@ant-design/icons';
import { docApi, analysisApi, historyApi } from '../../api/documents';
import PdfViewer from '../../components/PdfViewer';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

export default function DocumentReader() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('summary');
  const [generating, setGenerating] = useState(false);

  // AI Chat state
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const chatEndRef = useRef(null);

  // Notes state
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [noteHighlight, setNoteHighlight] = useState('');
  const [notePage, setNotePage] = useState(1);
  const [addingNote, setAddingNote] = useState(false);

  // Translate state
  const [translatePopover, setTranslatePopover] = useState({ visible: false, x: 0, y: 0, text: '' });
  const [translatedText, setTranslatedText] = useState('');
  const [translating, setTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState('zh');

  const pageStartTime = useRef(Date.now());

  const fetchDoc = useCallback(async () => {
    try {
      const res = await docApi.get(id);
      setDoc(res.data);
    } catch {
      message.error('文档加载失败');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDoc();
  }, [fetchDoc]);

  useEffect(() => {
    historyApi.record({ document_id: id, action: 'read', last_page: 0, duration_seconds: 0 }).catch(() => {});

    return () => {
      const seconds = Math.round((Date.now() - pageStartTime.current) / 1000);
      historyApi.record({ document_id: id, action: 'read', last_page: 0, duration_seconds: seconds }).catch(() => {});
    };
  }, [id]);

  useEffect(() => {
    if (!doc) return;
    if (doc.status === 'processing' || doc.status === 'pending') {
      const timer = setInterval(fetchDoc, 3000);
      return () => clearInterval(timer);
    }
  }, [doc, fetchDoc]);

  // Notes fetching
  const fetchNotes = useCallback(async () => {
    setNotesLoading(true);
    try {
      const res = await docApi.listNotes(id);
      setNotes(res.data || []);
    } catch {
      // silent
    } finally {
      setNotesLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (activeTab === 'notes') fetchNotes();
  }, [activeTab, fetchNotes]);

  // Chat history
  const loadChatHistory = useCallback(async (sid) => {
    if (!sid) return;
    try {
      const res = await docApi.chatHistory(id, { session_id: sid });
      const history = res.data?.messages || res.data || [];
      setChatMessages(history.map((m) => ({
        role: m.role,
        content: m.content || m.answer || m.question,
      })));
    } catch {
      // silent
    }
  }, [id]);

  useEffect(() => {
    if (chatOpen && sessionId) loadChatHistory(sessionId);
  }, [chatOpen, sessionId, loadChatHistory]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // Text selection for translate
  useEffect(() => {
    const handleMouseUp = (e) => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (text && text.length > 0 && text.length < 2000) {
        setTranslatePopover({ visible: true, x: e.clientX, y: e.clientY, text });
        setTranslatedText('');
      }
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, []);

  const handleTranslate = async () => {
    setTranslating(true);
    try {
      const res = await analysisApi.translate({
        text: translatePopover.text,
        source_lang: 'auto',
        target_lang: targetLang,
      });
      setTranslatedText(res.data?.translated_text || res.data?.result || JSON.stringify(res.data));
    } catch {
      message.error('翻译失败');
    } finally {
      setTranslating(false);
    }
  };

  const lectureTimerRef = useRef(null);
  const lectureTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (lectureTimerRef.current) clearInterval(lectureTimerRef.current);
      if (lectureTimeoutRef.current) clearTimeout(lectureTimeoutRef.current);
    };
  }, []);

  const handleGenerateLecture = async () => {
    setGenerating(true);
    try {
      await docApi.generateLecture(id);
      message.success('讲解生成已启动，请稍候...');
      if (lectureTimerRef.current) clearInterval(lectureTimerRef.current);
      if (lectureTimeoutRef.current) clearTimeout(lectureTimeoutRef.current);

      lectureTimerRef.current = setInterval(async () => {
        try {
          const res = await docApi.get(id);
          setDoc(res.data);
          if (res.data.lecture_slides && res.data.lecture_slides.length > 0) {
            clearInterval(lectureTimerRef.current);
            lectureTimerRef.current = null;
            if (lectureTimeoutRef.current) { clearTimeout(lectureTimeoutRef.current); lectureTimeoutRef.current = null; }
            setGenerating(false);
            message.success('讲解生成完成！');
          }
        } catch { /* ignore polling errors */ }
      }, 3000);
      lectureTimeoutRef.current = setTimeout(() => {
        if (lectureTimerRef.current) { clearInterval(lectureTimerRef.current); lectureTimerRef.current = null; }
        setGenerating(false);
      }, 120000);
    } catch (err) {
      message.error(err.message || '生成失败');
      setGenerating(false);
    }
  };

  const handleSendChat = async () => {
    const question = chatInput.trim();
    if (!question) return;
    setChatMessages((prev) => [...prev, { role: 'user', content: question }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await docApi.chat(id, { question, session_id: sessionId });
      const data = res.data;
      if (data.session_id && !sessionId) setSessionId(data.session_id);
      setChatMessages((prev) => [...prev, { role: 'assistant', content: data.answer }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: '抱歉，回答失败，请重试。' }]);
    } finally {
      setChatLoading(false);
    }
  };

  const handleNewSession = () => {
    setSessionId(null);
    setChatMessages([]);
  };

  const handleAddNote = async () => {
    if (!noteContent.trim()) { message.warning('请输入笔记内容'); return; }
    setAddingNote(true);
    try {
      await docApi.createNote(id, {
        page_number: notePage,
        content: noteContent.trim(),
        highlight_text: noteHighlight.trim() || undefined,
      });
      message.success('笔记已添加');
      setNoteContent('');
      setNoteHighlight('');
      fetchNotes();
    } catch {
      message.error('添加笔记失败');
    } finally {
      setAddingNote(false);
    }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await docApi.deleteNote(noteId);
      message.success('笔记已删除');
      fetchNotes();
    } catch {
      message.error('删除失败');
    }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <Spin size="large" tip="加载文档中..." />
      </div>
    );
  }

  if (!doc) {
    return <Empty description="文档不存在" style={{ marginTop: 120 }} />;
  }

  const isProcessing = doc.status === 'processing' || doc.status === 'pending';
  const hasLecture = doc.lecture_slides && doc.lecture_slides.length > 0;
  const hasPpt = doc.ppt_content && doc.ppt_content.length > 0;
  const pdfUrl = docApi.getPdf(id);

  const tabs = [
    { key: 'summary', label: 'AI 摘要', icon: <ReadOutlined /> },
    { key: 'keypoints', label: '知识点', icon: <BulbOutlined /> },
    { key: 'outline', label: 'PPT 大纲', icon: <FileTextOutlined /> },
    { key: 'notes', label: '阅读笔记', icon: <EditOutlined /> },
  ];

  const translatePopoverContent = (
    <div style={{ maxWidth: 360 }}>
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>选中文本：</Text>
        <Paragraph
          ellipsis={{ rows: 3 }}
          style={{ margin: '4px 0', fontSize: 13, background: '#fffbe6', padding: '4px 8px', borderRadius: 4 }}
        >
          {translatePopover.text}
        </Paragraph>
      </div>
      <Space style={{ marginBottom: 8 }}>
        <Text style={{ fontSize: 12 }}>目标语言：</Text>
        <Select
          size="small"
          value={targetLang}
          onChange={setTargetLang}
          style={{ width: 100 }}
          options={[
            { value: 'zh', label: '中文' },
            { value: 'en', label: 'English' },
            { value: 'ja', label: '日本語' },
            { value: 'ko', label: '한국어' },
            { value: 'fr', label: 'Français' },
            { value: 'de', label: 'Deutsch' },
          ]}
        />
        <Button size="small" type="primary" icon={<TranslationOutlined />} loading={translating} onClick={handleTranslate}>
          翻译
        </Button>
      </Space>
      {translatedText && (
        <div style={{ background: '#f0f5ff', padding: '8px 12px', borderRadius: 6, fontSize: 13, lineHeight: 1.6 }}>
          {translatedText}
        </div>
      )}
    </div>
  );

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 20px', borderBottom: '1px solid #f0f0f0', background: '#fff',
          flexShrink: 0, zIndex: 10,
        }}
      >
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>返回书架</Button>
          <Title level={4} style={{ margin: 0, maxWidth: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {doc.title}
          </Title>
          <Tag color={doc.status === 'ready' ? 'green' : doc.status === 'processing' ? 'blue' : 'default'}>
            {doc.status === 'ready' ? '已就绪' : doc.status === 'processing' ? '处理中' : doc.status}
          </Tag>
        </Space>
        <Space>
          <Tooltip title={chatOpen ? '关闭 AI 对话' : '打开 AI 对话'}>
            <Button
              type={chatOpen ? 'primary' : 'default'}
              icon={chatOpen ? <MenuFoldOutlined /> : <MessageOutlined />}
              onClick={() => setChatOpen(!chatOpen)}
            >
              AI 对话
            </Button>
          </Tooltip>
          {hasLecture ? (
            <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => navigate(`/play/${id}`)}>
              进入讲解播放
            </Button>
          ) : hasPpt ? (
            <Button type="primary" icon={<SoundOutlined />} loading={generating} onClick={handleGenerateLecture}>
              {generating ? '生成中...' : '生成 AI 讲解'}
            </Button>
          ) : null}
        </Space>
      </div>

      {/* Processing banner */}
      {isProcessing && (
        <div style={{
          background: 'linear-gradient(135deg, #e8faf0, #e0f7fa)', padding: '12px 20px',
          textAlign: 'center', flexShrink: 0,
        }}>
          <Spin size="small" style={{ marginRight: 8 }} />
          <Text strong>AI 正在分析文档...</Text>
          <Text type="secondary" style={{ marginLeft: 8 }}>进度: {Math.round(doc.progress || 0)}%</Text>
        </div>
      )}

      {/* Doc meta bar */}
      <div style={{
        padding: '8px 20px', borderBottom: '1px solid #f0f0f0', background: '#fafafa', flexShrink: 0,
      }}>
        <Space size={24} wrap>
          <Text type="secondary" style={{ fontSize: 12 }}><BookOutlined /> {doc.filename}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>格式: {doc.file_type?.toUpperCase()}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>页数: {doc.page_count || '-'}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>字数: {doc.word_count ? `${(doc.word_count / 1000).toFixed(1)}K` : '-'}</Text>
          {doc.author && <Text type="secondary" style={{ fontSize: 12 }}>作者: {doc.author}</Text>}
        </Space>
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left: PDF Preview */}
        <div style={{
          width: '40%', minWidth: 300, borderRight: '1px solid #f0f0f0',
          display: 'flex', flexDirection: 'column', background: '#525659',
          overflow: 'hidden',
        }}>
          <PdfViewer url={pdfUrl} height="100%" />
        </div>

        {/* Middle: Tabs content */}
        <div style={{
          flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden',
          minWidth: 0, background: '#fff',
        }}>
          {/* Tab buttons */}
          <div style={{
            display: 'flex', gap: 6, padding: '10px 16px', borderBottom: '1px solid #f0f0f0',
            flexShrink: 0, flexWrap: 'wrap',
          }}>
            {tabs.map((tab) => (
              <Button
                key={tab.key}
                type={activeTab === tab.key ? 'primary' : 'default'}
                icon={tab.icon}
                size="small"
                onClick={() => setActiveTab(tab.key)}
                style={{ borderRadius: 6 }}
              >
                {tab.label}
              </Button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
            {activeTab === 'summary' && (
              <Card title="AI 生成摘要" style={{ borderRadius: 12 }} size="small">
                {doc.summary ? (
                  <Paragraph style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                    {doc.summary}
                  </Paragraph>
                ) : (
                  <Empty description={isProcessing ? 'AI 正在生成摘要...' : '暂无摘要'} />
                )}
              </Card>
            )}

            {activeTab === 'keypoints' && (
              <Card title="关键知识点" style={{ borderRadius: 12 }} size="small">
                {doc.key_points && doc.key_points.length > 0 ? (
                  <List
                    dataSource={Array.isArray(doc.key_points) ? doc.key_points : [doc.key_points]}
                    renderItem={(item, idx) => (
                      <List.Item style={{ padding: '10px 0' }}>
                        <Space align="start">
                          <Badge count={idx + 1} style={{ backgroundColor: '#2dce89', fontSize: 12, minWidth: 24 }} />
                          <Text style={{ fontSize: 13 }}>{typeof item === 'string' ? item : JSON.stringify(item)}</Text>
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
              <Card title="PPT 内容大纲" style={{ borderRadius: 12 }} size="small">
                {hasPpt ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
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
                            <li key={pi} style={{ marginBottom: 4, lineHeight: 1.6 }}>
                              <Text style={{ fontSize: 13 }}>{p}</Text>
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

            {activeTab === 'notes' && (
              <div>
                {/* Add note form */}
                <Card
                  title="添加笔记"
                  size="small"
                  style={{ borderRadius: 12, marginBottom: 16 }}
                >
                  <Space direction="vertical" style={{ width: '100%' }} size={8}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Text style={{ fontSize: 13, whiteSpace: 'nowrap' }}>页码：</Text>
                      <Input
                        type="number"
                        min={1}
                        value={notePage}
                        onChange={(e) => setNotePage(Number(e.target.value) || 1)}
                        style={{ width: 80 }}
                        size="small"
                      />
                    </div>
                    <TextArea
                      placeholder="输入高亮文本（可选）"
                      value={noteHighlight}
                      onChange={(e) => setNoteHighlight(e.target.value)}
                      rows={1}
                      style={{ fontSize: 13 }}
                    />
                    <TextArea
                      placeholder="输入笔记内容..."
                      value={noteContent}
                      onChange={(e) => setNoteContent(e.target.value)}
                      rows={3}
                      style={{ fontSize: 13 }}
                    />
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      loading={addingNote}
                      onClick={handleAddNote}
                      size="small"
                    >
                      添加笔记
                    </Button>
                  </Space>
                </Card>

                {/* Notes list */}
                <Card title={`我的笔记 (${notes.length})`} size="small" style={{ borderRadius: 12 }}>
                  {notesLoading ? (
                    <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
                  ) : notes.length > 0 ? (
                    <List
                      dataSource={notes}
                      renderItem={(note) => (
                        <List.Item
                          actions={[
                            <Button
                              key="del"
                              type="text"
                              danger
                              size="small"
                              icon={<DeleteOutlined />}
                              onClick={() => handleDeleteNote(note.id)}
                            />,
                          ]}
                        >
                          <List.Item.Meta
                            title={
                              <Space>
                                {note.page_number && <Tag color="blue">P{note.page_number}</Tag>}
                                <Text style={{ fontSize: 13 }}>{note.content}</Text>
                              </Space>
                            }
                            description={
                              note.highlight_text && (
                                <Text
                                  type="secondary"
                                  style={{
                                    fontSize: 12, background: '#fffbe6',
                                    padding: '2px 6px', borderRadius: 3, display: 'inline-block', marginTop: 4,
                                  }}
                                >
                                  "{note.highlight_text}"
                                </Text>
                              )
                            }
                          />
                        </List.Item>
                      )}
                    />
                  ) : (
                    <Empty description="暂无笔记" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  )}
                </Card>
              </div>
            )}
          </div>
        </div>

        {/* Right: AI Chat Sidebar */}
        {chatOpen && (
          <div style={{
            width: 340, borderLeft: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column',
            background: '#fff', flexShrink: 0,
          }}>
            {/* Chat header */}
            <div style={{
              padding: '10px 14px', borderBottom: '1px solid #f0f0f0',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
            }}>
              <Space>
                <MessageOutlined style={{ color: '#1890ff' }} />
                <Text strong style={{ fontSize: 14 }}>AI 文档问答</Text>
              </Space>
              <Space size={4}>
                <Tooltip title="新对话">
                  <Button size="small" type="text" icon={<PlusOutlined />} onClick={handleNewSession} />
                </Tooltip>
                <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setChatOpen(false)} />
              </Space>
            </div>

            {/* Messages area */}
            <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>
              {chatMessages.length === 0 && (
                <div style={{ textAlign: 'center', marginTop: 60, color: '#999' }}>
                  <MessageOutlined style={{ fontSize: 36, color: '#d9d9d9', marginBottom: 12 }} />
                  <div style={{ fontSize: 13 }}>针对文档内容提问</div>
                  <div style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>AI 将基于文档内容为你解答</div>
                </div>
              )}
              {chatMessages.map((msg, idx) => (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: 12,
                  }}
                >
                  <div style={{ display: 'flex', gap: 8, maxWidth: '88%', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                    <div
                      style={{
                        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: msg.role === 'user' ? '#1890ff' : '#f0f0f0',
                        color: msg.role === 'user' ? '#fff' : '#666',
                        fontSize: 13, fontWeight: 600,
                      }}
                    >
                      {msg.role === 'user' ? '我' : 'AI'}
                    </div>
                    <div
                      style={{
                        padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.7,
                        background: msg.role === 'user' ? '#1890ff' : '#f5f5f5',
                        color: msg.role === 'user' ? '#fff' : '#333',
                        wordBreak: 'break-word',
                      }}
                    >
                      {msg.content}
                    </div>
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                  <div
                    style={{
                      width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      background: '#f0f0f0', color: '#666', fontSize: 13, fontWeight: 600,
                    }}
                  >
                    AI
                  </div>
                  <div style={{ padding: '8px 12px', borderRadius: 10, background: '#f5f5f5' }}>
                    <Spin size="small" />
                    <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>思考中...</Text>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div style={{
              padding: '10px 14px', borderTop: '1px solid #f0f0f0', flexShrink: 0,
              background: '#fafafa',
            }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  placeholder="输入问题..."
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                  disabled={chatLoading}
                  style={{ borderRadius: 8 }}
                />
                <Button
                  type="primary"
                  icon={<SendOutlined />}
                  onClick={handleSendChat}
                  loading={chatLoading}
                  disabled={!chatInput.trim()}
                  style={{ borderRadius: 8 }}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Floating translate popover */}
      {translatePopover.visible && (
        <div
          style={{
            position: 'fixed',
            left: Math.min(translatePopover.x, window.innerWidth - 400),
            top: translatePopover.y + 10,
            zIndex: 1050,
            background: '#fff',
            borderRadius: 10,
            boxShadow: '0 6px 24px rgba(0,0,0,0.15)',
            padding: '12px 16px',
            maxWidth: 380,
            minWidth: 260,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Space>
              <TranslationOutlined style={{ color: '#1890ff' }} />
              <Text strong style={{ fontSize: 13 }}>划词翻译</Text>
            </Space>
            <Button
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={() => setTranslatePopover((p) => ({ ...p, visible: false }))}
            />
          </div>
          {translatePopoverContent}
        </div>
      )}
    </div>
  );
}
