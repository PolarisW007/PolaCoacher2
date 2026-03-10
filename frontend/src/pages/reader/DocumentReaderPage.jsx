/**
 * DocumentReaderPage — 微信读书风格全屏阅读器
 *
 * 功能：
 * - 流式文本阅读（结构化段落，不按 PDF 页翻页）
 * - 阅读设置：字号/字体/背景/行距
 * - 原文 / 译文 / 双语 三模式切换
 * - 精确文字划线（颜色选择，持久化）
 * - 章节目录导航（IntersectionObserver 自动高亮）
 * - AI 问书右侧面板
 * - 笔记右侧面板
 * - 阅读进度记忆
 * - 切换 PDF 原文模式
 */
import {
  useCallback, useEffect, useLayoutEffect, useRef, useState,
} from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Badge, Button, Divider, Empty, Input, List,
  message, Select, Slider, Space, Spin, Tag, Tooltip, Typography,
} from 'antd';
import {
  ArrowLeftOutlined, BulbOutlined, CheckCircleOutlined,
  CloseOutlined, CopyOutlined, DeleteOutlined, EditOutlined,
  FileTextOutlined, GlobalOutlined, HighlightOutlined,
  LeftOutlined, MenuOutlined, MessageOutlined, PlusOutlined,
  PlayCircleOutlined, ReadOutlined, ReloadOutlined,
  RightOutlined, RobotOutlined, SendOutlined, SettingOutlined,
  FilePdfOutlined, SyncOutlined, SwapOutlined,
} from '@ant-design/icons';
import { docApi, historyApi } from '../../api/documents';
import PdfViewer from '../../components/PdfViewer';

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

