import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Spin, Empty, Button, Space, Typography, Tag, Tooltip,
  Input, message, List, Divider, Card, Badge,
} from 'antd';
import {
  ArrowLeftOutlined, MenuOutlined, FilePdfOutlined,
  BulbOutlined, ReadOutlined, MessageOutlined, EditOutlined,
  SendOutlined, PlusOutlined, DeleteOutlined, CloseOutlined,
  PlayCircleOutlined, LeftOutlined, RightOutlined,
  HighlightOutlined, CopyOutlined, RobotOutlined,
  FileTextOutlined, } from '@ant-design/icons';
import { docApi, historyApi } from '../../api/documents';
import PdfViewer from '../../components/PdfViewer';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

// ── 工具：把 API 返回的 key_points 统一成数组 ────────────────
function normalizeKeyPoints(kp) {
  if (!kp) return [];
  if (Array.isArray(kp)) return kp.map((p) => (typeof p === 'string' ? p : JSON.stringify(p)));
  if (typeof kp === 'string') return [kp];
  return [JSON.stringify(kp)];
}

// ── 划线颜色配置 ─────────────────────────────────────────────
const HIGHLIGHT_COLORS = [
  { key: 'yellow', label: '黄色', bg: '#fffb8f', border: '#fadb14' },
  { key: 'green',  label: '绿色', bg: '#b7eb8f', border: '#52c41a' },
  { key: 'blue',   label: '蓝色', bg: '#91d5ff', border: '#1890ff' },
  { key: 'pink',   label: '红色', bg: '#ffadd2', border: '#eb2f96' },
];

