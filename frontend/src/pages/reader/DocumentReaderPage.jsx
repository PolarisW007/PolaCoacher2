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
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
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
import PdfTranslatePanel from '../../components/PdfTranslatePanel';

const { Text, Title, Paragraph } = Typography;
const { TextArea } = Input;

// ── 阅读设置常量 ──────────────────────────────────────────────
// 字号：5档，滑动条映射
const FONT_SIZE_STEPS = [
  { label: '特小', value: 14 },
  { label: '小',   value: 16 },
  { label: '中',   value: 18 },
  { label: '大',   value: 20 },
  { label: '特大', value: 22 },
];

const FONT_FAMILY_OPTIONS = [
  { label: '默认',     value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif', sample: '文' },
  { label: '宋体',     value: '"SimSun", "STSong", serif', sample: '文' },
  { label: '黑体',     value: '"SimHei", "STHeiti", sans-serif', sample: '文' },
  { label: '楷体',     value: '"KaiTi", "STKaiti", cursive', sample: '文' },
  { label: '寒蝉正楷', value: '"寒蝉正楷体", "ChaCheerRegularKai", "KaiTi", cursive', sample: '文' },
  { label: '仓耳今楷', value: '"仓耳今楷05", "TsangerJinKai05", "KaiTi", cursive', sample: '文' },
  { label: '钉钉进步', value: '"DingTalk JinBuTi", "钉钉进步体", sans-serif', sample: '文' },
  { label: '汇文正楷', value: '"Huiwen-mincho", "汇文正楷", "KaiTi", cursive', sample: '文' },
];

// 纯色背景
const SOLID_BG_OPTIONS = [
  { label: '白色', value: '#ffffff', text: '#1a1a1a', key: 'white', type: 'solid' },
  { label: '护眼', value: '#f5f0e8', text: '#3a3028', key: 'warm',  type: 'solid' },
  { label: '绿色', value: '#e8f5e9', text: '#1b4332', key: 'green', type: 'solid' },
  { label: '夜间', value: '#1a1a2e', text: '#e0e0e0', key: 'dark',  type: 'solid' },
];

// 背景图片选项（4张竖版图，响应式展示）
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const STARRY_BG_OPTIONS = [
  { label: '星空一', key: 'star1', type: 'image', url: `${BASE}/bg/s1.webp`, thumb: `${BASE}/bg/thumb1.webp`, value: '#060810', text: '#e8e8e8' },
  { label: '星空二', key: 'star2', type: 'image', url: `${BASE}/bg/s2.webp`, thumb: `${BASE}/bg/thumb2.webp`, value: '#060810', text: '#e8e8e8' },
  { label: '星空三', key: 'star3', type: 'image', url: `${BASE}/bg/s3.webp`, thumb: `${BASE}/bg/thumb3.webp`, value: '#060810', text: '#e8e8e8' },
  { label: '星空四', key: 'star4', type: 'image', url: `${BASE}/bg/s4.webp`, thumb: `${BASE}/bg/thumb4.webp`, value: '#060810', text: '#e8e8e8' },
];

const BG_OPTIONS = [...SOLID_BG_OPTIONS, ...STARRY_BG_OPTIONS];

const LINE_HEIGHT_OPTIONS = [
  { label: '紧凑', value: 1.6 },
  { label: '标准', value: 1.9 },
  { label: '宽松', value: 2.4 },
];
const HIGHLIGHT_COLORS = [
  { key: 'yellow', bg: 'rgba(255, 241, 0, 0.45)', border: '#fadb14', label: '黄色' },
  { key: 'green',  bg: 'rgba(82, 196, 26, 0.30)', border: '#52c41a', label: '绿色' },
  { key: 'blue',   bg: 'rgba(24, 144, 255, 0.28)', border: '#1890ff', label: '蓝色' },
  { key: 'pink',   bg: 'rgba(235, 47, 150, 0.28)', border: '#eb2f96', label: '粉色' },
];

const PREFS_KEY = 'reader_prefs_v2';
const defaultPrefs = { fontSize: 18, fontFamily: FONT_FAMILY_OPTIONS[0].value, bg: BG_OPTIONS[0].key, lineHeight: 1.9 };

// 图片背景时用各自的深色底色，图片通过 <img> 绝对定位叠放
function getBgStyle(bgConfig) {
  if (bgConfig.type === 'image') {
    return { background: bgConfig.value || '#0d0d1a' };
  }
  return { background: bgConfig.value };
}

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

// ── 渐进式背景图组件 ──────────────────────────────────────────
// 先展示 1KB 的 thumb，原图加载完成后无缝替换，避免白屏等待
const BG_IMG_STYLE = `
  .reader-bg-img {
    position: fixed;
    top: 0; left: 0;
    z-index: 0;
    pointer-events: none;
    display: block;
    transition: opacity 0.6s ease;
  }
  /* 横屏/PC：cover 填满视口，居中裁切 */
  @media (orientation: landscape) {
    .reader-bg-img { width: 100%; height: 100%; object-fit: cover; object-position: center; }
  }
  /* 竖屏/手机：宽度铺满，高度等比自然延伸 */
  @media (orientation: portrait) {
    .reader-bg-img { width: 100%; height: auto; object-fit: fill; object-position: top center; }
  }
  .reader-bg-overlay {
    position: fixed; inset: 0; z-index: 0; pointer-events: none;
    background: rgba(0,0,0,0.45);
  }
`;

function BgImage({ url, thumb }) {
  const [src, setSrc] = useState(thumb || url);

  useEffect(() => {
    let cancelled = false;
    setSrc(thumb || url);
    if (!thumb || thumb === url) return;
    const img = new Image();
    img.onload = () => { if (!cancelled) setSrc(url); };
    img.src = url;
    return () => { cancelled = true; };
  }, [url, thumb]);

  return (
    <>
      <style>{BG_IMG_STYLE}</style>
      <img src={src} alt="" className="reader-bg-img" draggable={false} />
      <div className="reader-bg-overlay" />
    </>
  );
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
  const [pdfTranslate, setPdfTranslate] = useState(false); // PDF 对照翻译模式

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

  // ── 沉浸式阅读态 (控制栏显隐) ─────────────────────────────
  const [controlsVisible, setControlsVisible] = useState(true);

  // ── 阅读区 ref（需要在 turnPage 前声明）────────────────────
  const readingAreaRef = useRef(null);
  const contentContainerRef = useRef(null);

  // ── scroll-snap 横向翻页相关 ────────────────────────────
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [totalPagesComputed, setTotalPagesComputed] = useState(1);

  // 翻页函数：直接操作 scrollLeft 实现 scroll-snap 翻页
  const turnPage = useCallback((direction) => {
    const container = readingAreaRef.current;
    if (!container) return;
    const pageWidth = container.clientWidth;
    if (direction === 'next') {
      const newIdx = Math.min(currentPageIndex + 1, totalPagesComputed - 1);
      container.scrollTo({ left: newIdx * pageWidth, behavior: 'smooth' });
      setCurrentPageIndex(newIdx);
    } else if (direction === 'prev') {
      const newIdx = Math.max(currentPageIndex - 1, 0);
      container.scrollTo({ left: newIdx * pageWidth, behavior: 'smooth' });
      setCurrentPageIndex(newIdx);
    }
  }, [currentPageIndex, totalPagesComputed]);

  // 监听滚动同步更新 currentPageIndex（支持触摸/鼠标滑动）
  useEffect(() => {
    const container = readingAreaRef.current;
    if (!container) return;
    const handleScroll = () => {
      const pageWidth = container.clientWidth;
      if (pageWidth === 0) return;
      const newIdx = Math.round(container.scrollLeft / pageWidth);
      setCurrentPageIndex(newIdx);
    };
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  // ── 窗口宽度响应式（宽屏双栏） ─────────────────────────────
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  useEffect(() => {
    const handler = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  // 宽屏（>= 1100px）时两页并排
  const isDualPage = windowWidth >= 1100;

  // ── 分页组计算（提升到组件级别，用于同步 totalPagesComputed） ──
  const pageGroups = useMemo(() => {
    if (!contentReady || paragraphs.length === 0) return [];
    const allHavePage = paragraphs.some((p) => (p.page || 0) > 0);
    const groups = [];
    if (allHavePage) {
      const pageMap = new Map();
      for (const p of paragraphs) {
        const pg = p.page || 1;
        if (!pageMap.has(pg)) pageMap.set(pg, []);
        pageMap.get(pg).push(p);
      }
      const sortedPages = [...pageMap.keys()].sort((a, b) => a - b);
      for (const pg of sortedPages) {
        groups.push({ page: pg, paras: pageMap.get(pg) });
      }
    } else {
      for (const ch of chapters) {
        const chParas = paragraphs.filter(p => p.chapter_id === ch.id);
        if (chParas.length > 0) {
          groups.push({ page: ch.id, paras: chParas });
        }
      }
      const noChapterParas = paragraphs.filter(p => !p.chapter_id);
      if (noChapterParas.length > 0) groups.push({ page: 0, paras: noChapterParas });
    }
    return groups;
  }, [contentReady, paragraphs, chapters]);

  // 同步 totalPagesComputed（双栏时按 pairs 计算）
  useEffect(() => {
    const total = isDualPage ? Math.ceil(pageGroups.length / 2) : pageGroups.length;
    setTotalPagesComputed(Math.max(total, 1));
    setCurrentPageIndex(0);
    if (readingAreaRef.current) {
      readingAreaRef.current.scrollTo({ left: 0, behavior: 'auto' });
    }
  }, [pageGroups.length, isDualPage]);
  const chapterRefs = useRef({});   // {chapterId: DOM}
  const startTimeRef = useRef(Date.now());
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // ─────────────────────────────────────────────────────────
  // 当前 BG 配置
  const bgConfig = BG_OPTIONS.find((b) => b.key === prefs.bg) || BG_OPTIONS[0];
  // 星空图片背景和夜间模式都属于深色模式，统一处理
  const isDarkMode = bgConfig.key === 'dark' || bgConfig.type === 'image';

  // ─────────────────────────────────────────────────────────
  // 加载文档基础信息
  // ─────────────────────────────────────────────────────────
  const fetchDoc = useCallback(async () => {
    try {
      const res = await docApi.get(id);
      if (!isMountedRef.current) return;
      setDoc(res.data);
    } catch { if (isMountedRef.current) message.error('文档加载失败'); }
    finally { if (isMountedRef.current) setLoading(false); }
  }, [id]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);

  // ─────────────────────────────────────────────────────────
  // 加载结构化内容
  // ─────────────────────────────────────────────────────────
  const fetchContent = useCallback(async () => {
    setContentLoading(true);
    try {
      const res = await docApi.getContent(id);
      if (!isMountedRef.current) return;
      const d = res.data;
      setChapters(d.chapters || []);
      setParagraphs(d.paragraphs || []);
      setContentReady((d.paragraphs || []).length > 0);
      setTranslationStatus(d.translation_status);
      setTranslationLang(d.translation_lang);
      if (d.translation_status === 'translating') startTranslationPoll();
    } catch { /* silent */ }
    finally { if (isMountedRef.current) setContentLoading(false); }
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
      if (!isMountedRef.current) return null;
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
    if (!contentReady || pageGroups.length === 0 || !readingAreaRef.current) return;
    const saved = loadProgress(id);
    if (!saved) return;
    setTimeout(() => {
      if (saved.chapterId) {
        const firstPara = paragraphs.find(p => p.chapter_id === saved.chapterId);
        if (firstPara) {
          const rawIdx = pageGroups.findIndex(g => g.paras.includes(firstPara));
          if (rawIdx >= 0 && readingAreaRef.current) {
            const snapIdx = isDualPage ? Math.floor(rawIdx / 2) : rawIdx;
            const pageWidth = readingAreaRef.current.clientWidth;
            readingAreaRef.current.scrollTo({ left: snapIdx * pageWidth, behavior: 'auto' });
            setCurrentPageIndex(snapIdx);
          }
        }
      }
    }, 300);
  }, [contentReady, id, pageGroups, paragraphs, isDualPage]);

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
  // 键盘翻页（PDF 模式和文字模式通用）
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (mainView === 'pdf') {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') pdfGoToRef.current?.(pdfPage + 1);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') pdfGoToRef.current?.(pdfPage - 1);
      } else if (mainView === 'text' && turnPage) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') turnPage('next');
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') turnPage('prev');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [mainView, pdfPage, turnPage]);

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
      if (!isMountedRef.current) return;
      const d = res.data;
      if (d.session_id && !sessionId) setSessionId(d.session_id);
      setChatMessages((p) => [...p, { role: 'assistant', content: d.answer }]);
    } catch {
      if (isMountedRef.current) setChatMessages((p) => [...p, { role: 'assistant', content: '回答失败，请重试。' }]);
    } finally { if (isMountedRef.current) setChatLoading(false); }
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

  // ── 浏览器全屏模式 ─────────────────────────────────────────
  const [isFullscreen, setIsFullscreen] = useState(false);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {
        message.error('当前浏览器不支持全屏');
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // ─────────────────────────────────────────────────────────
  // 渲染：顶栏
  // ─────────────────────────────────────────────────────────
  const renderTopBar = () => (
    <div style={{
      height: 52, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 14px',
      background: bgConfig.type === 'image' ? 'rgba(0,0,0,0.45)' : bgConfig.key === 'dark' ? '#1a1a2e' : bgConfig.value,
      backdropFilter: bgConfig.type === 'image' ? 'blur(6px)' : 'none',
      borderBottom: `1px solid ${bgConfig.type === 'image' || bgConfig.key === 'dark' ? 'rgba(255,255,255,0.1)' : '#e8e8e8'}`,
      flexShrink: 0, gap: 10, zIndex: 100,
      position: 'absolute', top: 0, left: 0, right: 0,
      transform: controlsVisible ? 'translateY(0)' : 'translateY(-100%)',
      transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1), background 0.3s',
      boxShadow: controlsVisible ? '0 2px 8px rgba(0,0,0,0.05)' : 'none',
    }}>
      {/* 左 */}
      <Space size={6} style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
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

      {/* 右：工具区 */}
      <Space size={4} style={{ flexShrink: 0 }}>
        {/* 原文切换 + 下载按钮（仅依赖 file_type，不依赖 file_path） */}
        {doc?.file_type && (() => {
          const ft = doc.file_type?.toLowerCase();
          const pdfUrl = docApi.getPdf(id);
          const handleDownload = () => {
            const token = localStorage.getItem('token');
            const url = `${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}`;
            const a = document.createElement('a');
            a.href = url;
            a.download = `${doc.title || 'document'}.pdf`;
            a.click();
          };
          if (ft === 'pdf') {
            return (
              <>
                <Tooltip title={mainView === 'pdf' ? '切换为 AI 解析文本' : '查看原始 PDF'}>
                  <Button
                    type={mainView === 'pdf' ? 'primary' : 'text'}
                    size="small"
                    icon={<FilePdfOutlined />}
                    style={{ color: mainView === 'pdf' ? undefined : bgConfig.text }}
                    onClick={() => setMainView((v) => v === 'pdf' ? 'text' : 'pdf')}
                  >
                    PDF
                  </Button>
                </Tooltip>
                {/* 对照翻译按钮：仅在 PDF 模式显示 */}
                {mainView === 'pdf' && (
                  <Tooltip title={pdfTranslate ? '关闭对照翻译' : '开启左右对照翻译'}>
                    <Button
                      type={pdfTranslate ? 'primary' : 'text'}
                      size="small"
                      icon={<SwapOutlined />}
                      style={{ color: pdfTranslate ? undefined : bgConfig.text }}
                      onClick={() => setPdfTranslate(v => !v)}
                    >
                      对照
                    </Button>
                  </Tooltip>
                )}
                <Tooltip title="下载 PDF">
                  <Button
                    type="text" size="small"
                    icon={<span style={{ fontSize: 14 }}>⬇</span>}
                    style={{ color: bgConfig.text }}
                    onClick={handleDownload}
                  />
                </Tooltip>
              </>
            );
          }
          if (ft === 'txt' || ft === 'md') {
            return (
              <Tooltip title={mainView === 'pdf' ? '切换为 AI 解析文本' : '查看原始文件'}>
                <Button
                  type={mainView === 'pdf' ? 'primary' : 'text'}
                  size="small"
                  icon={<FileTextOutlined />}
                  style={{ color: mainView === 'pdf' ? undefined : bgConfig.text }}
                  onClick={() => setMainView((v) => v === 'pdf' ? 'text' : 'pdf')}
                >
                  原文
                </Button>
              </Tooltip>
            );
          }
          if (ft === 'docx' || ft === 'doc') {
            return (
              <Tooltip title="下载原始 Word 文件">
                <Button
                  type="text" size="small"
                  icon={<FileTextOutlined />}
                  style={{ color: bgConfig.text }}
                  onClick={() => window.open(pdfUrl, '_blank')}
                >
                  原文
                </Button>
              </Tooltip>
            );
          }
          return null;
        })()}
        {/* 重新解析（文字内容乱码时用） */}
        {contentReady && mainView === 'text' && (
          <Tooltip title="重新解析文档内容">
            <Button
              type="text" size="small"
              icon={<ReloadOutlined />}
              style={{ color: bgConfig.text, opacity: 0.6 }}
              onClick={async () => {
                try {
                  await docApi.reparse(id);
                  message.success('重新解析已开始，约30秒后刷新页面');
                  setTimeout(() => fetchContent(), 30000);
                } catch { message.error('触发失败'); }
              }}
            />
          </Tooltip>
        )}
        {/* 全屏按钮 */}
        <Tooltip title={isFullscreen ? "退出全屏" : "全屏阅读"}>
          <Button
            type="text" size="small"
            icon={<span style={{ fontSize: 14 }}>{isFullscreen ? '⛶' : '⛶'}</span>}
            onClick={toggleFullscreen}
            style={{ color: bgConfig.text }}
          >
            {isFullscreen ? '退出全屏' : '全屏'}
          </Button>
        </Tooltip>
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
            onClick={() => { setRightPanel((v) => v === 'ai' ? null : 'ai'); setControlsVisible(true); }} />
        </Tooltip>
        <Tooltip title={rightPanel === 'notes' ? '关闭笔记' : '笔记'}>
          <Button type={rightPanel === 'notes' ? 'primary' : 'text'} icon={<EditOutlined />} size="small"
            style={{ color: rightPanel === 'notes' ? undefined : bgConfig.text }}
            onClick={() => { setRightPanel((v) => v === 'notes' ? null : 'notes'); setControlsVisible(true); }} />
        </Tooltip>
      </Space>
    </div>
  );

  // ─────────────────────────────────────────────────────────
  // 渲染：阅读设置面板（下拉）
  // ─────────────────────────────────────────────────────────
  const renderSettings = () => {
    if (!settingsOpen) return null;
    const isDark = bgConfig.key === 'dark' || bgConfig.type === 'image';
    const panelBg = isDark ? 'rgba(30,30,50,0.97)' : '#fff';
    const labelColor = isDark ? '#ccc' : '#666';
    const textColor = isDark ? '#eee' : '#222';
    const borderColor = isDark ? 'rgba(255,255,255,0.15)' : '#e8e8e8';

    const update = (key, val) => {
      const next = { ...prefs, [key]: val };
      setPrefs(next);
      savePrefs(next);
    };

    // 当前字号在 FONT_SIZE_STEPS 中的 index
    const fontSizeIdx = FONT_SIZE_STEPS.findIndex(s => s.value === prefs.fontSize);
    const currentFontSizeIdx = fontSizeIdx >= 0 ? fontSizeIdx : 1;

    return (
      <div style={{
        background: panelBg,
        borderRadius: 20,
        boxShadow: '0 -8px 40px rgba(0,0,0,0.18)',
        padding: '28px 24px 24px',
        width: 420,
        color: textColor,
        backdropFilter: 'blur(12px)',
      }}>
        {/* ── 字号滑动条 ── */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 13, color: labelColor }}>字号</span>
            <span style={{ fontSize: 13, color: '#1890ff', fontWeight: 600 }}>
              {FONT_SIZE_STEPS[currentFontSizeIdx].label}（{FONT_SIZE_STEPS[currentFontSizeIdx].value}px）
            </span>
          </div>
          <div style={{ position: 'relative', padding: '0 4px' }}>
            <input
              type="range" min={0} max={4} step={1}
              value={currentFontSizeIdx}
              onChange={(e) => update('fontSize', FONT_SIZE_STEPS[Number(e.target.value)].value)}
              style={{ width: '100%', accentColor: '#1890ff', cursor: 'pointer', height: 4 }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
              {FONT_SIZE_STEPS.map((s) => (
                <span key={s.value} style={{ fontSize: 11, color: labelColor, width: 32, textAlign: 'center' }}>{s.label}</span>
              ))}
            </div>
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${borderColor}`, marginBottom: 22 }} />

        {/* ── 字体网格 ── */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 13, color: labelColor, marginBottom: 12 }}>字体</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
            {FONT_FAMILY_OPTIONS.map((opt) => {
              const isActive = prefs.fontFamily === opt.value;
              return (
                <button
                  key={opt.label}
                  onClick={() => update('fontFamily', opt.value)}
                  style={{
                    padding: '10px 4px',
                    borderRadius: 12,
                    border: isActive ? '2px solid #1890ff' : `1px solid ${borderColor}`,
                    background: isActive ? 'rgba(24,144,255,0.12)' : 'transparent',
                    cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                    transition: 'all 0.15s',
                  }}
                >
                  <span style={{ fontFamily: opt.value, fontSize: 20, color: isActive ? '#1890ff' : textColor, lineHeight: 1 }}>文</span>
                  <span style={{ fontSize: 10, color: isActive ? '#1890ff' : labelColor, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 60 }}>{opt.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${borderColor}`, marginBottom: 22 }} />

        {/* ── 行距 ── */}
        <div style={{ marginBottom: 22 }}>
          <div style={{ fontSize: 13, color: labelColor, marginBottom: 12 }}>行距</div>
          <div style={{ display: 'flex', gap: 10 }}>
            {LINE_HEIGHT_OPTIONS.map((opt) => {
              const isActive = prefs.lineHeight === opt.value;
              return (
                <button
                  key={opt.value}
                  onClick={() => update('lineHeight', opt.value)}
                  style={{
                    flex: 1, padding: '8px 0',
                    borderRadius: 12,
                    border: isActive ? '2px solid #1890ff' : `1px solid ${borderColor}`,
                    background: isActive ? 'rgba(24,144,255,0.12)' : 'transparent',
                    cursor: 'pointer',
                    fontSize: 13, color: isActive ? '#1890ff' : textColor,
                    fontWeight: isActive ? 600 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div style={{ borderTop: `1px solid ${borderColor}`, marginBottom: 22 }} />

        {/* ── 背景：纯色 + 星空 ── */}
        <div>
          <div style={{ fontSize: 13, color: labelColor, marginBottom: 12 }}>背景</div>
          {/* 纯色行 */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 14, alignItems: 'center' }}>
            {SOLID_BG_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                onClick={() => update('bg', opt.key)}
                title={opt.label}
                style={{
                  width: 38, height: 38, borderRadius: '50%', background: opt.value,
                  border: prefs.bg === opt.key ? '2.5px solid #1890ff' : `2px solid ${borderColor}`,
                  boxShadow: prefs.bg === opt.key ? '0 0 0 3px rgba(24,144,255,0.25)' : 'none',
                  cursor: 'pointer', padding: 0, transition: 'all 0.2s', flexShrink: 0,
                }}
              />
            ))}
          </div>
          {/* 背景图缩略图行 */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 4 }}>
            {STARRY_BG_OPTIONS.map((opt) => {
              const isActive = prefs.bg === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => update('bg', opt.key)}
                  title={opt.label}
                  style={{
                    width: 64, height: 44, borderRadius: 10, padding: 0,
                    border: isActive ? '2.5px solid #1890ff' : `2px solid ${borderColor}`,
                    boxShadow: isActive ? '0 0 0 3px rgba(24,144,255,0.25)' : 'none',
                    cursor: 'pointer', transition: 'all 0.2s', flexShrink: 0,
                    overflow: 'hidden', background: '#eee', position: 'relative',
                  }}
                >
                  <img
                    src={opt.thumb || opt.url}
                    alt={opt.label}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </button>
              );
            })}
          </div>
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
        width: 240, flexShrink: 0, background: isDarkMode ? '#16213e' : '#fafafa',
        borderRight: `1px solid ${isDarkMode ? '#333' : '#f0f0f0'}`,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        transition: 'background 0.3s',
      }}>
        <div style={{
          padding: '12px 16px', borderBottom: `1px solid ${isDarkMode ? '#333' : '#f0f0f0'}`,
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
                  // scroll-snap 方案：找到包含该章节第一段的页的 index
                  const firstParaOfChapter = paragraphs.find(p => p.chapter_id === ch.id);
                  if (firstParaOfChapter) {
                    const rawPageIdx = pageGroups.findIndex(g => g.paras.includes(firstParaOfChapter));
                    if (rawPageIdx >= 0 && readingAreaRef.current) {
                      const snapIdx = isDualPage ? Math.floor(rawPageIdx / 2) : rawPageIdx;
                      const pageWidth = readingAreaRef.current.clientWidth;
                      readingAreaRef.current.scrollTo({ left: snapIdx * pageWidth, behavior: 'smooth' });
                      setCurrentPageIndex(snapIdx);
                    }
                  }
                  setTocOpen(false);
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
                    color: isActive ? '#1890ff' : isDarkMode ? '#ccc' : '#444',
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

  // 翻页函数
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
              <Text type="secondary">进度：{Math.round(doc?.progress || 0)}%{doc?.processing_step ? ` — ${doc.processing_step}` : ''}</Text>
            </>
          ) : doc?.status === 'importing' ? (
            <>
              <Spin size="large" />
              <Text style={{ color: bgConfig.text }}>PDF 正在下载中，请返回书架等待</Text>
              <Text type="secondary">{doc?.processing_step || '正在从书库下载...'}</Text>
              <Button type="primary" onClick={() => navigate('/')}>返回书架</Button>
            </>
          ) : doc?.status === 'error' || doc?.status === 'pending_upload' ? (
            <>
              <FileTextOutlined style={{ fontSize: 48, color: '#ff4d4f' }} />
              <Text style={{ color: bgConfig.text }}>{doc?.error_detail || '文档处理失败'}</Text>
              <Button type="primary" onClick={() => navigate('/')}>返回书架</Button>
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

    // pageGroups 已在组件级 useMemo 中计算，这里直接使用
    const renderPageContent = (paras) => {
      return paras.map((para) => (
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
          apiBase={`${import.meta.env.BASE_URL.replace(/\/$/, '')}/api`}
        />
      ));
    };

    return (
      <div
        style={{ 
          flex: 1, 
          overflow: 'hidden', 
          ...getBgStyle(bgConfig),
          transition: 'background 0.3s', 
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* 背景图片 + 半透明磨砂遮罩（响应式 + 渐进式加载） */}
        {bgConfig.type === 'image' && (
          <BgImage url={bgConfig.url} thumb={bgConfig.thumb} />
        )}
        {/* 主阅读区 - 横向 scroll-snap 容器 */}
        <div
          ref={readingAreaRef}
          onClick={(e) => {
            if (window.getSelection().toString().length > 0) return;
            if (e.target.closest('button') || e.target.closest('input')) return;
            const rect = readingAreaRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left;
            if (x < rect.width * 0.2) { turnPage('prev'); return; }
            if (x > rect.width * 0.8) { turnPage('next'); return; }
            setControlsVisible(v => !v);
          }}
          style={{
            flex: 1,
            display: 'flex',
            overflowX: 'hidden',
            overflowY: 'hidden',
            scrollSnapType: 'x mandatory',
            scrollBehavior: 'smooth',
            position: 'relative',
          }}
        >
          {pageGroups.length === 0 ? (
            <div style={{
              minWidth: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 16, padding: 40,
            }}>
              <FileTextOutlined style={{ fontSize: 48, color: '#ccc' }} />
              <Text style={{ color: bgConfig.text }}>暂无内容</Text>
            </div>
          ) : (() => {
            // 渲染单页内容的辅助函数
            const renderOnePageContent = (paras, pageChapters, globalIdx) => (
              <>
                {pageChapters.map(ch => {
                  const translatedTitle = translatedChapterTitles[ch.id];
                  const title = langMode === 'translated' && translatedTitle ? translatedTitle : ch.title;
                  return (
                    <div key={ch.id} ref={el => { chapterRefs.current[ch.id] = el; }} data-chapter-id={ch.id}>
                      {ch.level === 1 ? (
                        <h2 style={{
                          fontSize: prefs.fontSize + 6, fontWeight: 700, color: bgConfig.text,
                          marginBottom: 20, marginTop: 8, lineHeight: 1.4,
                          borderBottom: `2px solid ${bgConfig.type === 'image' || bgConfig.key === 'dark' ? 'rgba(255,255,255,0.15)' : '#f0f0f0'}`,
                          paddingBottom: 12,
                        }}>
                          {title}
                          {langMode === 'bilingual' && translatedTitle && translatedTitle !== ch.title && (
                            <div style={{ fontSize: prefs.fontSize + 2, color: bgConfig.text, opacity: 0.6, fontWeight: 400, marginTop: 4 }}>{translatedTitle}</div>
                          )}
                        </h2>
                      ) : (
                        <h3 style={{
                          fontSize: prefs.fontSize + 3, fontWeight: 600, color: bgConfig.text,
                          marginBottom: 14, marginTop: 28, lineHeight: 1.4,
                        }}>
                          {title}
                          {langMode === 'bilingual' && translatedTitle && translatedTitle !== ch.title && (
                            <div style={{ fontSize: prefs.fontSize + 1, color: bgConfig.text, opacity: 0.6, fontWeight: 400, marginTop: 3 }}>{translatedTitle}</div>
                          )}
                        </h3>
                      )}
                    </div>
                  );
                })}
                {renderPageContent(paras)}
                {globalIdx === pageGroups.length - 1 && (
                  <div style={{ textAlign: 'center', marginTop: 48, padding: '24px 0', opacity: 0.5 }}>
                    <CheckCircleOutlined style={{ fontSize: 24, color: '#2dce89' }} />
                    <div style={{ marginTop: 8, fontSize: 13, color: bgConfig.text }}>全文完</div>
                  </div>
                )}
              </>
            );

            const getPageChapters = (paras) => {
              const ids = [...new Set(paras.map(p => p.chapter_id).filter(Boolean))];
              return ids.map(cid => chapters.find(c => c.id === cid)).filter(Boolean)
                .filter(ch => {
                  const firstPara = paragraphs.find(p => p.chapter_id === ch.id);
                  return paras.includes(firstPara);
                });
            };

            // 每页固定视口高度，禁止页内下滚，内容超出由翻页解决
            const pageStyle = {
              height: '100%',
              overflow: 'hidden',   // 禁止页内滚动
              boxSizing: 'border-box',
              padding: '56px 52px 72px',
              fontFamily: prefs.fontFamily,
              fontSize: prefs.fontSize,
              lineHeight: prefs.lineHeight,
              color: bgConfig.text,
              position: 'relative',
              zIndex: 1,            // 内容层在背景图之上
            };

            if (isDualPage) {
              const pairs = [];
              for (let i = 0; i < pageGroups.length; i += 2) {
                pairs.push([pageGroups[i], pageGroups[i + 1] || null]);
              }
              return pairs.map(([left, right], pairIdx) => (
                <div
                  key={`pair-${pairIdx}`}
                  ref={pairIdx === 0 ? contentContainerRef : null}
                  style={{
                    minWidth: '100%', maxWidth: '100%', height: '100%',
                    flexShrink: 0, scrollSnapAlign: 'start',
                    display: 'flex', boxSizing: 'border-box',
                  }}
                >
                  <div style={{
                    ...pageStyle, flex: 1,
                    borderRight: `1px solid ${isDarkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
                  }}>
                    {renderOnePageContent(left.paras, getPageChapters(left.paras), pairIdx * 2)}
                  </div>
                  <div style={{ ...pageStyle, flex: 1 }}>
                    {right && renderOnePageContent(right.paras, getPageChapters(right.paras), pairIdx * 2 + 1)}
                  </div>
                </div>
              ));
            }

            // 单栏
            return pageGroups.map(({ page, paras }, idx) => (
              <div
                key={page}
                ref={idx === 0 ? contentContainerRef : null}
                style={{ ...pageStyle, minWidth: '100%', maxWidth: '100%', scrollSnapAlign: 'start', flexShrink: 0 }}
              >
                {renderOnePageContent(paras, getPageChapters(paras), idx)}
              </div>
            ));
          })()}
        </div>

        {/* 底部进度提示 */}
        <div style={{
          position: 'absolute', bottom: controlsVisible ? 64 : 16, left: 0, right: 0,
          textAlign: 'center', pointerEvents: 'none',
          color: bgConfig.text, opacity: 0.4, fontSize: 12,
          transition: 'bottom 0.3s',
        }}>
          {currentPageIndex + 1} / {totalPagesComputed}
        </div>

        {/* 底部翻页栏 */}
        <div style={{
          position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 100,
          background: bgConfig.type === 'image' ? 'rgba(0,0,0,0.5)' : bgConfig.key === 'dark' ? 'rgba(26,26,46,0.96)' : 'rgba(255,255,255,0.96)',
          backdropFilter: 'blur(8px)',
          borderTop: `1px solid ${bgConfig.type === 'image' || bgConfig.key === 'dark' ? 'rgba(255,255,255,0.1)' : '#eee'}`,
          padding: '12px 24px',
          display: 'flex', alignItems: 'center', gap: 12,
          transform: controlsVisible ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        }}>
          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-start' }}>
            <Tooltip title="目录">
              <Button type="text" icon={<MenuOutlined style={{ fontSize: 20 }} />} onClick={() => setTocOpen(!tocOpen)} style={{ color: bgConfig.text }} />
            </Tooltip>
          </div>

          <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: 12, maxWidth: 600 }}>
            <Button type="text" icon={<LeftOutlined />}
              disabled={currentPageIndex <= 0}
              onClick={() => turnPage('prev')}
              style={{ color: bgConfig.text }} />
            <div style={{ flex: 1 }}>
              <input type="range" min={1} max={totalPagesComputed} value={currentPageIndex + 1}
                onChange={(e) => {
                  const newIdx = Number(e.target.value) - 1;
                  setCurrentPageIndex(newIdx);
                  if (readingAreaRef.current) {
                    const pageWidth = readingAreaRef.current.clientWidth;
                    readingAreaRef.current.scrollTo({ left: newIdx * pageWidth, behavior: 'smooth' });
                  }
                }}
                style={{ width: '100%', accentColor: '#1890ff', cursor: 'pointer' }} />
            </div>
            <Text style={{ fontSize: 12, flexShrink: 0, color: bgConfig.text, opacity: 0.7 }}>
              {currentPageIndex + 1} / {totalPagesComputed} 页
            </Text>
            <Button type="text" icon={<RightOutlined />}
              disabled={currentPageIndex >= totalPagesComputed - 1}
              onClick={() => turnPage('next')}
              style={{ color: bgConfig.text }} />
          </div>

          <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Tooltip title="阅读设置">
              <Button type="text" icon={<SettingOutlined style={{ fontSize: 20 }} />}
                onClick={() => setSettingsOpen(!settingsOpen)} style={{ color: bgConfig.text }} />
            </Tooltip>
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
        borderTop: `1px solid ${isDarkMode ? '#333' : '#f0f0f0'}`,
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
      width: 320, borderLeft: `1px solid ${isDarkMode ? '#333' : '#f0f0f0'}`,
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
      width: 320, borderLeft: `1px solid ${isDarkMode ? '#333' : '#f0f0f0'}`,
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
  const docFileType = doc?.file_type?.toLowerCase();

  const renderOriginalView = () => {
    // 用 position:absolute 精确定位：从顶栏下方(52px)到底部，避免顶栏遮盖 PdfViewer 工具栏
    const wrapStyle = {
      position: 'absolute',
      top: 52,   // app 顶栏高度
      left: 0,
      right: 0,
      bottom: 0,
      display: 'flex',
      flexDirection: 'column',
      zIndex: 10,
    };

    if (docFileType === 'pdf') {
      return (
        <div style={{ ...wrapStyle, flexDirection: 'row' }}>
          {/* 左侧 PDF 原文 */}
          <div style={{
            flex: pdfTranslate ? '0 0 50%' : '1 1 100%',
            minWidth: 0,
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            transition: 'flex 0.25s ease',
          }}>
            <PdfViewer
              url={pdfUrl}
              height="100%"
              filename={`${doc.title}.pdf`}
              onPageChange={setPdfPage}
              onTotalPages={setPdfTotal}
              onGoToRef={(fn) => { pdfGoToRef.current = fn; }}
            />
          </div>
          {/* 右侧对照译文 */}
          {pdfTranslate && (
            <div style={{
              flex: '0 0 50%',
              minWidth: 0,
              height: '100%',
              overflow: 'hidden',
            }}>
              <PdfTranslatePanel
                docId={id}
                page={pdfPage || 1}
                targetLang={doc?.language === 'zh' ? 'en' : 'zh'}
              />
            </div>
          )}
        </div>
      );
    }
    if (docFileType === 'txt' || docFileType === 'md') {
      const token = localStorage.getItem('token');
      const rawUrl = `${pdfUrl}${pdfUrl.includes('?') ? '&' : '?'}token=${token}`;
      return (
        <div style={wrapStyle}>
          <iframe
            src={rawUrl}
            title="原始文件"
            style={{ flex: 1, border: 'none', width: '100%', height: '100%',
              background: docFileType === 'md' ? '#fff' : '#1a1a1a' }}
          />
        </div>
      );
    }
    return null;
  };

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative' }}>
      {renderTopBar()}

      {/* 中间主区 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>
        {renderToc()}

        {/* 主内容 */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {mainView === 'text' ? renderTextView() : renderOriginalView()}
          {renderPdfBar()}
        </div>

        {rightPanel === 'ai' && renderAiPanel()}
        {rightPanel === 'notes' && renderNotesPanel()}
      </div>

      {/* 阅读设置下拉 (固定在底部控制栏上方) */}
      {settingsOpen && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 150 }}
          onClick={() => setSettingsOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ position: 'absolute', bottom: 64, right: 24 }}>
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
function ParagraphBlock({ para, langMode, translationMap, translationStatus, prefs, bgConfig, highlights, renderParaText, apiBase = '' }) {
  if (para.type === 'empty') return null;

  // ── 图片节点 ────────────────────────────────────────────
  if (para.type === 'image') {
    const src = para.src?.startsWith('http') ? para.src : `${apiBase}${para.src}`;
    return (
      <div style={{ textAlign: 'center', margin: '20px 0' }}>
        <img
          src={src}
          alt={para.text || '图片'}
          style={{
            maxWidth: '100%',
            maxHeight: 480,
            objectFit: 'contain',
            borderRadius: 8,
            boxShadow: '0 2px 12px rgba(0,0,0,0.12)',
          }}
          onError={(e) => { e.target.style.display = 'none'; }}
        />
      </div>
    );
  }

  const originalText = renderParaText(para);
  const translatedText = translationMap[para.id];
  const isTranslating = translationStatus === 'translating' && !translatedText;

  const showOriginal = langMode === 'original' || langMode === 'bilingual';
  const showTranslated = (langMode === 'translated' || langMode === 'bilingual') && (translatedText || isTranslating);

  const baseStyle = {
    margin: 0,
    marginBottom: `${prefs.lineHeight * 0.8}em`,
    lineHeight: prefs.lineHeight,
    color: bgConfig.text,
    fontSize: prefs.fontSize,
    fontFamily: prefs.fontFamily,
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
            color: (bgConfig.key === 'dark' || bgConfig.type === 'image') ? '#aaa' : '#555',
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

  // 循环顺序：原文 → 译文 → 双语 → 原文…
  const LANG_CYCLE = ['original', 'translated', 'bilingual'];
  const LANG_LABEL = { original: '原文', translated: '译文', bilingual: '双语' };
  const LANG_ICON  = { original: null, translated: null, bilingual: <SwapOutlined /> };
  const cycleNext = () => {
    const idx = LANG_CYCLE.indexOf(langMode);
    setLangMode(LANG_CYCLE[(idx + 1) % LANG_CYCLE.length]);
  };

  if (isTranslating) {
    return (
      <Space size={4}>
        <SyncOutlined spin style={{ color: '#1890ff' }} />
        <Text style={{ fontSize: 12, color: '#1890ff' }}>翻译中</Text>
        <Tooltip title={`当前：${LANG_LABEL[langMode]}，点击切换`}>
          <Button size="small" type="primary" icon={LANG_ICON[langMode]} onClick={cycleNext}>
            {LANG_LABEL[langMode]}
          </Button>
        </Tooltip>
      </Space>
    );
  }

  if (hasTranslation) {
    return (
      <Tooltip title={`当前：${LANG_LABEL[langMode]}，点击切换`}>
        <Button size="small" type="primary" icon={LANG_ICON[langMode]} onClick={cycleNext}>
          {LANG_LABEL[langMode]}
        </Button>
      </Tooltip>
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
