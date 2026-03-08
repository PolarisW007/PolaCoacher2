import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Spin, Empty, Button, Space, Typography, Tag, Card, Input, Divider,
  message, Tooltip, Badge, Select, Switch, Modal, Slider, List, Skeleton,
  Dropdown,
} from 'antd';
import {
  ArrowLeftOutlined, LeftOutlined, RightOutlined,
  EditOutlined, BulbOutlined, BookOutlined, TranslationOutlined,
  SaveOutlined, GlobalOutlined, LockOutlined, SoundOutlined,
  PauseCircleOutlined, PlayCircleOutlined, FilePdfOutlined,
  ShareAltOutlined, DownloadOutlined, StopOutlined, SendOutlined,
  MessageOutlined, PlusOutlined, DeleteOutlined, CloseOutlined,
  ReadOutlined, FileTextOutlined, MenuFoldOutlined, CopyOutlined,
  WechatOutlined, HeartOutlined, CheckCircleOutlined, TrophyOutlined,
} from '@ant-design/icons';
import { docApi, lectureNoteApi, ttsApi, historyApi, settingsApi, analysisApi } from '../../api/documents';
import PdfViewer from '../../components/PdfViewer';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

function splitSentences(text) {
  if (!text) return [];
  return text.split(/(?<=[。！？.!?\n])/g).filter((s) => s.trim());
}

function formatTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const RATE_OPTIONS = [
  { value: 0.5, label: '0.5x' },
  { value: 0.75, label: '0.75x' },
  { value: 1, label: '1x' },
  { value: 1.25, label: '1.25x' },
  { value: 1.5, label: '1.5x' },
  { value: 2, label: '2x' },
];

const TAG_OPTIONS = [
  { label: '技术', value: '技术' },
  { label: '学术', value: '学术' },
  { label: '商业', value: '商业' },
  { label: '人文', value: '人文' },
  { label: '其他', value: '其他' },
];

const RIGHT_PANEL_TABS = [
  { key: 'pdf', label: 'PDF', icon: <FilePdfOutlined /> },
  { key: 'chat', label: 'AI问答', icon: <MessageOutlined /> },
  { key: 'notes', label: '备注', icon: <EditOutlined /> },
];