export default function DocumentReaderPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  // ── 文档数据 ──────────────────────────────────────────────
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── 视图模式：'pdf' | 'ai' ────────────────────────────────
  const [viewMode, setViewMode] = useState('pdf');

  // ── 目录面板 ──────────────────────────────────────────────
  const [tocOpen, setTocOpen] = useState(false);
  const [outline, setOutline] = useState([]);   // PDF outline 树

  // ── PDF 页码状态 ──────────────────────────────────────────
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const pdfGoToRef = useRef(null);  // 由 PdfViewer 注入的跳页函数

  // ── 右侧面板：null | 'ai' | 'notes' ──────────────────────
  const [rightPanel, setRightPanel] = useState(null);

  // ── AI 问书 ───────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const chatEndRef = useRef(null);

  // ── 笔记 ──────────────────────────────────────────────────
  const [notes, setNotes] = useState([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [noteHighlight, setNoteHighlight] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // ── 选中文字浮层 ──────────────────────────────────────────
  const [selectionBar, setSelectionBar] = useState(null); // { x, y, text, page }
  const [highlightColor, setHighlightColor] = useState('yellow');

  // ── 阅读计时 ──────────────────────────────────────────────
  const pageStartTime = useRef(Date.now());

  // ─────────────────────────────────────────────────────────
  // 加载文档
  // ─────────────────────────────────────────────────────────
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

  useEffect(() => { fetchDoc(); }, [fetchDoc]);

  // 文档处理中时轮询
  useEffect(() => {
    if (!doc) return;
    if (doc.status === 'processing' || doc.status === 'pending') {
      const timer = setInterval(fetchDoc, 3000);
      return () => clearInterval(timer);
    }
  }, [doc, fetchDoc]);

  // 记录阅读历史
  useEffect(() => {
    historyApi.record({ document_id: id, action: 'read', last_page: 0, duration_seconds: 0 }).catch(() => {});
    return () => {
      const seconds = Math.round((Date.now() - pageStartTime.current) / 1000);
      historyApi.record({ document_id: id, action: 'read', last_page: currentPage, duration_seconds: seconds }).catch(() => {});
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // 键盘翻页
  useEffect(() => {
    const handleKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        pdfGoToRef.current?.(currentPage + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        pdfGoToRef.current?.(currentPage - 1);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [currentPage]);

  // 文字选中监听
  useEffect(() => {
    const handleMouseUp = (e) => {
      // 如果点击发生在浮层自身上，不处理
      if (e.target.closest?.('[data-selection-bar]')) return;
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (text && text.length > 0 && text.length < 2000) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        setSelectionBar({
          x: rect.left + rect.width / 2,
          y: rect.top - 8,
          text,
          page: currentPage,
        });
      } else {
        setSelectionBar(null);
      }
    };
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [currentPage]);

  // 点击其他地方关闭浮层
  useEffect(() => {
    const handleClick = (e) => {
      if (!e.target.closest?.('[data-selection-bar]')) {
        setSelectionBar(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // chat 滚到底
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ─────────────────────────────────────────────────────────
  // 笔记操作
  // ─────────────────────────────────────────────────────────
  const fetchNotes = useCallback(async () => {
    setNotesLoading(true);
    try {
      const res = await docApi.listNotes(id);
      setNotes(res.data || []);
    } catch { /* silent */ } finally {
      setNotesLoading(false);
    }
  }, [id]);

  useEffect(() => {
    if (rightPanel === 'notes') fetchNotes();
  }, [rightPanel, fetchNotes]);

  const handleAddNote = async () => {
    if (!noteContent.trim()) { message.warning('请输入笔记内容'); return; }
    setAddingNote(true);
    try {
      await docApi.createNote(id, {
        page_number: currentPage,
        content: noteContent.trim(),
        highlight_text: noteHighlight.trim() || undefined,
      });
      message.success('笔记已保存');
      setNoteContent('');
      setNoteHighlight('');
      fetchNotes();
    } catch { message.error('添加笔记失败'); } finally { setAddingNote(false); }
  };

  const handleDeleteNote = async (noteId) => {
    try {
      await docApi.deleteNote(noteId);
      fetchNotes();
    } catch { message.error('删除失败'); }
  };

  // ─────────────────────────────────────────────────────────
  // AI 问书
  // ─────────────────────────────────────────────────────────
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
      setChatMessages((prev) => [...prev, { role: 'assistant', content: '回答失败，请重试。' }]);
    } finally { setChatLoading(false); }
  };

  // ─────────────────────────────────────────────────────────
  // 选中文字工具栏操作
  // ─────────────────────────────────────────────────────────
  const handleHighlight = async () => {
    if (!selectionBar) return;
    try {
      await docApi.createNote(id, {
        page_number: selectionBar.page,
        content: `[划线] ${selectionBar.text}`,
        highlight_text: selectionBar.text,
        highlight_color: highlightColor,
      });
      message.success('划线已保存');
      setSelectionBar(null);
      if (rightPanel === 'notes') fetchNotes();
    } catch { message.error('保存划线失败'); }
  };

  const handleCopyText = () => {
    if (!selectionBar) return;
    navigator.clipboard.writeText(selectionBar.text).then(() => {
      message.success('已复制');
      setSelectionBar(null);
    });
  };

  const handleAddNoteFromSelection = () => {
    if (!selectionBar) return;
    setNoteHighlight(selectionBar.text);
    setNoteContent('');
    setRightPanel('notes');
    setSelectionBar(null);
  };

  const handleAiExplain = () => {
    if (!selectionBar) return;
    const q = `请解释以下内容：「${selectionBar.text}」`;
    setChatMessages((prev) => [...prev, { role: 'user', content: q }]);
    setChatInput('');
    setRightPanel('ai');
    setSelectionBar(null);
    // 自动发送
    setChatLoading(true);
    docApi.chat(id, { question: q, session_id: sessionId }).then((res) => {
      const data = res.data;
      if (data.session_id && !sessionId) setSessionId(data.session_id);
      setChatMessages((prev) => [...prev, { role: 'assistant', content: data.answer }]);
    }).catch(() => {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: '解释失败，请重试。' }]);
    }).finally(() => setChatLoading(false));
  };

  // ─────────────────────────────────────────────────────────
  // 渲染
  // ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#f5f5f5' }}>
        <Spin size="large" tip="加载文档..." />
      </div>
    );
  }

  if (!doc) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <Empty description="文档不存在" extra={<Button onClick={() => navigate('/documents')}>返回文档库</Button>} />
      </div>
    );
  }

  const pdfUrl = docApi.getPdf(id);
  const isReady = doc.status === 'ready';
  const keyPoints = normalizeKeyPoints(doc.key_points);
  const hasPpt = doc.ppt_content?.length > 0;
  const hasLecture = doc.lecture_slides?.length > 0;

  // ── 顶栏 ─────────────────────────────────────────────────
  const renderTopBar = () => (
    <div style={{
      height: 52,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '0 16px',
      background: '#fff',
      borderBottom: '1px solid #f0f0f0',
      flexShrink: 0,
      zIndex: 50,
      gap: 12,
    }}>
      {/* 左侧：目录 + 返回 + 书名 */}
      <Space size={8} style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <Tooltip title="目录">
          <Button
            type={tocOpen ? 'primary' : 'text'}
            icon={<MenuOutlined />}
            size="small"
            onClick={() => setTocOpen((v) => !v)}
            style={{ flexShrink: 0 }}
          />
        </Tooltip>
        <Button
          type="text"
          icon={<ArrowLeftOutlined />}
          size="small"
          onClick={() => navigate('/documents')}
          style={{ flexShrink: 0 }}
        >
          文档库
        </Button>
        <Text
          strong
          style={{ fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 280 }}
          title={doc.title}
        >
          {doc.title}
        </Text>
        {doc.author && (
          <Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>
            {doc.author}
          </Text>
        )}
      </Space>

      {/* 中间：视图切换 */}
      <Space size={4} style={{ flexShrink: 0 }}>
        <Button
          type={viewMode === 'pdf' ? 'primary' : 'default'}
          icon={<FilePdfOutlined />}
          size="small"
          onClick={() => setViewMode('pdf')}
          style={{ borderRadius: 6 }}
        >
          PDF 原文
        </Button>
        <Button
          type={viewMode === 'ai' ? 'primary' : 'default'}
          icon={<BulbOutlined />}
          size="small"
          disabled={!isReady}
          onClick={() => setViewMode('ai')}
          style={{ borderRadius: 6 }}
        >
          AI 解析
        </Button>
      </Space>

      {/* 右侧：工具按钮 */}
      <Space size={4} style={{ flexShrink: 0 }}>
        {hasLecture && (
          <Tooltip title="AI 讲解播放">
            <Button
              type="text"
              icon={<PlayCircleOutlined style={{ color: '#2dce89' }} />}
              size="small"
              onClick={() => navigate(`/study/${id}`)}
            >
              <span style={{ color: '#2dce89', fontSize: 12 }}>讲解</span>
            </Button>
          </Tooltip>
        )}
        <Tooltip title={rightPanel === 'ai' ? '关闭 AI 问书' : 'AI 问书'}>
          <Button
            type={rightPanel === 'ai' ? 'primary' : 'text'}
            icon={<MessageOutlined />}
            size="small"
            onClick={() => setRightPanel((v) => v === 'ai' ? null : 'ai')}
          />
        </Tooltip>
        <Tooltip title={rightPanel === 'notes' ? '关闭笔记' : '我的笔记'}>
          <Button
            type={rightPanel === 'notes' ? 'primary' : 'text'}
            icon={<EditOutlined />}
            size="small"
            onClick={() => setRightPanel((v) => v === 'notes' ? null : 'notes')}
          />
        </Tooltip>
        <Tag color={isReady ? 'green' : 'blue'} style={{ margin: 0 }}>
          {isReady ? '就绪' : doc.status === 'processing' ? 'AI处理中' : doc.status}
        </Tag>
      </Space>
    </div>
  );

  // ── 左侧目录抽屉 ─────────────────────────────────────────
  const renderToc = () => {
    if (!tocOpen) return null;
    return (
      <div style={{
        width: 240,
        borderRight: '1px solid #f0f0f0',
        background: '#fafafa',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #f0f0f0',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <Text strong style={{ fontSize: 13 }}>目录</Text>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setTocOpen(false)} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
          {outline.length > 0 ? (
            outline.map((item, idx) => (
              <TocItem
                key={idx}
                item={item}
                currentPage={currentPage}
                onJump={(page) => pdfGoToRef.current?.(page)}
              />
            ))
          ) : (
            <div style={{ padding: '24px 16px', textAlign: 'center' }}>
              <FileTextOutlined style={{ fontSize: 28, color: '#ccc', marginBottom: 8, display: 'block' }} />
              <Text type="secondary" style={{ fontSize: 12 }}>该文档暂无目录</Text>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── PDF 主视图 ────────────────────────────────────────────
  const renderPdfView = () => (
    <PdfViewer
      url={pdfUrl}
      height="100%"
      filename={`${doc.title}.pdf`}
      onPageChange={(page) => setCurrentPage(page)}
      onTotalPages={(n) => setTotalPages(n)}
      onOutline={(tree) => setOutline(tree)}
      onGoToRef={(fn) => { pdfGoToRef.current = fn; }}
    />
  );

  // ── AI 解析视图 ───────────────────────────────────────────
  const renderAiView = () => (
    <div style={{ flex: 1, overflowY: 'auto', padding: '24px', background: '#f5f7fa' }}>
      <div style={{ maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>

        {/* 封面卡片 */}
        <Card
          style={{ borderRadius: 16, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', border: 'none' }}
          styles={{ body: { padding: '24px 28px' } }}
        >
          <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
            {doc.cover_url && (
              <img
                src={doc.cover_url.startsWith('http') ? doc.cover_url : `${import.meta.env.BASE_URL.replace(/\/$/, '')}${doc.cover_url}`}
                alt={doc.title}
                style={{ width: 80, height: 110, objectFit: 'cover', borderRadius: 8, flexShrink: 0, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            )}
            <div>
              <Title level={4} style={{ color: '#fff', margin: 0, marginBottom: 6 }}>{doc.title}</Title>
              {doc.author && <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>{doc.author}</Text>}
              <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {doc.page_count && <Tag style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}>{doc.page_count} 页</Tag>}
                {doc.language && <Tag style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none' }}>{doc.language}</Tag>}
                {doc.file_type && <Tag style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', border: 'none', textTransform: 'uppercase' }}>{doc.file_type}</Tag>}
              </div>
            </div>
          </div>
          <div style={{ marginTop: 16 }}>
            <Button
              icon={<FilePdfOutlined />}
              onClick={() => setViewMode('pdf')}
              style={{ marginRight: 8, borderRadius: 8, background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
            >
              查看 PDF 原文
            </Button>
            {hasLecture && (
              <Button
                icon={<PlayCircleOutlined />}
                onClick={() => navigate(`/study/${id}`)}
                style={{ borderRadius: 8, background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)' }}
              >
                AI 讲解播放
              </Button>
            )}
          </div>
        </Card>

        {/* AI 摘要 */}
        {doc.summary && (
          <Card
            title={<Space><ReadOutlined style={{ color: '#1890ff' }} /><Text strong>AI 摘要</Text></Space>}
            style={{ borderRadius: 16 }}
            size="small"
          >
            <Paragraph style={{ fontSize: 14, lineHeight: 1.9, margin: 0, color: '#333', whiteSpace: 'pre-wrap' }}>
              {doc.summary}
            </Paragraph>
          </Card>
        )}

        {/* 核心知识点 */}
        {keyPoints.length > 0 && (
          <Card
            title={<Space><BulbOutlined style={{ color: '#faad14' }} /><Text strong>核心知识点</Text></Space>}
            style={{ borderRadius: 16 }}
            size="small"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {keyPoints.map((point, idx) => (
                <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%', background: 'linear-gradient(135deg, #2dce89, #11cdef)',
                    color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 12, fontWeight: 600, flexShrink: 0, marginTop: 1,
                  }}>
                    {idx + 1}
                  </div>
                  <Text style={{ fontSize: 14, lineHeight: 1.7, color: '#333' }}>{point}</Text>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* PPT 大纲 */}
        {hasPpt && (
          <Card
            title={<Space><FileTextOutlined style={{ color: '#722ed1' }} /><Text strong>内容大纲</Text></Space>}
            style={{ borderRadius: 16 }}
            size="small"
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {doc.ppt_content.map((slide, idx) => (
                <div key={idx} style={{ borderLeft: '3px solid #722ed1', paddingLeft: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <Tag color="purple" style={{ borderRadius: 4, fontSize: 11 }}>第 {slide.slide || idx + 1} 页</Tag>
                    <Text strong style={{ fontSize: 14 }}>{slide.title}</Text>
                  </div>
                  {slide.points?.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                      {slide.points.map((p, pi) => (
                        <li key={pi} style={{ marginBottom: 3 }}>
                          <Text style={{ fontSize: 13, color: '#555' }}>{p}</Text>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}

        {!doc.summary && !keyPoints.length && !hasPpt && (
          <Card style={{ borderRadius: 16, textAlign: 'center', padding: '40px 0' }}>
            <Spin style={{ marginBottom: 16 }} />
            <div><Text type="secondary">AI 正在分析文档内容，请稍候...</Text></div>
          </Card>
        )}
      </div>
    </div>
  );

  // ── 右侧 AI 问书面板 ──────────────────────────────────────
  const renderAiPanel = () => (
    <div style={{
      width: 320,
      borderLeft: '1px solid #f0f0f0',
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      flexShrink: 0,
    }}>
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <Space>
          <RobotOutlined style={{ color: '#1890ff', fontSize: 16 }} />
          <Text strong style={{ fontSize: 14 }}>AI 问书</Text>
        </Space>
        <Space size={4}>
          <Tooltip title="新对话">
            <Button size="small" type="text" icon={<PlusOutlined />} onClick={() => { setSessionId(null); setChatMessages([]); }} />
          </Tooltip>
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setRightPanel(null)} />
        </Space>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {chatMessages.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: 48, color: '#bbb' }}>
            <RobotOutlined style={{ fontSize: 40, marginBottom: 12, display: 'block' }} />
            <Text type="secondary" style={{ fontSize: 13 }}>针对本文档内容自由提问</Text>
            <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {['这本书的核心观点是什么？', '帮我总结本文的主要内容', '这篇文档解决了什么问题？'].map((q) => (
                <Button
                  key={q}
                  type="dashed"
                  size="small"
                  style={{ borderRadius: 8, textAlign: 'left', height: 'auto', whiteSpace: 'normal', padding: '6px 10px' }}
                  onClick={() => { setChatInput(q); }}
                >
                  {q}
                </Button>
              ))}
            </div>
          </div>
        ) : chatMessages.map((msg, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, maxWidth: '90%', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: msg.role === 'user' ? '#1890ff' : '#f0f0f0',
                color: msg.role === 'user' ? '#fff' : '#666',
                fontSize: 11, fontWeight: 700,
              }}>
                {msg.role === 'user' ? '我' : 'AI'}
              </div>
              <div style={{
                padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.7,
                background: msg.role === 'user' ? '#1890ff' : '#f5f5f5',
                color: msg.role === 'user' ? '#fff' : '#333',
                wordBreak: 'break-word', whiteSpace: 'pre-wrap',
              }}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        {chatLoading && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#666' }}>AI</div>
            <div style={{ padding: '8px 12px', borderRadius: 10, background: '#f5f5f5' }}>
              <Spin size="small" /><Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>思考中...</Text>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div style={{ padding: '10px 14px', borderTop: '1px solid #f0f0f0', flexShrink: 0, background: '#fafafa' }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <Input
            placeholder="输入问题，Enter 发送..."
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
  );

  // ── 右侧笔记面板 ──────────────────────────────────────────
  const renderNotesPanel = () => (
    <div style={{
      width: 320,
      borderLeft: '1px solid #f0f0f0',
      display: 'flex',
      flexDirection: 'column',
      background: '#fff',
      flexShrink: 0,
    }}>
      <div style={{
        padding: '12px 14px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        flexShrink: 0,
      }}>
        <Space>
          <EditOutlined style={{ color: '#faad14', fontSize: 16 }} />
          <Text strong style={{ fontSize: 14 }}>阅读笔记</Text>
          {notes.length > 0 && <Badge count={notes.length} style={{ backgroundColor: '#faad14' }} />}
        </Space>
        <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setRightPanel(null)} />
      </div>

      {/* 添加笔记 */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, background: '#fafafa' }}>
        <Text type="secondary" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>
          当前页：第 {currentPage} 页
        </Text>
        {noteHighlight && (
          <div style={{
            background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6,
            padding: '6px 10px', marginBottom: 8, fontSize: 12,
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          }}>
            <Text style={{ fontSize: 12, color: '#665' }}>「{noteHighlight.slice(0, 60)}{noteHighlight.length > 60 ? '...' : ''}」</Text>
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setNoteHighlight('')} style={{ flexShrink: 0 }} />
          </div>
        )}
        <TextArea
          placeholder="记录你的想法..."
          value={noteContent}
          onChange={(e) => setNoteContent(e.target.value)}
          rows={3}
          style={{ fontSize: 13, borderRadius: 8, marginBottom: 8 }}
        />
        <Button
          type="primary"
          size="small"
          icon={<PlusOutlined />}
          loading={addingNote}
          onClick={handleAddNote}
          disabled={!noteContent.trim()}
          style={{ borderRadius: 6 }}
        >
          保存笔记
        </Button>
      </div>

      {/* 笔记列表 */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {notesLoading ? (
          <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
        ) : notes.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: '#bbb' }}>
            <EditOutlined style={{ fontSize: 32, marginBottom: 8, display: 'block' }} />
            <Text type="secondary" style={{ fontSize: 13 }}>暂无笔记，选中文字可快速添加</Text>
          </div>
        ) : (
          <List
            dataSource={notes}
            renderItem={(note) => (
              <List.Item
                style={{ padding: '12px 14px', borderBottom: '1px solid #f5f5f5' }}
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
                <div style={{ width: '100%', minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                    <Tag color="blue" style={{ fontSize: 11, padding: '0 4px' }}>P{note.page_number}</Tag>
                    {note.highlight_text && (
                      <Tag style={{ background: '#fffbe6', color: '#876800', border: '1px solid #ffe58f', fontSize: 11, padding: '0 4px' }}>
                        <HighlightOutlined />
                      </Tag>
                    )}
                  </div>
                  {note.highlight_text && (
                    <div style={{ background: '#fffbe6', borderLeft: '3px solid #faad14', padding: '4px 8px', borderRadius: '0 4px 4px 0', marginBottom: 6, fontSize: 12, color: '#665' }}>
                      「{note.highlight_text.slice(0, 80)}{note.highlight_text.length > 80 ? '...' : ''}」
                    </div>
                  )}
                  <Text style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>{note.content}</Text>
                </div>
              </List.Item>
            )}
          />
        )}
      </div>
    </div>
  );

  // ── 底部进度条（仅 PDF 视图显示）────────────────────────
  const renderBottomBar = () => {
    if (viewMode !== 'pdf' || !totalPages) return null;
    return (
      <div style={{
        height: 44,
        display: 'flex',
        alignItems: 'center',
        padding: '0 16px',
        borderTop: '1px solid #f0f0f0',
        background: '#fff',
        flexShrink: 0,
        gap: 12,
      }}>
        <Button
          size="small"
          icon={<LeftOutlined />}
          disabled={currentPage <= 1}
          onClick={() => pdfGoToRef.current?.(currentPage - 1)}
          style={{ flexShrink: 0 }}
        />
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10 }}>
          <input
            type="range"
            min={1}
            max={totalPages}
            value={currentPage}
            onChange={(e) => pdfGoToRef.current?.(Number(e.target.value))}
            style={{ flex: 1, cursor: 'pointer', accentColor: '#2dce89' }}
          />
        </div>
        <Button
          size="small"
          icon={<RightOutlined />}
          disabled={currentPage >= totalPages}
          onClick={() => pdfGoToRef.current?.(currentPage + 1)}
          style={{ flexShrink: 0 }}
        />
        <Text type="secondary" style={{ fontSize: 12, flexShrink: 0, minWidth: 70, textAlign: 'right' }}>
          {currentPage} / {totalPages} 页
        </Text>
      </div>
    );
  };

  // ── 选中文字浮层工具栏 ────────────────────────────────────
  const renderSelectionBar = () => {
    if (!selectionBar) return null;
    return (
      <div
        data-selection-bar
        style={{
          position: 'fixed',
          left: Math.min(selectionBar.x - 120, window.innerWidth - 260),
          top: Math.max(selectionBar.y - 52, 60),
          zIndex: 1100,
          background: '#1f2329',
          borderRadius: 10,
          padding: '6px 8px',
          display: 'flex',
          gap: 4,
          alignItems: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.25)',
        }}
      >
        {/* 划线颜色选择 */}
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.key}
            data-selection-bar
            onClick={() => setHighlightColor(c.key)}
            title={c.label}
            style={{
              width: 18, height: 18, borderRadius: '50%',
              background: c.bg, border: highlightColor === c.key ? `2px solid ${c.border}` : '2px solid transparent',
              cursor: 'pointer', padding: 0, flexShrink: 0,
            }}
          />
        ))}
        <Divider type="vertical" style={{ borderColor: '#444', margin: '0 2px', height: 18 }} />
        <Tooltip title="划线保存">
          <Button
            data-selection-bar
            size="small"
            type="text"
            icon={<HighlightOutlined />}
            onClick={handleHighlight}
            style={{ color: '#fff', padding: '0 6px' }}
          />
        </Tooltip>
        <Tooltip title="复制">
          <Button
            data-selection-bar
            size="small"
            type="text"
            icon={<CopyOutlined />}
            onClick={handleCopyText}
            style={{ color: '#fff', padding: '0 6px' }}
          />
        </Tooltip>
        <Tooltip title="写笔记">
          <Button
            data-selection-bar
            size="small"
            type="text"
            icon={<EditOutlined />}
            onClick={handleAddNoteFromSelection}
            style={{ color: '#fff', padding: '0 6px' }}
          />
        </Tooltip>
        <Tooltip title="AI 解释">
          <Button
            data-selection-bar
            size="small"
            type="text"
            icon={<RobotOutlined />}
            onClick={handleAiExplain}
            style={{ color: '#52c41a', padding: '0 6px' }}
          />
        </Tooltip>
        <Divider type="vertical" style={{ borderColor: '#444', margin: '0 2px', height: 18 }} />
        <Button
          data-selection-bar
          size="small"
          type="text"
          icon={<CloseOutlined />}
          onClick={() => setSelectionBar(null)}
          style={{ color: '#888', padding: '0 4px' }}
        />
      </div>
    );
  };

  // ── 主布局 ────────────────────────────────────────────────
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#f5f5f5' }}>
      {renderTopBar()}

      {/* AI 处理中提示条 */}
      {(doc.status === 'processing' || doc.status === 'pending') && (
        <div style={{
          background: 'linear-gradient(135deg, #e8faf0, #e0f7fa)',
          padding: '8px 20px',
          textAlign: 'center',
          flexShrink: 0,
          borderBottom: '1px solid #d9f7be',
        }}>
          <Spin size="small" style={{ marginRight: 8 }} />
          <Text strong style={{ fontSize: 13 }}>AI 正在分析文档，处理完成后可查看 AI 解析...</Text>
          <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>进度：{Math.round(doc.progress || 0)}%</Text>
        </div>
      )}

      {/* 中间主区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {/* 左侧目录 */}
        {renderToc()}

        {/* 主视图区 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {viewMode === 'pdf' ? renderPdfView() : renderAiView()}
          {renderBottomBar()}
        </div>

        {/* 右侧面板 */}
        {rightPanel === 'ai' && renderAiPanel()}
        {rightPanel === 'notes' && renderNotesPanel()}
      </div>

      {/* 选中文字浮层 */}
      {renderSelectionBar()}
    </div>
  );
}

// ── 目录树递归组件 ────────────────────────────────────────
function TocItem({ item, currentPage, onJump, depth = 0 }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const hasChildren = item.items?.length > 0;
  const isActive = item.page && currentPage === item.page;

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: `6px ${16 + depth * 14}px`,
          cursor: item.page ? 'pointer' : 'default',
          background: isActive ? '#e6f7ff' : 'transparent',
          borderRight: isActive ? '3px solid #1890ff' : '3px solid transparent',
          transition: 'background 0.15s',
        }}
        onClick={() => {
          if (item.page) onJump(item.page);
          if (hasChildren) setExpanded((v) => !v);
        }}
        onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = '#f5f5f5'; }}
        onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
      >
        {hasChildren && (
          <span style={{ fontSize: 10, marginRight: 4, color: '#999', transition: 'transform 0.15s', display: 'inline-block', transform: expanded ? 'rotate(90deg)' : 'none' }}>▶</span>
        )}
        {!hasChildren && <span style={{ width: 14 }} />}
        <Text
          style={{
            fontSize: 13 - depth,
            color: isActive ? '#1890ff' : '#333',
            fontWeight: isActive ? 600 : depth === 0 ? 500 : 400,
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={item.title}
        >
          {item.title}
        </Text>
        {item.page && (
          <Text type="secondary" style={{ fontSize: 11, flexShrink: 0, marginLeft: 4 }}>
            {item.page}
          </Text>
        )}
      </div>
      {hasChildren && expanded && item.items.map((child, idx) => (
        <TocItem key={idx} item={child} currentPage={currentPage} onJump={onJump} depth={depth + 1} />
      ))}
    </div>
  );
}