// ── 阅读设置常量 ──────────────────────────────────────────────
const FONT_SIZE_OPTIONS = [
  { label: '小', value: 14 },
  { label: '中', value: 16 },
  { label: '大', value: 18 },
  { label: '特大', value: 22 },
];
const FONT_FAMILY_OPTIONS = [
  { label: '默认', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { label: '宋体', value: '"SimSun", "STSong", serif' },
  { label: '黑体', value: '"SimHei", "STHeiti", sans-serif' },
  { label: '楷体', value: '"KaiTi", "STKaiti", cursive' },
];
const BG_OPTIONS = [
  { label: '白色', value: '#ffffff', text: '#1a1a1a', key: 'white' },
  { label: '护眼', value: '#f5f0e8', text: '#3a3028', key: 'warm' },
  { label: '绿色', value: '#e8f5e9', text: '#1b4332', key: 'green' },
  { label: '夜间', value: '#1a1a2e', text: '#e0e0e0', key: 'dark' },
];
const LINE_HEIGHT_OPTIONS = [
  { label: '紧凑', value: 1.6 },
  { label: '标准', value: 1.9 },
  { label: '宽松', value: 2.3 },
];
const HIGHLIGHT_COLORS = [
  { key: 'yellow', bg: 'rgba(255, 241, 0, 0.45)', border: '#fadb14', label: '黄色' },
  { key: 'green',  bg: 'rgba(82, 196, 26, 0.30)', border: '#52c41a', label: '绿色' },
  { key: 'blue',   bg: 'rgba(24, 144, 255, 0.28)', border: '#1890ff', label: '蓝色' },
  { key: 'pink',   bg: 'rgba(235, 47, 150, 0.28)', border: '#eb2f96', label: '粉色' },
];

const PREFS_KEY = 'reader_prefs_v1';
const defaultPrefs = { fontSize: 17, fontFamily: FONT_FAMILY_OPTIONS[0].value, bg: BG_OPTIONS[0].key, lineHeight: 1.9 };

function loadPrefs() {
  try { return { ...defaultPrefs, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; }
  catch { return defaultPrefs; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch {}
}
function loadProgress(docId) {
  try { return JSON.parse(localStorage.getItem(`reader_progress_${docId}`) || 'null'); } catch { return null; }
}
function saveProgress(docId, chapterId, scrollTop) {
  try { localStorage.setItem(`reader_progress_${docId}`, JSON.stringify({ chapterId, scrollTop })); } catch {}
}

// ── 语言标签 ──────────────────────────────────────────────────
function langLabel(lang) {
  const map = { zh: '中文', en: '英文', ja: '日文', ko: '韩文', fr: '法文', de: '德文' };
  return map[lang] || lang?.toUpperCase() || '未知';
}

export default function DocumentReaderPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  // ── 文档基础数据 ──────────────────────────────────────────
  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── 内容数据 ──────────────────────────────────────────────
  const [chapters, setChapters] = useState([]);        // [{id, title, level, para_index}]
  const [paragraphs, setParagraphs] = useState([]);    // [{id, chapter_id, type, text, page}]
  const [contentLoading, setContentLoading] = useState(false);
  const [contentReady, setContentReady] = useState(false);  // 是否有结构化内容

  // ── 翻译数据 ──────────────────────────────────────────────
  const [translationStatus, setTranslationStatus] = useState(null);  // null|translating|done|failed
  const [translationLang, setTranslationLang] = useState(null);
  const [translatedChapters, setTranslatedChapters] = useState([]);  // [{chapter_id, paragraphs:[{id,text}]}]
  const translationPollRef = useRef(null);

  // ── 视图模式 ──────────────────────────────────────────────
  const [mainView, setMainView] = useState('text'); // 'text' | 'pdf'
  const [langMode, setLangMode] = useState('original'); // 'original' | 'translated' | 'bilingual'

  // ── 阅读设置 ──────────────────────────────────────────────
  const [prefs, setPrefs] = useState(loadPrefs);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── 目录面板 ──────────────────────────────────────────────
  const [tocOpen, setTocOpen] = useState(false);
  const [activeChapterId, setActiveChapterId] = useState(null);

  // ── 右侧面板 ──────────────────────────────────────────────
  const [rightPanel, setRightPanel] = useState(null); // null | 'ai' | 'notes'

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

  // ── 划线数据 ──────────────────────────────────────────────
  // {paraId: [{noteId, start, end, color, text}]}
  const [highlights, setHighlights] = useState({});
  const [activeColor, setActiveColor] = useState('yellow');

  // ── 选中文字浮层 ──────────────────────────────────────────
  const [selBar, setSelBar] = useState(null); // {x, y, text, paraId}

  // ── PDF 页码（pdf 模式用）────────────────────────────────
  const [pdfPage, setPdfPage] = useState(1);
  const [pdfTotal, setPdfTotal] = useState(0);
  const pdfGoToRef = useRef(null);

  // ── 阅读区 ref ────────────────────────────────────────────
  const readingAreaRef = useRef(null);
  const chapterRefs = useRef({});   // {chapterId: DOM}
  const startTimeRef = useRef(Date.now());

  // ─────────────────────────────────────────────────────────
  // 当前 BG 配置
  const bgConfig = BG_OPTIONS.find((b) => b.key === prefs.bg) || BG_OPTIONS[0];

  // ─────────────────────────────────────────────────────────
  // 加载文档基础信息
  // ─────────────────────────────────────────────────────────
  const fetchDoc = useCallback(async () => {
    try {
      const res = await docApi.get(id);
      setDoc(res.data);
    } catch { message.error('文档加载失败'); }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);

  // ─────────────────────────────────────────────────────────
  // 加载结构化内容
  // ─────────────────────────────────────────────────────────
  const fetchContent = useCallback(async () => {
    setContentLoading(true);
    try {
      const res = await docApi.getContent(id);
      const d = res.data;
      setChapters(d.chapters || []);
      setParagraphs(d.paragraphs || []);
      setContentReady((d.paragraphs || []).length > 0);
      setTranslationStatus(d.translation_status);
      setTranslationLang(d.translation_lang);
      if (d.translation_status === 'translating') startTranslationPoll();
    } catch { /* silent */ }
    finally { setContentLoading(false); }
  }, [id]);

  useEffect(() => {
    if (doc?.status === 'ready') fetchContent();
  }, [doc?.status, fetchContent]);

  // ─────────────────────────────────────────────────────────
  // 加载翻译内容
  // ─────────────────────────────────────────────────────────
  const fetchTranslation = useCallback(async () => {
    try {
      const res = await docApi.getTranslation(id);
      const d = res.data;
      setTranslatedChapters(d.translated_chapters || []);
      setTranslationStatus(d.translation_status);
      setTranslationLang(d.translation_lang);
      return d.translation_status;
    } catch { return null; }
  }, [id]);

  const startTranslationPoll = useCallback(() => {
    if (translationPollRef.current) return;
    translationPollRef.current = setInterval(async () => {
      const status = await fetchTranslation();
      if (status === 'done' || status === 'failed' || !status) {
        clearInterval(translationPollRef.current);
        translationPollRef.current = null;
      }
    }, 4000);
  }, [fetchTranslation]);

  useEffect(() => {
    if (translationStatus === 'translating') {
      startTranslationPoll();
    }
    return () => {
      if (translationPollRef.current) {
        clearInterval(translationPollRef.current);
        translationPollRef.current = null;
      }
    };
  }, [translationStatus, startTranslationPoll]);

  // 有翻译内容时按需加载
  useEffect(() => {
    if (translationStatus === 'done' || translationStatus === 'translating') {
      fetchTranslation();
    }
  }, [translationStatus, fetchTranslation]);

  // ─────────────────────────────────────────────────────────
  // 阅读进度恢复
  // ─────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    if (!contentReady || !readingAreaRef.current) return;
    const saved = loadProgress(id);
    if (!saved) return;
    setTimeout(() => {
      if (saved.chapterId && chapterRefs.current[saved.chapterId]) {
        chapterRefs.current[saved.chapterId].scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (saved.scrollTop && readingAreaRef.current) {
        readingAreaRef.current.scrollTop = saved.scrollTop;
      }
    }, 300);
  }, [contentReady, id]);

  // 阅读进度保存（滚动时 debounce）
  useEffect(() => {
    const el = readingAreaRef.current;
    if (!el) return;
    let timer;
    const onScroll = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        saveProgress(id, activeChapterId, el.scrollTop);
      }, 500);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => { el.removeEventListener('scroll', onScroll); clearTimeout(timer); };
  }, [id, activeChapterId]);

  // ─────────────────────────────────────────────────────────
  // 章节 IntersectionObserver — 自动高亮当前章节
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!contentReady) return;
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setActiveChapterId(entry.target.dataset.chapterId);
        }
      }
    }, { root: readingAreaRef.current, threshold: 0.15, rootMargin: '-60px 0px -60% 0px' });

    Object.values(chapterRefs.current).forEach((el) => { if (el) io.observe(el); });
    return () => io.disconnect();
  }, [contentReady, chapters]);

  // ─────────────────────────────────────────────────────────
  // 记录阅读历史
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    historyApi.record({ document_id: id, action: 'read', last_page: 0, duration_seconds: 0 }).catch(() => {});
    startTimeRef.current = Date.now();
    return () => {
      const sec = Math.round((Date.now() - startTimeRef.current) / 1000);
      historyApi.record({ document_id: id, action: 'read', last_page: pdfPage, duration_seconds: sec }).catch(() => {});
    };
  }, [id]);

  // ─────────────────────────────────────────────────────────
  // 键盘翻页（PDF 模式）
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (mainView !== 'pdf') return;
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') pdfGoToRef.current?.(pdfPage + 1);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pdfGoToRef.current?.(pdfPage - 1);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mainView, pdfPage]);

  // ─────────────────────────────────────────────────────────
  // 文字选中监听 → 显示浮层工具栏
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onMouseUp = (e) => {
      if (e.target.closest?.('[data-sel-bar]')) return;
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length > 2000) { setSelBar(null); return; }

      // 找到最近的 data-para-id 节点
      let node = sel.anchorNode;
      let paraId = null;
      while (node) {
        if (node.dataset?.paraId) { paraId = node.dataset.paraId; break; }
        node = node.parentElement;
      }

      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelBar({ x: rect.left + rect.width / 2, y: rect.top - 8, text, paraId });
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, []);

  // 点击其他处关闭浮层
  useEffect(() => {
    const onDown = (e) => { if (!e.target.closest?.('[data-sel-bar]')) setSelBar(null); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  // chat 滚到底
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [chatMessages]);

  // ─────────────────────────────────────────────────────────
  // 笔记
  // ─────────────────────────────────────────────────────────
  const fetchNotes = useCallback(async () => {
    setNotesLoading(true);
    try {
      const res = await docApi.listNotes(id);
      const list = res.data || [];
      setNotes(list);
      // 重建划线 map
      const map = {};
      for (const n of list) {
        if (n.highlight_text && n.position?.para_id) {
          const pid = n.position.para_id;
          if (!map[pid]) map[pid] = [];
          map[pid].push({
            noteId: n.id,
            start: n.position.start || 0,
            end: n.position.end || 0,
            color: n.position.color || 'yellow',
            text: n.highlight_text,
          });
        }
      }
      setHighlights(map);
    } catch { /* silent */ }
    finally { setNotesLoading(false); }
  }, [id]);

  useEffect(() => { fetchNotes(); }, [fetchNotes]);
  useEffect(() => { if (rightPanel === 'notes') fetchNotes(); }, [rightPanel, fetchNotes]);

  // ─────────────────────────────────────────────────────────
  // AI 问书
  // ─────────────────────────────────────────────────────────
  const sendChat = async (question) => {
    const q = question || chatInput.trim();
    if (!q) return;
    setChatMessages((p) => [...p, { role: 'user', content: q }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await docApi.chat(id, { question: q, session_id: sessionId });
      const d = res.data;
      if (d.session_id && !sessionId) setSessionId(d.session_id);
      setChatMessages((p) => [...p, { role: 'assistant', content: d.answer }]);
    } catch {
      setChatMessages((p) => [...p, { role: 'assistant', content: '回答失败，请重试。' }]);
    } finally { setChatLoading(false); }
  };

  // ─────────────────────────────────────────────────────────
  // 选中文字操作
  // ─────────────────────────────────────────────────────────
  const handleHighlight = async () => {
    if (!selBar) return;
    const sel = window.getSelection();
    const start = sel?.getRangeAt(0)?.startOffset || 0;
    const end = sel?.getRangeAt(0)?.endOffset || 0;

    try {
      const res = await docApi.createNote(id, {
        page_number: 0,
        content: `[划线] ${selBar.text}`,
        highlight_text: selBar.text,
        position: { para_id: selBar.paraId, start, end, color: activeColor },
      });
      setHighlights((prev) => {
        const pid = selBar.paraId;
        const list = prev[pid] ? [...prev[pid]] : [];
        list.push({ noteId: res.data.id, start, end, color: activeColor, text: selBar.text });
        return { ...prev, [pid]: list };
      });
      message.success('划线已保存');
    } catch { message.error('保存失败'); }
    setSelBar(null);
  };

  const handleCopy = () => {
    if (!selBar) return;
    navigator.clipboard.writeText(selBar.text).then(() => message.success('已复制'));
    setSelBar(null);
  };

  const handleAiExplain = () => {
    if (!selBar) return;
    const q = `请解释：「${selBar.text}」`;
    setRightPanel('ai');
    sendChat(q);
    setSelBar(null);
  };

  const handleNoteFromSel = () => {
    if (!selBar) return;
    setNoteHighlight(selBar.text);
    setNoteContent('');
    setRightPanel('notes');
    setSelBar(null);
  };

  // ─────────────────────────────────────────────────────────
  // 翻译触发
  // ─────────────────────────────────────────────────────────
  const triggerTranslate = async (targetLang) => {
    try {
      await docApi.triggerTranslate(id, targetLang);
      setTranslationStatus('translating');
      startTranslationPoll();
      message.success('翻译已开始，将按章节陆续完成');
    } catch (e) {
      message.error(e?.response?.data?.detail || '触发翻译失败');
    }
  };

  // ─────────────────────────────────────────────────────────
  // 构建翻译查找 map（chapter_id → para_id → text）
  // ─────────────────────────────────────────────────────────
  const translationMap = (() => {
    const map = {}; // paraId → text
    for (const ch of translatedChapters) {
      for (const p of (ch.paragraphs || [])) {
        map[p.id] = p.text;
      }
    }
    return map;
  })();

  const translatedChapterTitles = (() => {
    const map = {};
    for (const ch of translatedChapters) {
      map[ch.chapter_id] = ch.title_translated;
    }
    return map;
  })();

  // ─────────────────────────────────────────────────────────
  // 渲染：顶栏
  // ─────────────────────────────────────────────────────────
  const renderTopBar = () => (
    <div style={{
      height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 14px', background: bgConfig.value, borderBottom: `1px solid ${bgConfig.key === 'dark' ? '#333' : '#e8e8e8'}`,
      flexShrink: 0, gap: 10, zIndex: 50,
      transition: 'background 0.3s',
    }}>
      {/* 左 */}
      <Space size={6} style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <Tooltip title="目录">
          <Button
            type={tocOpen ? 'primary' : 'text'}
            icon={<MenuOutlined />} size="small"
            onClick={() => setTocOpen((v) => !v)}
            style={{ color: tocOpen ? undefined : bgConfig.text, flexShrink: 0 }}
          />
        </Tooltip>
        <Button
          type="text" icon={<ArrowLeftOutlined />} size="small"
          onClick={() => navigate('/documents')}
          style={{ color: bgConfig.text, flexShrink: 0 }}
        >
          返回
        </Button>
        <Text
          strong ellipsis
          style={{ fontSize: 15, color: bgConfig.text, maxWidth: 200 }}
          title={doc?.title}
        >
          {doc?.title}
        </Text>
        {doc?.language && (
          <Tag style={{ flexShrink: 0, fontSize: 11 }}>
            {langLabel(doc.language)}
          </Tag>
        )}
      </Space>

      {/* 中：视图切换 */}
      <Space size={4} style={{ flexShrink: 0 }}>
        <Button
          size="small" type={mainView === 'text' ? 'primary' : 'default'}
          icon={<ReadOutlined />}
          disabled={!contentReady}
          onClick={() => setMainView('text')}
          style={{ borderRadius: 6 }}
        >
          {contentReady ? '流式阅读' : '解析中…'}
        </Button>
        <Button
          size="small" type={mainView === 'pdf' ? 'primary' : 'default'}
          icon={<FilePdfOutlined />}
          onClick={() => setMainView('pdf')}
          style={{ borderRadius: 6 }}
        >
          PDF原文
        </Button>
      </Space>

      {/* 右：工具区 */}
      <Space size={4} style={{ flexShrink: 0 }}>
        {/* 语言/翻译 */}
        {mainView === 'text' && (
          <TranslationToggle
            lang={doc?.language}
            translationStatus={translationStatus}
            translationLang={translationLang}
            langMode={langMode}
            setLangMode={setLangMode}
            onTriggerTranslate={triggerTranslate}
            bgText={bgConfig.text}
          />
        )}
        {doc?.lecture_slides?.length > 0 && (
          <Tooltip title="AI 讲解">
            <Button type="text" size="small" icon={<PlayCircleOutlined style={{ color: '#2dce89' }} />}
              onClick={() => navigate(`/study/${id}`)} style={{ color: '#2dce89' }}>讲解</Button>
          </Tooltip>
        )}
        <Tooltip title={rightPanel === 'ai' ? '关闭问书' : 'AI 问书'}>
          <Button type={rightPanel === 'ai' ? 'primary' : 'text'} icon={<MessageOutlined />} size="small"
            style={{ color: rightPanel === 'ai' ? undefined : bgConfig.text }}
            onClick={() => setRightPanel((v) => v === 'ai' ? null : 'ai')} />
        </Tooltip>
        <Tooltip title={rightPanel === 'notes' ? '关闭笔记' : '笔记'}>
          <Button type={rightPanel === 'notes' ? 'primary' : 'text'} icon={<EditOutlined />} size="small"
            style={{ color: rightPanel === 'notes' ? undefined : bgConfig.text }}
            onClick={() => setRightPanel((v) => v === 'notes' ? null : 'notes')} />
        </Tooltip>
        <Tooltip title="阅读设置">
          <Button type={settingsOpen ? 'primary' : 'text'} icon={<SettingOutlined />} size="small"
            style={{ color: settingsOpen ? undefined : bgConfig.text }}
            onClick={() => setSettingsOpen((v) => !v)} />
        </Tooltip>
      </Space>
    </div>
  );

  // ─────────────────────────────────────────────────────────
  // 渲染：阅读设置面板（下拉）
  // ─────────────────────────────────────────────────────────
  const renderSettings = () => {
    if (!settingsOpen) return null;
    const update = (key, val) => {
      const next = { ...prefs, [key]: val };
      setPrefs(next);
      savePrefs(next);
    };
    return (
      <div style={{
        position: 'absolute', top: 54, right: 14, zIndex: 200,
        background: '#fff', borderRadius: 14, boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
        padding: '18px 20px', width: 300,
      }}>
        {/* 字号 */}
        <div style={{ marginBottom: 14 }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>字号</Text>
          <Space>
            {FONT_SIZE_OPTIONS.map((opt) => (
              <Button
                key={opt.value} size="small"
                type={prefs.fontSize === opt.value ? 'primary' : 'default'}
                style={{ borderRadius: 8, fontSize: opt.value === 22 ? 13 : 12 }}
                onClick={() => update('fontSize', opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </Space>
        </div>
        {/* 字体 */}
        <div style={{ marginBottom: 14 }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>字体</Text>
          <Space wrap>
            {FONT_FAMILY_OPTIONS.map((opt) => (
              <Button
                key={opt.label} size="small"
                type={prefs.fontFamily === opt.value ? 'primary' : 'default'}
                style={{ borderRadius: 8, fontFamily: opt.value }}
                onClick={() => update('fontFamily', opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </Space>
        </div>
        {/* 行距 */}
        <div style={{ marginBottom: 14 }}>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>行距</Text>
          <Space>
            {LINE_HEIGHT_OPTIONS.map((opt) => (
              <Button
                key={opt.value} size="small"
                type={prefs.lineHeight === opt.value ? 'primary' : 'default'}
                style={{ borderRadius: 8 }}
                onClick={() => update('lineHeight', opt.value)}
              >
                {opt.label}
              </Button>
            ))}
          </Space>
        </div>
        {/* 背景 */}
        <div>
          <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 8 }}>背景</Text>
          <Space>
            {BG_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => update('bg', opt.key)}
                title={opt.label}
                style={{
                  width: 32, height: 32, borderRadius: '50%', background: opt.value,
                  border: prefs.bg === opt.key ? '2px solid #1890ff' : '2px solid #ddd',
                  cursor: 'pointer', padding: 0,
                }}
              />
            ))}
          </Space>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────
  // 渲染：左侧目录
  // ─────────────────────────────────────────────────────────
  const renderToc = () => {
    if (!tocOpen) return null;
    return (
      <div style={{
        width: 240, flexShrink: 0, background: bgConfig.key === 'dark' ? '#16213e' : '#fafafa',
        borderRight: `1px solid ${bgConfig.key === 'dark' ? '#333' : '#f0f0f0'}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transition: 'background 0.3s',
      }}>
        <div style={{
          padding: '12px 16px', borderBottom: `1px solid ${bgConfig.key === 'dark' ? '#333' : '#f0f0f0'}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
        }}>
          <Text strong style={{ fontSize: 13, color: bgConfig.text }}>目录</Text>
          <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setTocOpen(false)}
            style={{ color: bgConfig.text }} />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
          {chapters.length === 0 ? (
            <div style={{ padding: '32px 16px', textAlign: 'center' }}>
              <FileTextOutlined style={{ fontSize: 28, color: '#ccc', display: 'block', marginBottom: 8 }} />
              <Text type="secondary" style={{ fontSize: 12 }}>暂无目录</Text>
            </div>
          ) : chapters.map((ch) => {
            const title = (langMode !== 'original' && translatedChapterTitles[ch.id]) || ch.title;
            const isActive = activeChapterId === ch.id;
            return (
              <div
                key={ch.id}
                onClick={() => {
                  const el = chapterRefs.current[ch.id];
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                style={{
                  padding: `7px ${16 + (ch.level - 1) * 14}px`,
                  cursor: 'pointer',
                  background: isActive ? '#e6f7ff' : 'transparent',
                  borderRight: isActive ? '3px solid #1890ff' : '3px solid transparent',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = '#f5f5f5'; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent'; }}
              >
                <Text
                  ellipsis
                  style={{
                    fontSize: 14 - (ch.level - 1),
                    color: isActive ? '#1890ff' : bgConfig.key === 'dark' ? '#ccc' : '#444',
                    fontWeight: isActive ? 600 : ch.level === 1 ? 500 : 400,
                  }}
                  title={title}
                >
                  {title}
                </Text>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────
  // 渲染：段落文字（含划线恢复）
  // ─────────────────────────────────────────────────────────
  const renderParaText = (para) => {
    const text = para.text;
    const hl = highlights[para.id];
    if (!hl || hl.length === 0) return text;

    // 按起始位置排序，拼接高亮 span
    const sorted = [...hl].sort((a, b) => a.start - b.start);
    const parts = [];
    let cursor = 0;
    for (const h of sorted) {
      const s = Math.max(h.start, cursor);
      const e = Math.min(h.end, text.length);
      if (s > cursor) parts.push(<span key={`t${cursor}`}>{text.slice(cursor, s)}</span>);
      if (s < e) {
        const colorCfg = HIGHLIGHT_COLORS.find((c) => c.key === h.color) || HIGHLIGHT_COLORS[0];
        parts.push(
          <mark
            key={`h${s}`}
            style={{ background: colorCfg.bg, borderBottom: `2px solid ${colorCfg.border}`, padding: 0, cursor: 'default' }}
          >
            {text.slice(s, e)}
          </mark>
        );
      }
      cursor = e;
    }
    if (cursor < text.length) parts.push(<span key={`t${cursor}`}>{text.slice(cursor)}</span>);
    return parts;
  };

  // ─────────────────────────────────────────────────────────
  // 渲染：主文本阅读区
  // ─────────────────────────────────────────────────────────
  const renderTextView = () => {
    if (contentLoading) {
      return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1, background: bgConfig.value }}>
          <Spin size="large" tip="正在解析文档内容..." />
        </div>
      );
    }

    if (!contentReady) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          flex: 1, background: bgConfig.value, gap: 16,
        }}>
          {doc?.status === 'processing' || doc?.status === 'pending' ? (
            <>
              <Spin size="large" />
              <Text style={{ color: bgConfig.text }}>AI 正在处理文档，完成后自动加载流式内容...</Text>
              <Text type="secondary">进度：{Math.round(doc?.progress || 0)}%</Text>
            </>
          ) : (
            <>
              <FileTextOutlined style={{ fontSize: 48, color: '#ccc' }} />
              <Text style={{ color: bgConfig.text }}>文档内容解析中</Text>
              <Button icon={<ReloadOutlined />} onClick={fetchContent}>刷新</Button>
            </>
          )}
        </div>
      );
    }

    // 按章节分组段落
    const chapterMap = {};
    const noneChapterParas = [];
    for (const p of paragraphs) {
      if (p.chapter_id) {
        if (!chapterMap[p.chapter_id]) chapterMap[p.chapter_id] = [];
        chapterMap[p.chapter_id].push(p);
      } else {
        noneChapterParas.push(p);
      }
    }

    const contentStyle = {
      fontFamily: prefs.fontFamily,
      fontSize: prefs.fontSize,
      lineHeight: prefs.lineHeight,
      color: bgConfig.text,
      background: bgConfig.value,
      maxWidth: 720,
      margin: '0 auto',
      padding: '40px 28px 120px',
      transition: 'all 0.3s',
    };

    return (
      <div
        ref={readingAreaRef}
        style={{ flex: 1, overflowY: 'auto', background: bgConfig.value, transition: 'background 0.3s' }}
      >
        <div style={contentStyle}>
          {chapters.map((ch) => {
            const chParas = chapterMap[ch.id] || [];
            const translatedTitle = translatedChapterTitles[ch.id];
            const showTranslated = langMode !== 'original' && translatedTitle;
            const chapterTitle = langMode === 'translated' && translatedTitle ? translatedTitle : ch.title;

            return (
              <div
                key={ch.id}
                ref={(el) => { chapterRefs.current[ch.id] = el; }}
                data-chapter-id={ch.id}
                style={{ marginBottom: 48 }}
              >
                {/* 章节标题 */}
                {ch.level === 1 ? (
                  <h2 style={{
                    fontSize: prefs.fontSize + 6, fontWeight: 700, color: bgConfig.text,
                    marginBottom: 20, marginTop: 8, lineHeight: 1.4,
                    borderBottom: `2px solid ${bgConfig.key === 'dark' ? '#333' : '#f0f0f0'}`,
                    paddingBottom: 12,
                  }}>
                    {chapterTitle}
                    {langMode === 'bilingual' && translatedTitle && chapterTitle !== translatedTitle && (
                      <div style={{ fontSize: prefs.fontSize + 2, color: '#888', fontWeight: 400, marginTop: 4 }}>
                        {translatedTitle}
                      </div>
                    )}
                  </h2>
                ) : (
                  <h3 style={{
                    fontSize: prefs.fontSize + 3, fontWeight: 600, color: bgConfig.text,
                    marginBottom: 14, marginTop: 28, lineHeight: 1.4,
                  }}>
                    {chapterTitle}
                    {langMode === 'bilingual' && translatedTitle && chapterTitle !== translatedTitle && (
                      <div style={{ fontSize: prefs.fontSize + 1, color: '#888', fontWeight: 400, marginTop: 3 }}>
                        {translatedTitle}
                      </div>
                    )}
                  </h3>
                )}

                {/* 章节段落 */}
                {chParas.map((para) => (
                  <ParagraphBlock
                    key={para.id}
                    para={para}
                    langMode={langMode}
                    translationMap={translationMap}
                    translationStatus={translationStatus}
                    prefs={prefs}
                    bgConfig={bgConfig}
                    highlights={highlights}
                    renderParaText={renderParaText}
                  />
                ))}
              </div>
            );
          })}

          {/* 无章节划分的段落 */}
          {noneChapterParas.map((para) => (
            <ParagraphBlock
              key={para.id}
              para={para}
              langMode={langMode}
              translationMap={translationMap}
              translationStatus={translationStatus}
              prefs={prefs}
              bgConfig={bgConfig}
              highlights={highlights}
              renderParaText={renderParaText}
            />
          ))}

          {/* 末尾完成标记 */}
          <div style={{ textAlign: 'center', marginTop: 60, padding: '24px 0', opacity: 0.5 }}>
            <CheckCircleOutlined style={{ fontSize: 24, color: '#2dce89' }} />
            <div style={{ marginTop: 8, fontSize: 13, color: bgConfig.text }}>全文完</div>
          </div>
        </div>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────
  // 渲染：PDF 模式底部栏
  // ─────────────────────────────────────────────────────────
  const renderPdfBar = () => {
    if (mainView !== 'pdf' || !pdfTotal) return null;
    return (
      <div style={{
        height: 44, display: 'flex', alignItems: 'center', padding: '0 16px',
        borderTop: `1px solid ${bgConfig.key === 'dark' ? '#333' : '#f0f0f0'}`,
        background: bgConfig.value, flexShrink: 0, gap: 12,
      }}>
        <Button size="small" icon={<LeftOutlined />} disabled={pdfPage <= 1}
          onClick={() => pdfGoToRef.current?.(pdfPage - 1)} />
        <input
          type="range" min={1} max={pdfTotal} value={pdfPage}
          onChange={(e) => pdfGoToRef.current?.(Number(e.target.value))}
          style={{ flex: 1, accentColor: '#1890ff', cursor: 'pointer' }}
        />
        <Button size="small" icon={<RightOutlined />} disabled={pdfPage >= pdfTotal}
          onClick={() => pdfGoToRef.current?.(pdfPage + 1)} />
        <Text type="secondary" style={{ fontSize: 12, flexShrink: 0, minWidth: 60 }}>
          {pdfPage} / {pdfTotal}
        </Text>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────
  // 渲染：右侧 AI 问书面板
  // ─────────────────────────────────────────────────────────
  const renderAiPanel = () => (
    <div style={{
      width: 320, borderLeft: `1px solid ${bgConfig.key === 'dark' ? '#333' : '#f0f0f0'}`,
      display: 'flex', flexDirection: 'column', background: '#fff', flexShrink: 0,
    }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <Space><RobotOutlined style={{ color: '#1890ff', fontSize: 16 }} /><Text strong style={{ fontSize: 14 }}>AI 问书</Text></Space>
        <Space size={4}>
          <Tooltip title="新对话"><Button size="small" type="text" icon={<PlusOutlined />} onClick={() => { setSessionId(null); setChatMessages([]); }} /></Tooltip>
          <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setRightPanel(null)} />
        </Space>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px 14px' }}>
        {chatMessages.length === 0 ? (
          <div style={{ textAlign: 'center', marginTop: 40, color: '#bbb' }}>
            <RobotOutlined style={{ fontSize: 36, marginBottom: 10, display: 'block' }} />
            <Text type="secondary" style={{ fontSize: 13 }}>针对本书内容自由提问</Text>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {['这本书核心讲了什么？', '帮我总结主要内容', '这本书有哪些核心观点？'].map((q) => (
                <Button key={q} type="dashed" size="small" style={{ borderRadius: 8, textAlign: 'left', height: 'auto', whiteSpace: 'normal', padding: '6px 10px' }}
                  onClick={() => setChatInput(q)}>{q}</Button>
              ))}
            </div>
          </div>
        ) : chatMessages.map((msg, idx) => (
          <div key={idx} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 8, maxWidth: '90%', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
              <div style={{ width: 28, height: 28, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: msg.role === 'user' ? '#1890ff' : '#f0f0f0', color: msg.role === 'user' ? '#fff' : '#666', fontSize: 11, fontWeight: 700 }}>
                {msg.role === 'user' ? '我' : 'AI'}
              </div>
              <div style={{ padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.7, background: msg.role === 'user' ? '#1890ff' : '#f5f5f5', color: msg.role === 'user' ? '#fff' : '#333', wordBreak: 'break-word', whiteSpace: 'pre-wrap' }}>
                {msg.content}
              </div>
            </div>
          </div>
        ))}
        {chatLoading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>AI</div>
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
            placeholder="输入问题，Enter 发送…" value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onPressEnter={(e) => { if (!e.shiftKey) { e.preventDefault(); sendChat(); } }}
            disabled={chatLoading} style={{ borderRadius: 8 }}
          />
          <Button type="primary" icon={<SendOutlined />} onClick={() => sendChat()} loading={chatLoading}
            disabled={!chatInput.trim()} style={{ borderRadius: 8 }} />
        </div>
      </div>
    </div>
  );

  // ─────────────────────────────────────────────────────────
  // 渲染：右侧笔记面板
  // ─────────────────────────────────────────────────────────
  const renderNotesPanel = () => (
    <div style={{
      width: 320, borderLeft: `1px solid ${bgConfig.key === 'dark' ? '#333' : '#f0f0f0'}`,
      display: 'flex', flexDirection: 'column', background: '#fff', flexShrink: 0,
    }}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <Space>
          <EditOutlined style={{ color: '#faad14', fontSize: 16 }} />
          <Text strong style={{ fontSize: 14 }}>阅读笔记</Text>
          {notes.length > 0 && <Badge count={notes.length} style={{ backgroundColor: '#faad14' }} />}
        </Space>
        <Button size="small" type="text" icon={<CloseOutlined />} onClick={() => setRightPanel(null)} />
      </div>
      {/* 添加笔记 */}
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #f0f0f0', flexShrink: 0, background: '#fafafa' }}>
        {noteHighlight && (
          <div style={{ background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6, padding: '6px 10px', marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <Text style={{ fontSize: 12, color: '#665' }}>「{noteHighlight.slice(0, 60)}{noteHighlight.length > 60 ? '...' : ''}」</Text>
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setNoteHighlight('')} style={{ flexShrink: 0 }} />
          </div>
        )}
        <TextArea placeholder="记录你的想法..." value={noteContent} onChange={(e) => setNoteContent(e.target.value)}
          rows={3} style={{ fontSize: 13, borderRadius: 8, marginBottom: 8 }} />
        <Button type="primary" size="small" icon={<PlusOutlined />} disabled={!noteContent.trim()}
          style={{ borderRadius: 6 }}
          onClick={async () => {
            if (!noteContent.trim()) return;
            try {
              await docApi.createNote(id, { page_number: 0, content: noteContent.trim(), highlight_text: noteHighlight || undefined });
              message.success('笔记已保存');
              setNoteContent('');
              setNoteHighlight('');
              fetchNotes();
            } catch { message.error('保存失败'); }
          }}
        >保存笔记</Button>
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
                  <Button key="del" type="text" danger size="small" icon={<DeleteOutlined />}
                    onClick={async () => {
                      await docApi.deleteNote(note.id);
                      fetchNotes();
                    }} />,
                ]}
              >
                <div style={{ width: '100%', minWidth: 0 }}>
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

  // ─────────────────────────────────────────────────────────
  // 渲染：选中文字工具栏
  // ─────────────────────────────────────────────────────────
  const renderSelBar = () => {
    if (!selBar) return null;
    const x = Math.min(Math.max(selBar.x - 140, 8), window.innerWidth - 296);
    const y = Math.max(selBar.y - 56, 60);
    return (
      <div
        data-sel-bar
        style={{
          position: 'fixed', left: x, top: y, zIndex: 1100,
          background: '#1f2329', borderRadius: 10, padding: '6px 8px',
          display: 'flex', gap: 4, alignItems: 'center',
          boxShadow: '0 4px 20px rgba(0,0,0,0.28)',
        }}
      >
        {HIGHLIGHT_COLORS.map((c) => (
          <button
            key={c.key} data-sel-bar onClick={() => setActiveColor(c.key)} title={c.label}
            style={{
              width: 18, height: 18, borderRadius: '50%', background: c.bg.replace('0.45', '1').replace('0.30', '1').replace('0.28', '1'),
              border: activeColor === c.key ? `2px solid ${c.border}` : '2px solid transparent',
              cursor: 'pointer', padding: 0, flexShrink: 0,
            }}
          />
        ))}
        <Divider type="vertical" style={{ borderColor: '#444', margin: '0 2px', height: 18 }} />
        <Tooltip title="划线"><Button data-sel-bar size="small" type="text" icon={<HighlightOutlined />} onClick={handleHighlight} style={{ color: '#fff', padding: '0 6px' }} /></Tooltip>
        <Tooltip title="复制"><Button data-sel-bar size="small" type="text" icon={<CopyOutlined />} onClick={handleCopy} style={{ color: '#fff', padding: '0 6px' }} /></Tooltip>
        <Tooltip title="写笔记"><Button data-sel-bar size="small" type="text" icon={<EditOutlined />} onClick={handleNoteFromSel} style={{ color: '#fff', padding: '0 6px' }} /></Tooltip>
        <Tooltip title="AI 解释"><Button data-sel-bar size="small" type="text" icon={<RobotOutlined />} onClick={handleAiExplain} style={{ color: '#52c41a', padding: '0 6px' }} /></Tooltip>
        <Divider type="vertical" style={{ borderColor: '#444', margin: '0 2px', height: 18 }} />
        <Button data-sel-bar size="small" type="text" icon={<CloseOutlined />} onClick={() => setSelBar(null)} style={{ color: '#888', padding: '0 4px' }} />
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────
  // 主渲染
  // ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <Spin size="large" tip="加载文档..." />
      </div>
    );
  }

  if (!doc) {
    return (
      <div style={{ height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Empty description="文档不存在" extra={<Button onClick={() => navigate('/documents')}>返回文档库</Button>} />
      </div>
    );
  }

  const pdfUrl = docApi.getPdf(id);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      {renderTopBar()}

      {/* 中间主区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {renderToc()}

        {/* 主内容 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {mainView === 'text' ? renderTextView() : (
            <PdfViewer
              url={pdfUrl}
              height="100%"
              filename={`${doc.title}.pdf`}
              onPageChange={setPdfPage}
              onTotalPages={setPdfTotal}
              onGoToRef={(fn) => { pdfGoToRef.current = fn; }}
            />
          )}
          {renderPdfBar()}
        </div>

        {rightPanel === 'ai' && renderAiPanel()}
        {rightPanel === 'notes' && renderNotesPanel()}
      </div>

      {/* 阅读设置下拉 */}
      {settingsOpen && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 150 }}
          onClick={() => setSettingsOpen(false)}>
          <div onClick={(e) => e.stopPropagation()}>
            {renderSettings()}
          </div>
        </div>
      )}

      {renderSelBar()}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 段落渲染子组件
// ─────────────────────────────────────────────────────────
function ParagraphBlock({ para, langMode, translationMap, translationStatus, prefs, bgConfig, highlights, renderParaText }) {
  if (para.type === 'empty') return null;

  const originalText = renderParaText(para);
  const translatedText = translationMap[para.id];
  const isTranslating = translationStatus === 'translating' && !translatedText;

  const showOriginal = langMode === 'original' || langMode === 'bilingual';
  const showTranslated = (langMode === 'translated' || langMode === 'bilingual') && (translatedText || isTranslating);

  const baseStyle = {
    margin: 0,
    marginBottom: prefs.lineHeight * 8,
    lineHeight: prefs.lineHeight,
    color: bgConfig.text,
  };

  if (para.type === 'heading2') {
    return (
      <h3
        data-para-id={para.id}
        style={{ ...baseStyle, fontSize: prefs.fontSize + 2, fontWeight: 600, marginTop: 24, marginBottom: 12 }}
      >
        {langMode === 'translated' && translatedText ? translatedText : para.text}
        {langMode === 'bilingual' && translatedText && translatedText !== para.text && (
          <div style={{ fontSize: prefs.fontSize, color: '#888', fontWeight: 400 }}>{translatedText}</div>
        )}
      </h3>
    );
  }

  if (para.type === 'heading3') {
    return (
      <h4 data-para-id={para.id}
        style={{ ...baseStyle, fontSize: prefs.fontSize + 1, fontWeight: 600, marginTop: 16, marginBottom: 8 }}
      >
        {langMode === 'translated' && translatedText ? translatedText : para.text}
      </h4>
    );
  }

  if (para.type === 'list') {
    const text = langMode === 'translated' && translatedText ? translatedText : para.text;
    return (
      <li data-para-id={para.id}
        style={{ ...baseStyle, marginLeft: 20, marginBottom: prefs.lineHeight * 4 }}
      >
        {text}
        {langMode === 'bilingual' && translatedText && translatedText !== para.text && (
          <div style={{ color: '#888', marginTop: 2 }}>{translatedText}</div>
        )}
      </li>
    );
  }

  // body 段落
  return (
    <div data-para-id={para.id} style={{ marginBottom: prefs.lineHeight * 8 }}>
      {showOriginal && (
        <p style={{ ...baseStyle, marginBottom: showTranslated ? prefs.lineHeight * 2 : 0, textIndent: '2em' }}>
          {originalText}
        </p>
      )}
      {showTranslated && (
        isTranslating ? (
          <div style={{ height: prefs.fontSize * prefs.lineHeight * 2, background: '#f5f5f5', borderRadius: 4, marginBottom: prefs.lineHeight * 2, display: 'flex', alignItems: 'center', paddingLeft: 12 }}>
            <Spin size="small" style={{ marginRight: 8 }} />
            <Text type="secondary" style={{ fontSize: 12 }}>翻译中...</Text>
          </div>
        ) : (
          <p style={{
            ...baseStyle, marginBottom: 0, textIndent: '2em',
            color: bgConfig.key === 'dark' ? '#aaa' : '#555',
            fontSize: prefs.fontSize - 1,
            fontStyle: langMode === 'bilingual' ? 'normal' : 'normal',
            borderLeft: langMode === 'bilingual' ? '2px solid #1890ff20' : 'none',
            paddingLeft: langMode === 'bilingual' ? 10 : 0,
          }}>
            {translatedText}
          </p>
        )
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// 翻译切换按钮组件
// ─────────────────────────────────────────────────────────
function TranslationToggle({ lang, translationStatus, translationLang, langMode, setLangMode, onTriggerTranslate, bgText }) {
  const isNonChinese = lang && lang !== 'zh';
  const hasTranslation = translationStatus === 'done' || translationStatus === 'translating';
  const isTranslating = translationStatus === 'translating';
  const targetLang = lang === 'zh' ? 'en' : 'zh';

  if (!isNonChinese && !hasTranslation) {
    return (
      <Tooltip title="中译英">
        <Button size="small" type="text" icon={<GlobalOutlined />} style={{ color: bgText }}
          onClick={() => onTriggerTranslate('en')}>
          译
        </Button>
      </Tooltip>
    );
  }

  if (isTranslating) {
    return (
      <Space size={4}>
        <SyncOutlined spin style={{ color: '#1890ff' }} />
        <Text style={{ fontSize: 12, color: '#1890ff' }}>翻译中</Text>
        <Button size="small" type={langMode === 'bilingual' ? 'primary' : 'text'} style={{ color: langMode === 'bilingual' ? undefined : bgText }}
          onClick={() => setLangMode(langMode === 'bilingual' ? 'original' : 'bilingual')}>双语</Button>
      </Space>
    );
  }

  if (hasTranslation) {
    return (
      <Space size={4}>
        <Button size="small" type={langMode === 'original' ? 'primary' : 'default'}
          onClick={() => setLangMode('original')}>原文</Button>
        <Button size="small" type={langMode === 'translated' ? 'primary' : 'default'}
          onClick={() => setLangMode('translated')}>译文</Button>
        <Button size="small" type={langMode === 'bilingual' ? 'primary' : 'default'}
          icon={<SwapOutlined />}
          onClick={() => setLangMode('bilingual')}>双语</Button>
      </Space>
    );
  }

  return (
    <Tooltip title={isNonChinese ? `自动翻译为中文` : '翻译'}>
      <Button size="small" type="text" icon={<GlobalOutlined />} style={{ color: bgText }}
        onClick={() => onTriggerTranslate(targetLang)}>
        {isNonChinese ? '中译' : '译'}
      </Button>
    </Tooltip>
  );
}