export default function DocumentStudyPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);

  // 记录已听完的页面索引（持久化到 localStorage）
  const [listenedPages, setListenedPages] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('listenedPages') || '{}');
      return new Set(saved[id] || []);
    } catch { return new Set(); }
  });

  const markPageListened = (pageIdx) => {
    setListenedPages(prev => {
      const next = new Set(prev);
      next.add(pageIdx);
      try {
        const all = JSON.parse(localStorage.getItem('listenedPages') || '{}');
        all[id] = [...next];
        localStorage.setItem('listenedPages', JSON.stringify(all));
      } catch { /* ignore */ }
      return next;
    });
  };

  const [currentPage, setCurrentPage] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('studyProgress') || '{}');
      return saved[id]?.page || 0;
    } catch { return 0; }
  });

  // Right panel
  const [rightPanel, setRightPanel] = useState('pdf');
  const [rightPanelVisible, setRightPanelVisible] = useState(true);

  // Lecture notes
  const [noteContent, setNoteContent] = useState('');
  const [lectureNotes, setLectureNotes] = useState({});
  const [savingNote, setSavingNote] = useState(false);

  // Reading notes (from DocumentReader)
  const [readingNotes, setReadingNotes] = useState([]);
  const [readingNotesLoading, setReadingNotesLoading] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState('');
  const [newNoteHighlight, setNewNoteHighlight] = useState('');
  const [addingNote, setAddingNote] = useState(false);

  // Audio state
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioLoading, setAudioLoading] = useState(false);
  const [autoPlayNext, setAutoPlayNext] = useState(true);
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [volume, setVolume] = useState(() => {
    try { return parseFloat(localStorage.getItem('playerVolume') || '0.8'); } catch { return 0.8; }
  });
  const [playbackRate, setPlaybackRate] = useState(() => {
    try { return parseFloat(localStorage.getItem('playerRate') || '1'); } catch { return 1; }
  });
  const [currentSentenceIdx, setCurrentSentenceIdx] = useState(-1);
  const [audioReadyPages, setAudioReadyPages] = useState({});

  // Translation toggle
  const [showTranslation, setShowTranslation] = useState(false);

  // Inline translate
  const [translatePopover, setTranslatePopover] = useState({ visible: false, x: 0, y: 0, text: '' });
  const [translatedText, setTranslatedText] = useState('');
  const [translating, setTranslating] = useState(false);
  const [targetLang, setTargetLang] = useState('zh');

  // AI Chat
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [sessionId, setSessionId] = useState(null);
  const chatEndRef = useRef(null);

  // Publish modal
  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishTitle, setPublishTitle] = useState('');
  const [publishDesc, setPublishDesc] = useState('');
  const [publishTags, setPublishTags] = useState([]);
  const [publishing, setPublishing] = useState(false);

  // Share modal
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareType, setShareType] = useState(null); // 'xhs' | 'moments'
  const [sharePost, setSharePost] = useState(null);
  const [shareLoading, setShareLoading] = useState(false);

  // Completion card modal
  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [completionData, setCompletionData] = useState(null);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionCoverUrl, setCompletionCoverUrl] = useState(null);

  // Lecture generation
  const [generating, setGenerating] = useState(false);

  // Refs
  const saveTimerRef = useRef(null);
  const audioRef = useRef(null);
  const sentenceTimerRef = useRef(null);
  const thumbnailListRef = useRef(null);
  const startTimeRef = useRef(Date.now());
  const lectureTimerRef = useRef(null);
  const lectureTimeoutRef = useRef(null);

  const slides = useMemo(() => doc?.lecture_slides || [], [doc]);
  const hasLecture = slides.length > 0;
  const slide = slides[currentPage] || {};
  const sentences = useMemo(() => splitSentences(slide.lecture_text), [slide.lecture_text]);
  const isProcessing = doc?.status === 'processing' || doc?.status === 'pending';
  const hasPpt = doc?.ppt_content && doc.ppt_content.length > 0;
  const isPublished = doc?.lecture_visibility === 'public' || doc?.is_published;
  const pdfUrl = docApi.getPdf(id);
  const totalPages = hasLecture ? slides.length : (doc?.page_count || 0);
  const hasPrev = currentPage > 0;
  const hasNext = currentPage < totalPages - 1;

  // ===== Data fetching =====

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

  const fetchLectureNotes = useCallback(async () => {
    try {
      const res = await lectureNoteApi.list(id);
      const noteMap = {};
      if (res.data && Array.isArray(res.data)) {
        res.data.forEach((n) => { noteMap[n.page_number] = n.content; });
      }
      setLectureNotes(noteMap);
    } catch { /* silent */ }
  }, [id]);

  const fetchReadingNotes = useCallback(async () => {
    setReadingNotesLoading(true);
    try {
      const res = await docApi.listNotes(id);
      setReadingNotes(res.data || []);
    } catch { /* silent */ } finally {
      setReadingNotesLoading(false);
    }
  }, [id]);

  const fetchVoices = useCallback(async () => {
    try {
      const res = await ttsApi.voices();
      const list = res.data || [];
      setVoices(list);
      if (list.length > 0 && !selectedVoice) {
        setSelectedVoice(list[0].id || list[0].name || list[0]);
      }
    } catch { /* silent */ }
  }, [selectedVoice]);

  const fetchAudioStatus = useCallback(async () => {
    try {
      const res = await ttsApi.audioStatus(id);
      const ready = {};
      if (res.data?.ready_pages) {
        res.data.ready_pages.forEach((p) => { ready[p] = true; });
      }
      setAudioReadyPages(ready);
    } catch { /* silent */ }
  }, [id]);

  // ===== Preload audio for upcoming pages =====
  const preloadAudio = useCallback(async (pages) => {
    try {
      await ttsApi.preload({ doc_id: parseInt(id), pages });
    } catch { /* silent */ }
  }, [id]);

  // ===== Initial load =====
  useEffect(() => {
    fetchDoc();
    fetchLectureNotes();
    fetchVoices();
    fetchAudioStatus();
  }, [fetchDoc, fetchLectureNotes, fetchVoices, fetchAudioStatus]);

  useEffect(() => {
    historyApi.record({ document_id: id, action: 'study', last_page: currentPage, duration_seconds: 0 }).catch(() => {});
    return () => {
      const seconds = Math.round((Date.now() - startTimeRef.current) / 1000);
      historyApi.record({ document_id: id, action: 'study', last_page: currentPage, duration_seconds: seconds }).catch(() => {});
    };
  }, [id]);

  // Preload first pages on enter
  useEffect(() => {
    if (hasLecture) {
      preloadAudio([0, 1, 2].filter(p => p < slides.length));
    }
  }, [hasLecture, slides.length]);

  // Preload next page on page change
  useEffect(() => {
    if (hasLecture && currentPage + 1 < slides.length) {
      preloadAudio([currentPage + 1]);
    }
    // Save progress
    try {
      const saved = JSON.parse(localStorage.getItem('studyProgress') || '{}');
      saved[id] = { page: currentPage, timestamp: Date.now() };
      localStorage.setItem('studyProgress', JSON.stringify(saved));
    } catch { /* silent */ }
  }, [currentPage, hasLecture, slides.length, id]);

  // Auto-refresh when processing
  useEffect(() => {
    if (!doc) return;
    if (isProcessing) {
      const timer = setInterval(fetchDoc, 3000);
      return () => clearInterval(timer);
    }
  }, [doc, fetchDoc, isProcessing]);

  // Set note content on page change
  useEffect(() => {
    setNoteContent(lectureNotes[currentPage + 1] || '');
  }, [currentPage, lectureNotes]);

  // Audio cleanup on page change
  useEffect(() => {
    stopAudio();
    setCurrentSentenceIdx(-1);
    setAudioProgress(0);
    setAudioDuration(0);
  }, [currentPage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
      if (sentenceTimerRef.current) clearInterval(sentenceTimerRef.current);
      if (lectureTimerRef.current) clearInterval(lectureTimerRef.current);
      if (lectureTimeoutRef.current) clearTimeout(lectureTimeoutRef.current);
    };
  }, []);

  // Scroll active thumbnail into view
  useEffect(() => {
    if (thumbnailListRef.current) {
      const activeEl = thumbnailListRef.current.querySelector(`[data-page-idx="${currentPage}"]`);
      if (activeEl) activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [currentPage]);

  // Persist audio settings
  useEffect(() => {
    try { localStorage.setItem('playerVolume', String(volume)); } catch {}
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    try { localStorage.setItem('playerRate', String(playbackRate)); } catch {}
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  // Chat scroll
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

  // Fetch reading notes when switching to notes panel (non-lecture mode)
  useEffect(() => {
    if (rightPanel === 'notes' && !hasLecture) fetchReadingNotes();
  }, [rightPanel, hasLecture, fetchReadingNotes]);

  // ===== Keyboard shortcuts =====
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      switch (e.key) {
        case ' ':
          e.preventDefault();
          handlePlayPause();
          break;
        case 'ArrowLeft':
          if (hasPrev) setCurrentPage(p => p - 1);
          break;
        case 'ArrowRight':
          if (hasNext) {
            setCurrentPage(p => p + 1);
          } else if (hasLecture) {
            // 已到最后一页，触发读完总结
            handleShowCompletion();
          }
          break;
        case 'n':
        case 'N':
          setRightPanel('notes');
          setRightPanelVisible(true);
          break;
        case 't':
        case 'T':
          setShowTranslation(v => !v);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPrev, hasNext, hasLecture, isPlaying, slide]);

  // ===== Audio functions =====

  const startSentenceTracking = useCallback((audio) => {
    if (sentenceTimerRef.current) clearInterval(sentenceTimerRef.current);
    if (!sentences.length) return;
    sentenceTimerRef.current = setInterval(() => {
      if (!audio || audio.paused) return;
      const dur = audio.duration;
      const cur = audio.currentTime;
      if (!dur || !isFinite(dur)) return;
      const fraction = cur / dur;
      const totalChars = sentences.reduce((a, s) => a + s.length, 0);
      let charsSoFar = 0;
      for (let i = 0; i < sentences.length; i++) {
        charsSoFar += sentences[i].length;
        if (charsSoFar / totalChars >= fraction) {
          setCurrentSentenceIdx(i);
          break;
        }
      }
    }, 200);
  }, [sentences]);

  const stopAudio = () => {
    if (sentenceTimerRef.current) clearInterval(sentenceTimerRef.current);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsPlaying(false);
  };

  const setupAudioListeners = useCallback((audio) => {
    audio.addEventListener('timeupdate', () => setAudioProgress(audio.currentTime));
    audio.addEventListener('loadedmetadata', () => setAudioDuration(audio.duration));
    audio.addEventListener('durationchange', () => {
      if (audio.duration && isFinite(audio.duration)) setAudioDuration(audio.duration);
    });
    audio.addEventListener('ended', () => {
      setIsPlaying(false);
      setCurrentSentenceIdx(-1);
      if (sentenceTimerRef.current) clearInterval(sentenceTimerRef.current);
      // 标记当前页已听完
      markPageListened(currentPage);
      if (autoPlayNext && currentPage < slides.length - 1) {
        setCurrentPage(p => p + 1);
        setTimeout(() => handleAutoPlay(), 600);
      }
    });
    audio.addEventListener('error', () => {
      message.error('音频播放失败');
      setIsPlaying(false);
    });
  }, [autoPlayNext, currentPage, slides.length]);

  const handlePlayPause = async () => {
    if (!slide?.lecture_text) {
      message.warning('当前页面没有讲解文本');
      return;
    }
    if (isPlaying && audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }
    if (audioRef.current && audioRef.current.paused && audioRef.current.currentTime > 0) {
      audioRef.current.play();
      setIsPlaying(true);
      startSentenceTracking(audioRef.current);
      return;
    }
    setAudioLoading(true);
    try {
      const res = await ttsApi.synthesize({
        text: slide.lecture_text,
        voice: selectedVoice,
        doc_id: parseInt(id),
        page: currentPage,
      });
      const rawUrl = res.data?.audio_url || res.data?.url;
      if (!rawUrl) { message.error('语音合成失败'); setAudioLoading(false); return; }
      const audioUrl = ttsApi.resolveAudioUrl(rawUrl);
      const audio = new Audio(audioUrl);
      audio.volume = volume;
      audio.playbackRate = playbackRate;
      audioRef.current = audio;
      setupAudioListeners(audio);
      await audio.play();
      setIsPlaying(true);
      startSentenceTracking(audio);
    } catch {
      message.error('语音合成请求失败');
    } finally {
      setAudioLoading(false);
    }
  };

  const handleAutoPlay = async () => {
    const nextSlide = slides[currentPage + 1] || slides[currentPage];
    if (!nextSlide?.lecture_text) return;
    setAudioLoading(true);
    try {
      const res = await ttsApi.synthesize({
        text: nextSlide.lecture_text,
        voice: selectedVoice,
        doc_id: parseInt(id),
        page: currentPage,
      });
      const rawUrl = res.data?.audio_url || res.data?.url;
      if (!rawUrl) { setAudioLoading(false); return; }
      const audioUrl = ttsApi.resolveAudioUrl(rawUrl);
      const audio = new Audio(audioUrl);
      audio.volume = volume;
      audio.playbackRate = playbackRate;
      audioRef.current = audio;
      setupAudioListeners(audio);
      await audio.play();
      setIsPlaying(true);
      startSentenceTracking(audio);
    } catch { /* silent */ } finally {
      setAudioLoading(false);
    }
  };

  const handleSeek = (val) => {
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setAudioProgress(val);
    }
  };

  // ===== Note functions =====

  const handleNoteChange = (val) => {
    setNoteContent(val);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveLectureNote(val), 1000);
  };

  const saveLectureNote = async (content) => {
    setSavingNote(true);
    try {
      await lectureNoteApi.upsert(id, currentPage + 1, content);
      setLectureNotes(prev => ({ ...prev, [currentPage + 1]: content }));
    } catch { /* silent */ }
    setSavingNote(false);
  };

  const handleAddReadingNote = async () => {
    if (!newNoteContent.trim()) { message.warning('请输入笔记内容'); return; }
    setAddingNote(true);
    try {
      await docApi.createNote(id, {
        page_number: currentPage + 1,
        content: newNoteContent.trim(),
        highlight_text: newNoteHighlight.trim() || undefined,
      });
      message.success('笔记已添加');
      setNewNoteContent('');
      setNewNoteHighlight('');
      fetchReadingNotes();
    } catch {
      message.error('添加笔记失败');
    } finally {
      setAddingNote(false);
    }
  };

  const handleDeleteReadingNote = async (noteId) => {
    try {
      await docApi.deleteNote(noteId);
      message.success('笔记已删除');
      fetchReadingNotes();
    } catch {
      message.error('删除失败');
    }
  };

  // ===== Chat functions =====

  const handleSendChat = async () => {
    const question = chatInput.trim();
    if (!question) return;
    setChatMessages(prev => [...prev, { role: 'user', content: question }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const res = await docApi.chat(id, { question, session_id: sessionId });
      const data = res.data;
      if (data.session_id && !sessionId) setSessionId(data.session_id);
      setChatMessages(prev => [...prev, { role: 'assistant', content: data.answer }]);
    } catch {
      setChatMessages(prev => [...prev, { role: 'assistant', content: '抱歉，回答失败，请重试。' }]);
    } finally {
      setChatLoading(false);
    }
  };

  // ===== Publish functions =====

  const handlePublish = async () => {
    if (!publishTitle.trim()) { message.warning('请输入标题'); return; }
    setPublishing(true);
    try {
      await docApi.publish(id, { title: publishTitle, description: publishDesc, tags: publishTags });
      message.success('发布成功');
      setPublishModalOpen(false);
      fetchDoc();
    } catch { message.error('发布失败'); } finally { setPublishing(false); }
  };

  const handleUnpublish = async () => {
    try { await docApi.unpublish(id); message.success('已撤回'); fetchDoc(); }
    catch { message.error('撤回失败'); }
  };

  const openPublishModal = () => {
    setPublishTitle(doc?.title || '');
    setPublishDesc('');
    setPublishTags([]);
    setPublishModalOpen(true);
  };

  // ===== Lecture generation =====

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
        } catch { /* silent */ }
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

  // ===== Share functions =====

  const handleShare = async (type) => {
    if (!doc?.summary) {
      message.warning('文档尚未生成摘要，无法分享');
      return;
    }
    setShareType(type);
    setSharePost(null);
    setShareLoading(true);
    setShareModalOpen(true);
    try {
      const res = type === 'xhs'
        ? await docApi.shareXhs(id)
        : await docApi.shareMoments(id);
      const post = res.data;
      setSharePost(post);

      // 封面图异步生成，轮询等待（最多 60s）
      if (post && !post.cover_url && post.id) {
        const prefix = type === 'xhs' ? 'xhs' : 'moments';
        const coverPath = `${import.meta.env.BASE_URL.replace(/\/$/, '')}/covers/${prefix}_${post.id}.png`;
        let tries = 0;
        const poll = setInterval(async () => {
          tries++;
          try {
            const r = await fetch(coverPath, { method: 'HEAD' });
            if (r.ok) {
              setSharePost(prev => prev ? { ...prev, cover_url: `/covers/${prefix}_${post.id}.png`, image_status: 'ready' } : prev);
              clearInterval(poll);
            }
          } catch { /* ignore */ }
          if (tries >= 30) clearInterval(poll);
        }, 2000);
      }
    } catch (err) {
      message.error(err.message || '生成分享内容失败');
      setShareModalOpen(false);
    } finally {
      setShareLoading(false);
    }
  };

  const handleCopyShareContent = () => {
    if (!sharePost) return;
    const text = `${sharePost.title}\n\n${sharePost.content}`;
    navigator.clipboard.writeText(text).then(() => {
      message.success('已复制到剪贴板，粘贴到小红书/朋友圈即可发布');
    }).catch(() => {
      message.info('请手动复制上方内容');
    });
  };

  // ===== Completion card =====

  const handleShowCompletion = async () => {
    // 标记文档已完成学习（书架「学习完成」分类使用）
    try {
      const completed = new Set(JSON.parse(localStorage.getItem('completedDocs') || '[]'));
      completed.add(String(id));
      localStorage.setItem('completedDocs', JSON.stringify([...completed]));
    } catch { /* ignore */ }

    setCompletionModalOpen(true);
    setCompletionLoading(true);
    setCompletionData(null);
    setCompletionCoverUrl(null);
    try {
      const res = await docApi.completionCard(id);
      const data = res.data;
      setCompletionData(data);

      // covers 由 nginx 直接代理，路径前缀是 BASE（不含 /api）
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

      if (data?.cover_ready && data?.cover_url) {
        // 封面图已就绪，直接显示
        setCompletionCoverUrl(`${BASE}${data.cover_url}`);
      } else if (data?.expected_cover_url) {
        // 后台异步生成中，轮询（最多 60 秒，每 2 秒一次）
        const pollUrl = `${BASE}${data.expected_cover_url}`;
        let tries = 0;
        const poll = setInterval(async () => {
          tries++;
          try {
            const r = await fetch(pollUrl, { method: 'HEAD' });
            if (r.ok) {
              setCompletionCoverUrl(pollUrl + '?t=' + Date.now());
              clearInterval(poll);
            }
          } catch { /* ignore */ }
          if (tries >= 30) clearInterval(poll);  // 最多 60s
        }, 2000);
      }
    } catch (err) {
      message.error(err.message || '生成总结失败');
    } finally {
      setCompletionLoading(false);
    }
  };

  const handleCopyCompletionText = () => {
    if (!completionData) return;
    const text = `📚《${completionData.title}》读后感\n\n${completionData.completion_text}\n\n核心要点：\n${(completionData.key_points || []).map((p, i) => `${i + 1}. ${p}`).join('\n')}`;
    navigator.clipboard.writeText(text).then(() => {
      message.success('已复制，粘贴到小红书/朋友圈即可发布');
    }).catch(() => message.info('请手动复制内容'));
  };

  // ===== Translate =====

  const handleTranslate = async () => {
    setTranslating(true);
    try {
      const res = await analysisApi.translate({
        text: translatePopover.text,
        source_lang: 'auto',
        target_lang: targetLang,
      });
      setTranslatedText(res.data?.translated_text || res.data?.result || JSON.stringify(res.data));
    } catch { message.error('翻译失败'); } finally { setTranslating(false); }
  };

  const handleExportNotes = async () => {
    try {
      const res = await lectureNoteApi.export(id);
      const markdown = res.data?.content || res.data || '';
      const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${doc?.title || '备注'}_notes.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      message.success('导出成功');
    } catch { message.error('导出失败'); }
  };

  // ===== Render =====

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
        <Spin size="large" tip="加载文档中..." />
      </div>
    );
  }

  if (!doc) return <Empty description="文档不存在" />;

  const renderLectureContent = () => (
    <>
      <div style={{ marginBottom: 20 }}>
        <Tag color="blue" style={{ marginBottom: 8 }}>
          第 {slide.slide || currentPage + 1} 页
        </Tag>
        <Title level={3} style={{ margin: 0 }}>{slide.title}</Title>
      </div>

      {slide.points && slide.points.length > 0 && (
        <Card
          size="small"
          style={{
            marginBottom: 20, borderRadius: 10,
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

      <Card
        size="small"
        style={{ marginBottom: 20, borderRadius: 10 }}
        title={
          <Space>
            <BookOutlined style={{ color: '#1890ff' }} />
            <Text strong>AI 讲解</Text>
            {isPlaying && <Tag color="processing" style={{ marginLeft: 8 }}><SoundOutlined /> 播放中</Tag>}
          </Space>
        }
      >
        {sentences.length > 0 ? (
          <div style={{ fontSize: 15, lineHeight: 2, color: '#333' }}>
            {sentences.map((sentence, idx) => (
              <span
                key={idx}
                style={{
                  backgroundColor: idx === currentSentenceIdx ? '#bae7ff' : 'transparent',
                  borderRadius: idx === currentSentenceIdx ? 4 : 0,
                  padding: idx === currentSentenceIdx ? '2px 0' : 0,
                  transition: 'background-color 0.3s ease',
                }}
              >
                {sentence}
              </span>
            ))}
          </div>
        ) : (
          <Paragraph style={{ fontSize: 15, lineHeight: 2, whiteSpace: 'pre-wrap', color: '#333' }}>
            {slide.lecture_text || '暂无讲解内容'}
          </Paragraph>
        )}
      </Card>

      {showTranslation && slide.translation && (
        <Card
          size="small"
          style={{ marginBottom: 20, borderRadius: 10, background: '#fffbe6', border: '1px solid #ffe58f' }}
          title={<Space><TranslationOutlined style={{ color: '#faad14' }} /><Text strong>Translation</Text></Space>}
        >
          <Paragraph style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: '#666', fontStyle: 'italic' }}>
            {slide.translation}
          </Paragraph>
        </Card>
      )}

      {slide.page_text && (
        <Card
          size="small"
          style={{ borderRadius: 10, background: '#f9f9f9', marginBottom: 20 }}
          title={<Text type="secondary" style={{ fontSize: 12 }}>原文摘录</Text>}
        >
          <Text type="secondary" style={{ fontSize: 13, lineHeight: 1.6 }}>{slide.page_text}</Text>
        </Card>
      )}
    </>
  );

  const renderDocContent = () => (
    <>
      {isProcessing && (
        <div style={{ background: 'linear-gradient(135deg, #e8faf0, #e0f7fa)', padding: '16px 20px', borderRadius: 10, marginBottom: 16, textAlign: 'center' }}>
          <Spin size="small" style={{ marginRight: 8 }} />
          <Text strong>AI 正在分析文档...</Text>
          <Text type="secondary" style={{ marginLeft: 8 }}>进度: {Math.round(doc.progress || 0)}%</Text>
        </div>
      )}

      {doc.summary && (
        <Card title={<Space><ReadOutlined /><Text strong>AI 摘要</Text></Space>} size="small" style={{ borderRadius: 12, marginBottom: 16 }}>
          <Paragraph style={{ fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>{doc.summary}</Paragraph>
        </Card>
      )}

      {doc.key_points && doc.key_points.length > 0 && (
        <Card title={<Space><BulbOutlined /><Text strong>知识点</Text></Space>} size="small" style={{ borderRadius: 12, marginBottom: 16 }}>
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
        </Card>
      )}

      {hasPpt && (
        <Card title={<Space><FileTextOutlined /><Text strong>PPT 大纲</Text></Space>} size="small" style={{ borderRadius: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {doc.ppt_content.map((s, idx) => (
              <Card key={idx} size="small" type="inner" style={{ borderRadius: 8 }}
                title={<Space><Tag color="blue">第 {s.slide || idx + 1} 页</Tag><Text strong>{s.title}</Text></Space>}
              >
                <ul style={{ margin: 0, paddingLeft: 20 }}>
                  {(s.points || []).map((p, pi) => (
                    <li key={pi} style={{ marginBottom: 4, lineHeight: 1.6 }}><Text style={{ fontSize: 13 }}>{p}</Text></li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </Card>
      )}

      {!doc.summary && !hasPpt && !isProcessing && (
        <Empty description="暂无内容" style={{ marginTop: 80 }} />
      )}

      {hasPpt && !hasLecture && (
        <div style={{ textAlign: 'center', marginTop: 24 }}>
          <Button type="primary" size="large" icon={<SoundOutlined />} loading={generating} onClick={handleGenerateLecture}>
            {generating ? '讲解生成中...' : '一键生成 AI 讲解'}
          </Button>
        </div>
      )}
    </>
  );

  const renderRightPanel = () => {
    if (!rightPanelVisible) return null;

    return (
      <div style={{ width: 380, flexShrink: 0, borderLeft: '1px solid #f0f0f0', display: 'flex', flexDirection: 'column', background: '#fafafa', overflow: 'hidden' }}>
        {/* Panel tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #f0f0f0', background: '#fff', flexShrink: 0 }}>
          {RIGHT_PANEL_TABS.map(tab => (
            <div
              key={tab.key}
              onClick={() => setRightPanel(tab.key)}
              style={{
                flex: 1, padding: '10px 0', textAlign: 'center', cursor: 'pointer',
                borderBottom: rightPanel === tab.key ? '2px solid #1890ff' : '2px solid transparent',
                color: rightPanel === tab.key ? '#1890ff' : '#666',
                fontWeight: rightPanel === tab.key ? 600 : 400,
                fontSize: 13, transition: 'all 0.2s',
              }}
            >
              <Space size={4}>{tab.icon}{tab.label}</Space>
            </div>
          ))}
        </div>

        {/* Panel content */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {rightPanel === 'pdf' && (
            <PdfViewer url={pdfUrl} currentPage={currentPage} height="calc(100vh - 200px)" filename={doc?.filename || 'document.pdf'} />
          )}

          {rightPanel === 'chat' && (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>
                {chatMessages.length === 0 && (
                  <div style={{ textAlign: 'center', marginTop: 60, color: '#999' }}>
                    <MessageOutlined style={{ fontSize: 36, color: '#d9d9d9', marginBottom: 12 }} />
                    <div style={{ fontSize: 13 }}>针对文档内容提问</div>
                    <div style={{ fontSize: 12, color: '#bbb', marginTop: 4 }}>AI 将基于文档内容为你解答</div>
                  </div>
                )}
                {chatMessages.map((msg, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
                    <div style={{ display: 'flex', gap: 8, maxWidth: '88%', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                      <div style={{
                        width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: msg.role === 'user' ? '#1890ff' : '#f0f0f0',
                        color: msg.role === 'user' ? '#fff' : '#666', fontSize: 13, fontWeight: 600,
                      }}>
                        {msg.role === 'user' ? '我' : 'AI'}
                      </div>
                      <div style={{
                        padding: '8px 12px', borderRadius: 10, fontSize: 13, lineHeight: 1.7,
                        background: msg.role === 'user' ? '#1890ff' : '#f5f5f5',
                        color: msg.role === 'user' ? '#fff' : '#333', wordBreak: 'break-word',
                      }}>
                        {msg.content}
                      </div>
                    </div>
                  </div>
                ))}
                {chatLoading && (
                  <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                    <div style={{ width: 30, height: 30, borderRadius: '50%', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f0f0f0', color: '#666', fontSize: 13, fontWeight: 600 }}>AI</div>
                    <div style={{ padding: '8px 12px', borderRadius: 10, background: '#f5f5f5' }}>
                      <Spin size="small" />
                      <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>思考中...</Text>
                    </div>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>
              <div style={{ padding: '10px 14px', borderTop: '1px solid #f0f0f0', flexShrink: 0, background: '#fff' }}>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Input
                    placeholder="输入问题..."
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onPressEnter={e => { if (!e.shiftKey) { e.preventDefault(); handleSendChat(); } }}
                    disabled={chatLoading}
                    style={{ borderRadius: 8 }}
                  />
                  <Button type="primary" icon={<SendOutlined />} onClick={handleSendChat} loading={chatLoading} disabled={!chatInput.trim()} style={{ borderRadius: 8 }} />
                </div>
              </div>
            </div>
          )}

          {rightPanel === 'notes' && (
            <div style={{ padding: 16, height: '100%', display: 'flex', flexDirection: 'column' }}>
              {hasLecture ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <Text strong><EditOutlined /> 第 {currentPage + 1} 页备注</Text>
                    {savingNote ? (
                      <Text type="secondary" style={{ fontSize: 12 }}>保存中...</Text>
                    ) : (
                      <Text type="success" style={{ fontSize: 12 }}><SaveOutlined /> 自动保存</Text>
                    )}
                  </div>
                  <TextArea
                    value={noteContent}
                    onChange={e => handleNoteChange(e.target.value)}
                    placeholder="在这里记录你对本页的学习笔记、心得体会..."
                    style={{ flex: 1, resize: 'none', border: '1px solid #d9d9d9', background: '#fff', borderRadius: 8, fontSize: 14, lineHeight: 1.8 }}
                    autoSize={false}
                  />
                  <div style={{ marginTop: 12 }}>
                    <Button size="small" icon={<DownloadOutlined />} onClick={handleExportNotes}>导出全部备注</Button>
                  </div>
                </>
              ) : (
                <>
                  <Card size="small" style={{ borderRadius: 12, marginBottom: 16 }} title="添加笔记">
                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                      <TextArea placeholder="输入高亮文本（可选）" value={newNoteHighlight} onChange={e => setNewNoteHighlight(e.target.value)} rows={1} style={{ fontSize: 13 }} />
                      <TextArea placeholder="输入笔记内容..." value={newNoteContent} onChange={e => setNewNoteContent(e.target.value)} rows={3} style={{ fontSize: 13 }} />
                      <Button type="primary" icon={<PlusOutlined />} loading={addingNote} onClick={handleAddReadingNote} size="small">添加笔记</Button>
                    </Space>
                  </Card>
                  <Card title={`我的笔记 (${readingNotes.length})`} size="small" style={{ borderRadius: 12 }}>
                    {readingNotesLoading ? <Spin style={{ display: 'block', padding: 24 }} /> : readingNotes.length > 0 ? (
                      <List
                        dataSource={readingNotes}
                        renderItem={note => (
                          <List.Item actions={[<Button key="del" type="text" danger size="small" icon={<DeleteOutlined />} onClick={() => handleDeleteReadingNote(note.id)} />]}>
                            <List.Item.Meta
                              title={<Space>{note.page_number && <Tag color="blue">P{note.page_number}</Tag>}<Text style={{ fontSize: 13 }}>{note.content}</Text></Space>}
                              description={note.highlight_text && <Text type="secondary" style={{ fontSize: 12, background: '#fffbe6', padding: '2px 6px', borderRadius: 3 }}>"{note.highlight_text}"</Text>}
                            />
                          </List.Item>
                        )}
                      />
                    ) : <Empty description="暂无笔记" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
                  </Card>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ height: 'calc(100vh - 64px)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Top control bar */}
      <div style={{
        padding: '8px 20px', background: '#fff', borderBottom: '1px solid #f0f0f0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        flexShrink: 0, gap: 12, flexWrap: 'wrap',
      }}>
        <Space size={8} style={{ flexShrink: 0 }}>
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate('/')}>返回</Button>
          <Text strong style={{ fontSize: 15, maxWidth: 200 }} ellipsis={{ tooltip: doc.title }}>{doc.title}</Text>
          <Tag color={doc.status === 'ready' ? 'green' : doc.status === 'processing' ? 'blue' : 'default'}>
            {doc.status === 'ready' ? '已就绪' : doc.status === 'processing' ? '处理中' : doc.status}
          </Tag>
          {isPublished && <Tag color="green"><GlobalOutlined /> 公开</Tag>}
        </Space>

        {hasLecture && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <Select size="small" style={{ width: 96 }} value={selectedVoice} onChange={setSelectedVoice} placeholder="语音"
              options={voices.map(v => ({ label: v.label || v.name || v.id || v, value: v.id || v.name || v }))}
            />

            {/* 播放控制区：上一页 + 播放 + 下一页 */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f5f5f5', borderRadius: 24, padding: '4px 8px' }}>
              {/* ⏮ 上一页 */}
              <Tooltip title="上一页（← 键）">
                <button
                  disabled={!hasPrev}
                  onClick={() => setCurrentPage(p => p - 1)}
                  style={{
                    width: 32, height: 32, borderRadius: '50%', border: 'none',
                    background: hasPrev ? '#fff' : 'transparent',
                    boxShadow: hasPrev ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
                    cursor: hasPrev ? 'pointer' : 'not-allowed',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: hasPrev ? '#333' : '#bbb', fontSize: 13, flexShrink: 0,
                    transition: 'all 0.2s',
                  }}
                >
                  <LeftOutlined />
                </button>
              </Tooltip>

              {/* ▶ 播放主按钮 */}
              <button
                disabled={audioLoading}
                onClick={handlePlayPause}
                style={{
                  height: 40, paddingInline: 20, borderRadius: 20, border: 'none',
                  display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
                  cursor: audioLoading ? 'wait' : 'pointer',
                  background: isPlaying
                    ? 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)'
                    : 'linear-gradient(135deg, #2dce89 0%, #1a7a52 100%)',
                  color: '#fff', fontSize: 14, fontWeight: 700,
                  boxShadow: isPlaying
                    ? '0 3px 12px rgba(245,87,108,0.45)'
                    : '0 3px 12px rgba(45,206,137,0.45)',
                  transition: 'all 0.25s',
                }}
              >
                {audioLoading
                  ? <Spin size="small" style={{ color: '#fff' }} />
                  : isPlaying
                    ? <><PauseCircleOutlined style={{ fontSize: 18 }} /> 暂停</>
                    : <><PlayCircleOutlined style={{ fontSize: 18 }} /> 播放</>
                }
              </button>

              {/* ⏭ 下一页 */}
              <Tooltip title={hasNext ? '下一页（→ 键）' : '读完了！'}>
                <button
                  onClick={() => { if (hasNext) setCurrentPage(p => p + 1); else handleShowCompletion(); }}
                  style={{
                    width: 32, height: 32, borderRadius: '50%', border: 'none',
                    background: '#fff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
                    cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: hasNext ? '#333' : '#faad14', fontSize: 13, flexShrink: 0,
                    transition: 'all 0.2s',
                  }}
                >
                  {hasNext ? <RightOutlined /> : <TrophyOutlined />}
                </button>
              </Tooltip>
            </div>

            <Select size="small" style={{ width: 64 }} value={playbackRate} onChange={setPlaybackRate} options={RATE_OPTIONS} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <SoundOutlined style={{ fontSize: 13, color: '#999' }} />
              <Slider min={0} max={1} step={0.05} value={volume} onChange={setVolume}
                tooltip={{ formatter: v => `${Math.round(v * 100)}%` }} style={{ width: 56, margin: 0 }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>自动</Text>
              <Switch size="small" checked={autoPlayNext} onChange={setAutoPlayNext} />
            </div>
          </div>
        )}

        <Space size={8}>
          {hasLecture && (
            <>
              <Tooltip title={showTranslation ? '隐藏译文' : '显示译文'}>
                <Button size="small" type={showTranslation ? 'primary' : 'default'} icon={<TranslationOutlined />} onClick={() => setShowTranslation(!showTranslation)} />
              </Tooltip>
              {isPublished ? (
                <Button size="small" icon={<StopOutlined />} danger onClick={handleUnpublish}>撤回</Button>
              ) : (
                <Button size="small" icon={<SendOutlined />} type="primary" ghost onClick={openPublishModal}>发布</Button>
              )}
            </>
          )}
          {doc?.status === 'ready' && (
            <Dropdown
              menu={{
                items: [
                  {
                    key: 'xhs',
                    icon: <HeartOutlined style={{ color: '#ff2442' }} />,
                    label: '分享到小红书',
                  },
                  {
                    key: 'moments',
                    icon: <WechatOutlined style={{ color: '#07c160' }} />,
                    label: '分享到朋友圈',
                  },
                ],
                onClick: ({ key }) => handleShare(key),
              }}
              trigger={['click']}
            >
              <Button size="small" icon={<ShareAltOutlined />}>分享图文</Button>
            </Dropdown>
          )}
          {!hasLecture && hasPpt && (
            <Button size="small" type="primary" icon={<SoundOutlined />} loading={generating} onClick={handleGenerateLecture}>
              {generating ? '生成中...' : '生成讲解'}
            </Button>
          )}
          <Tooltip title={rightPanelVisible ? '收起面板' : '展开面板'}>
            <Button size="small" icon={<MenuFoldOutlined />} onClick={() => setRightPanelVisible(v => !v)} />
          </Tooltip>
          {hasLecture && <Text type="secondary">{currentPage + 1} / {totalPages}</Text>}
        </Space>
      </div>

      {/* Audio progress bar */}
      {hasLecture && (isPlaying || audioProgress > 0 || audioDuration > 0) && (
        <div style={{ padding: '4px 20px', background: '#fafafa', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <Text type="secondary" style={{ fontSize: 11, minWidth: 36 }}>{formatTime(audioProgress)}</Text>
          <Slider min={0} max={audioDuration || 1} step={0.1} value={audioProgress} onChange={handleSeek}
            tooltip={{ formatter: v => formatTime(v) }} style={{ flex: 1, margin: 0 }}
          />
          <Text type="secondary" style={{ fontSize: 11, minWidth: 36 }}>{formatTime(audioDuration)}</Text>
        </div>
      )}

      {/* Main body */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left nav — slide thumbnails (lecture mode) or doc meta (doc mode) */}
        {hasLecture ? (
          <div ref={thumbnailListRef} style={{ width: 160, flexShrink: 0, borderRight: '1px solid #f0f0f0', overflowY: 'auto', background: '#fafafa', padding: '8px 0' }}>
            {slides.map((s, idx) => {
              const isListened = listenedPages.has(idx);
              const isCurrent = idx === currentPage;
              return (
                <div
                  key={idx}
                  data-page-idx={idx}
                  onClick={() => setCurrentPage(idx)}
                  style={{
                    padding: '10px 12px', cursor: 'pointer',
                    background: isCurrent ? '#e6fffb' : isListened ? '#f6ffed' : 'transparent',
                    borderLeft: isCurrent ? '3px solid #2dce89' : '3px solid transparent',
                    transition: 'all 0.2s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Badge
                      count={idx + 1}
                      style={{
                        backgroundColor: isCurrent ? '#2dce89' : isListened ? '#52c41a' : '#d9d9d9',
                        fontSize: 11, minWidth: 22, height: 22, lineHeight: '22px',
                      }}
                    />
                    <Text
                      ellipsis
                      style={{
                        fontSize: 12,
                        fontWeight: isCurrent ? 600 : 400,
                        color: isCurrent ? '#2dce89' : isListened ? '#389e0d' : '#666',
                        flex: 1,
                      }}
                    >
                      {s.title || `第 ${idx + 1} 页`}
                    </Text>
                    {isListened && (
                      <CheckCircleOutlined style={{ fontSize: 12, color: '#52c41a', flexShrink: 0 }} />
                    )}
                  </div>
                  {lectureNotes[idx + 1] && (
                    <EditOutlined style={{ fontSize: 10, color: '#faad14', marginLeft: 30, marginTop: 2 }} />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ width: 200, flexShrink: 0, borderRight: '1px solid #f0f0f0', overflowY: 'auto', background: '#fafafa', padding: 16 }}>
            <Text strong style={{ fontSize: 13, marginBottom: 16, display: 'block' }}>文档信息</Text>
            <Space direction="vertical" size={8}>
              <Text type="secondary" style={{ fontSize: 12 }}><BookOutlined /> {doc.filename}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>格式: {doc.file_type?.toUpperCase()}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>页数: {doc.page_count || '-'}</Text>
              <Text type="secondary" style={{ fontSize: 12 }}>字数: {doc.word_count ? `${(doc.word_count / 1000).toFixed(1)}K` : '-'}</Text>
              {doc.author && <Text type="secondary" style={{ fontSize: 12 }}>作者: {doc.author}</Text>}
            </Space>
          </div>
        )}

        {/* Center content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '24px 32px', background: '#fff' }}>
          {hasLecture ? renderLectureContent() : renderDocContent()}

          {hasLecture && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 32, paddingBottom: 24 }}>
              <Button
                size="large"
                disabled={!hasPrev}
                icon={<LeftOutlined />}
                onClick={() => setCurrentPage(p => p - 1)}
                style={{ minWidth: 100 }}
              >
                上一页
              </Button>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  {currentPage + 1} / {totalPages}
                </Text>
                <Text type="secondary" style={{ fontSize: 11, color: '#bbb' }}>← → 键盘切换</Text>
              </div>
              {hasNext ? (
                <Button
                  size="large"
                  type="primary"
                  onClick={() => setCurrentPage(p => p + 1)}
                  style={{ minWidth: 100 }}
                >
                  下一页 <RightOutlined />
                </Button>
              ) : (
                <Button
                  size="large"
                  type="primary"
                  icon={<TrophyOutlined />}
                  onClick={handleShowCompletion}
                  style={{
                    minWidth: 120,
                    background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
                    border: 'none',
                    boxShadow: '0 4px 12px rgba(240,93,250,0.4)',
                  }}
                >
                  读完了！
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Right panel */}
        {renderRightPanel()}
      </div>

      {/* Publish modal */}
      <Modal title="发布到社区" open={publishModalOpen} onCancel={() => setPublishModalOpen(false)} footer={null} destroyOnClose width={520}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>标题</Text>
            <Input value={publishTitle} onChange={e => setPublishTitle(e.target.value)} placeholder="请输入标题" maxLength={100} showCount />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>描述</Text>
            <TextArea value={publishDesc} onChange={e => setPublishDesc(e.target.value)} placeholder="简要描述你的讲解内容..." rows={4} maxLength={500} showCount />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>标签</Text>
            <Select mode="multiple" value={publishTags} onChange={setPublishTags} placeholder="选择标签" style={{ width: '100%' }} options={TAG_OPTIONS} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button onClick={() => setPublishModalOpen(false)}>取消</Button>
            <Button type="primary" icon={<SendOutlined />} loading={publishing} onClick={handlePublish}>确认发布</Button>
          </div>
        </div>
      </Modal>

      {/* Completion card modal */}
      <Modal
        open={completionModalOpen}
        onCancel={() => setCompletionModalOpen(false)}
        footer={null}
        width={520}
        destroyOnClose
        centered
        styles={{ body: { padding: 0 } }}
      >
        {completionLoading ? (
          <div style={{ textAlign: 'center', padding: '60px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: '#999', fontSize: 14 }}>AI 正在为你生成读书卡片...</div>
          </div>
        ) : completionData ? (
          <div>
            {/* 封面图区域 */}
            <div style={{
              position: 'relative', height: 220, overflow: 'hidden',
              background: completionCoverUrl ? undefined : 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
              borderRadius: '8px 8px 0 0',
            }}>
              {completionCoverUrl ? (
                <img src={completionCoverUrl} alt="读书卡片" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
                  <TrophyOutlined style={{ fontSize: 60, color: 'rgba(255,255,255,0.9)' }} />
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: 600, marginTop: 12 }}>阅读完成！</Text>
                  {!completionData.cover_ready && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                      <Spin size="small" />
                      <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>封面图生成中...</Text>
                    </div>
                  )}
                </div>
              )}
              {/* 徽章 */}
              <div style={{
                position: 'absolute', top: 16, right: 16,
                background: 'rgba(255,215,0,0.95)', borderRadius: 20,
                padding: '4px 12px', display: 'flex', alignItems: 'center', gap: 4,
              }}>
                <CheckCircleOutlined style={{ color: '#8B6914' }} />
                <Text style={{ color: '#8B6914', fontWeight: 700, fontSize: 13 }}>已读完</Text>
              </div>
            </div>

            {/* 内容区 */}
            <div style={{ padding: '20px 24px 24px' }}>
              <Title level={4} style={{ marginBottom: 12 }}>《{completionData.title}》</Title>

              {/* 读后感 */}
              <div style={{
                background: 'linear-gradient(135deg, #f6ffed 0%, #e6f7ff 100%)',
                borderRadius: 10, padding: '14px 16px', marginBottom: 16,
                borderLeft: '3px solid #2dce89',
              }}>
                <Text style={{ fontSize: 14, lineHeight: 1.8, color: '#333' }}>
                  {completionData.completion_text}
                </Text>
              </div>

              {/* 核心要点 */}
              {completionData.key_points?.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <Text strong style={{ fontSize: 13, color: '#666', display: 'block', marginBottom: 8 }}>
                    <BulbOutlined style={{ marginRight: 4, color: '#faad14' }} /> 核心要点
                  </Text>
                  {completionData.key_points.map((p, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
                      <Text style={{ color: '#2dce89', fontWeight: 700, flexShrink: 0 }}>{i + 1}.</Text>
                      <Text style={{ fontSize: 13, color: '#555', lineHeight: 1.6 }}>{typeof p === 'string' ? p : JSON.stringify(p)}</Text>
                    </div>
                  ))}
                </div>
              )}

              {/* 分享按钮组 */}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <Button
                  type="primary"
                  icon={<CopyOutlined />}
                  onClick={handleCopyCompletionText}
                  style={{ flex: 1 }}
                >
                  复制读后感
                </Button>
                <Button
                  icon={<HeartOutlined style={{ color: '#ff2442' }} />}
                  onClick={() => { setCompletionModalOpen(false); handleShare('xhs'); }}
                  style={{ flex: 1, borderColor: '#ff2442', color: '#ff2442' }}
                >
                  分享小红书
                </Button>
                <Button
                  icon={<WechatOutlined style={{ color: '#07c160' }} />}
                  onClick={() => { setCompletionModalOpen(false); handleShare('moments'); }}
                  style={{ flex: 1, borderColor: '#07c160', color: '#07c160' }}
                >
                  朋友圈
                </Button>
              </div>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Share modal */}
      <Modal
        title={
          <Space>
            {shareType === 'xhs'
              ? <HeartOutlined style={{ color: '#ff2442' }} />
              : <WechatOutlined style={{ color: '#07c160' }} />}
            {shareType === 'xhs' ? '小红书图文分享' : '微信朋友圈图文分享'}
          </Space>
        }
        open={shareModalOpen}
        onCancel={() => setShareModalOpen(false)}
        footer={
          sharePost ? (
            <Space>
              <Button onClick={() => setShareModalOpen(false)}>关闭</Button>
              <Button type="primary" icon={<CopyOutlined />} onClick={handleCopyShareContent}>
                复制内容
              </Button>
            </Space>
          ) : null
        }
        width={560}
        destroyOnClose
      >
        {shareLoading ? (
          <div style={{ textAlign: 'center', padding: '48px 0' }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: '#999' }}>AI 正在生成图文内容，请稍候...</div>
          </div>
        ) : sharePost ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {sharePost.cover_url && (
              <div style={{ textAlign: 'center' }}>
                <img
                  src={sharePost.cover_url.startsWith('http') ? sharePost.cover_url : `${import.meta.env.BASE_URL.replace(/\/$/, '')}${sharePost.cover_url}`}
                  alt="封面图"
                  style={{ maxWidth: '100%', maxHeight: 240, borderRadius: 10, objectFit: 'cover' }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
            )}
            {!sharePost.cover_url && sharePost.image_status !== 'ready' && (
              <div style={{ textAlign: 'center', padding: '24px 0', background: '#f9f9f9', borderRadius: 10 }}>
                <Spin size="small" />
                <div style={{ marginTop: 8, color: '#999', fontSize: 12 }}>封面图生成中...</div>
              </div>
            )}
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>标题</Text>
              <div style={{
                padding: '10px 14px', background: '#f6f8ff', borderRadius: 8,
                fontWeight: 600, fontSize: 15, color: '#222',
              }}>
                {sharePost.title}
              </div>
            </div>
            <div>
              <Text type="secondary" style={{ fontSize: 12, marginBottom: 4, display: 'block' }}>正文内容</Text>
              <div style={{
                padding: '12px 14px', background: '#fafafa', borderRadius: 8,
                fontSize: 14, lineHeight: 1.8, color: '#333',
                whiteSpace: 'pre-wrap', maxHeight: 300, overflowY: 'auto',
                border: '1px solid #f0f0f0',
              }}>
                {sharePost.content}
              </div>
            </div>
            <div style={{
              padding: '10px 14px', background: '#fffbe6', borderRadius: 8,
              fontSize: 12, color: '#8c7535', border: '1px solid #ffe58f',
            }}>
              💡 点击「复制内容」后，打开{shareType === 'xhs' ? '小红书 App' : '微信朋友圈'}粘贴发布即可
            </div>
          </div>
        ) : null}
      </Modal>

      {/* Floating translate popover */}
      {translatePopover.visible && (
        <div style={{
          position: 'fixed', left: Math.min(translatePopover.x, window.innerWidth - 400),
          top: translatePopover.y + 10, zIndex: 1050, background: '#fff', borderRadius: 10,
          boxShadow: '0 6px 24px rgba(0,0,0,0.15)', padding: '12px 16px', maxWidth: 380, minWidth: 260,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <Space>
              <TranslationOutlined style={{ color: '#1890ff' }} />
              <Text strong style={{ fontSize: 13 }}>划词翻译</Text>
            </Space>
            <Button type="text" size="small" icon={<CloseOutlined />} onClick={() => setTranslatePopover(p => ({ ...p, visible: false }))} />
          </div>
          <div style={{ maxWidth: 360 }}>
            <div style={{ marginBottom: 8 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>选中文本：</Text>
              <Paragraph ellipsis={{ rows: 3 }} style={{ margin: '4px 0', fontSize: 13, background: '#fffbe6', padding: '4px 8px', borderRadius: 4 }}>
                {translatePopover.text}
              </Paragraph>
            </div>
            <Space style={{ marginBottom: 8 }}>
              <Text style={{ fontSize: 12 }}>目标语言：</Text>
              <Select size="small" value={targetLang} onChange={setTargetLang} style={{ width: 100 }}
                options={[
                  { value: 'zh', label: '中文' }, { value: 'en', label: 'English' },
                  { value: 'ja', label: '日本語' }, { value: 'ko', label: '한국어' },
                  { value: 'fr', label: 'Français' }, { value: 'de', label: 'Deutsch' },
                ]}
              />
              <Button size="small" type="primary" icon={<TranslationOutlined />} loading={translating} onClick={handleTranslate}>翻译</Button>
            </Space>
            {translatedText && (
              <div style={{ background: '#f0f5ff', padding: '8px 12px', borderRadius: 6, fontSize: 13, lineHeight: 1.6 }}>
                {translatedText}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
