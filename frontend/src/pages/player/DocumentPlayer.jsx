import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Spin, Empty, Button, Space, Typography, Tag, Card, Input, Divider,
  message, Tooltip, Badge, Select, Switch, Modal, Slider,
} from 'antd';
import {
  ArrowLeftOutlined, LeftOutlined, RightOutlined,
  EditOutlined, BulbOutlined,
  BookOutlined, TranslationOutlined, SaveOutlined,
  GlobalOutlined, LockOutlined,
  SoundOutlined, PauseCircleOutlined, PlayCircleOutlined,
  FilePdfOutlined, ShareAltOutlined, DownloadOutlined,
  StopOutlined, SendOutlined,
} from '@ant-design/icons';
import { docApi, lectureNoteApi, ttsApi, historyApi, settingsApi } from '../../api/documents';

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

export default function DocumentPlayer() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [doc, setDoc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentPage, setCurrentPage] = useState(0);
  const [showNotes, setShowNotes] = useState(() => {
    try { return localStorage.getItem('notesPanelOpen') === 'true'; } catch { return false; }
  });
  const [showTranslation, setShowTranslation] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [noteContent, setNoteContent] = useState('');
  const [notes, setNotes] = useState({});
  const [savingNote, setSavingNote] = useState(false);

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

  const [publishModalOpen, setPublishModalOpen] = useState(false);
  const [publishTitle, setPublishTitle] = useState('');
  const [publishDesc, setPublishDesc] = useState('');
  const [publishTags, setPublishTags] = useState([]);
  const [publishing, setPublishing] = useState(false);

  const saveTimerRef = useRef(null);
  const audioRef = useRef(null);
  const startTimeRef = useRef(null);
  const thumbnailListRef = useRef(null);
  const sentenceTimerRef = useRef(null);
  const isMountedRef = useRef(true);
  const audioListenersRef = useRef([]);
  const autoPlayTimeoutRef = useRef(null);

  const slides = useMemo(() => doc?.lecture_slides || [], [doc]);
  const slide = slides[currentPage] || {};
  const sentences = useMemo(() => splitSentences(slide.lecture_text), [slide.lecture_text]);

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

  const fetchVoices = useCallback(async () => {
    try {
      const res = await ttsApi.voices();
      const list = res.data || [];
      setVoices(list);
      if (list.length > 0 && !selectedVoice) {
        setSelectedVoice(list[0].id || list[0].name || list[0]);
      }
    } catch { /* ignore */ }
  }, [selectedVoice]);

  useEffect(() => {
    fetchDoc();
    fetchNotes();
    fetchVoices();
  }, [fetchDoc, fetchNotes, fetchVoices]);

  useEffect(() => {
    startTimeRef.current = Date.now();
    historyApi.record({
      document_id: id,
      action: 'play',
      last_page: currentPage,
      duration_seconds: 0,
    }).catch(() => {});
  }, [id]);

  useEffect(() => {
    setNoteContent(notes[currentPage + 1] || '');
  }, [currentPage, notes]);

  useEffect(() => {
    try { localStorage.setItem('notesPanelOpen', String(showNotes)); } catch {}
  }, [showNotes]);

  useEffect(() => {
    try { localStorage.setItem('playerVolume', String(volume)); } catch {}
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    try { localStorage.setItem('playerRate', String(playbackRate)); } catch {}
    if (audioRef.current) audioRef.current.playbackRate = playbackRate;
  }, [playbackRate]);

  useEffect(() => {
    stopAudio();
    setCurrentSentenceIdx(-1);
    setAudioProgress(0);
    setAudioDuration(0);
  }, [currentPage]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (audioRef.current) {
        audioListenersRef.current.forEach(([event, handler]) => {
          audioRef.current?.removeEventListener(event, handler);
        });
        audioRef.current.pause();
        audioRef.current = null;
      }
      audioListenersRef.current = [];
      if (sentenceTimerRef.current) clearInterval(sentenceTimerRef.current);
      if (autoPlayTimeoutRef.current) clearTimeout(autoPlayTimeoutRef.current);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (thumbnailListRef.current) {
      const activeEl = thumbnailListRef.current.querySelector(`[data-page-idx="${currentPage}"]`);
      if (activeEl) {
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }, [currentPage]);

  const startSentenceTracking = useCallback((audio) => {
    if (sentenceTimerRef.current) clearInterval(sentenceTimerRef.current);
    if (!sentences.length) return;

    sentenceTimerRef.current = setInterval(() => {
      if (!isMountedRef.current || !audio || audio.paused) return;
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

  const stopAudio = () => {
    if (sentenceTimerRef.current) clearInterval(sentenceTimerRef.current);
    if (autoPlayTimeoutRef.current) clearTimeout(autoPlayTimeoutRef.current);
    if (audioRef.current) {
      audioListenersRef.current.forEach(([event, handler]) => {
        audioRef.current?.removeEventListener(event, handler);
      });
      audioListenersRef.current = [];
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    setIsPlaying(false);
  };

  const setupAudioListeners = useCallback((audio) => {
    audioListenersRef.current.forEach(([event, handler]) => {
      audio.removeEventListener(event, handler);
    });
    audioListenersRef.current = [];

    const addListener = (event, handler) => {
      audio.addEventListener(event, handler);
      audioListenersRef.current.push([event, handler]);
    };

    addListener('timeupdate', () => {
      if (!isMountedRef.current) return;
      setAudioProgress(audio.currentTime);
    });
    addListener('loadedmetadata', () => {
      if (!isMountedRef.current) return;
      setAudioDuration(audio.duration);
    });
    addListener('durationchange', () => {
      if (!isMountedRef.current) return;
      if (audio.duration && isFinite(audio.duration)) setAudioDuration(audio.duration);
    });
    addListener('ended', () => {
      if (!isMountedRef.current) return;
      setIsPlaying(false);
      setCurrentSentenceIdx(-1);
      if (sentenceTimerRef.current) clearInterval(sentenceTimerRef.current);
      if (autoPlayNext && currentPage < slides.length - 1) {
        setCurrentPage((p) => p + 1);
        if (autoPlayTimeoutRef.current) clearTimeout(autoPlayTimeoutRef.current);
        autoPlayTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) handleAutoPlay();
        }, 600);
      }
    });
    addListener('error', () => {
      if (!isMountedRef.current) return;
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
        doc_id: id,
        page: currentPage,
      });
      const rawUrl = res.data?.audio_url || res.data?.url;
      if (!rawUrl) {
        message.error('语音合成失败');
        setAudioLoading(false);
        return;
      }
      const audioUrl = ttsApi.resolveAudioUrl(rawUrl);
      const audio = new Audio(audioUrl);
      audio.volume = volume;
      audio.playbackRate = playbackRate;
      audioRef.current = audio;
      setupAudioListeners(audio);

      await audio.play();
      setIsPlaying(true);
      startSentenceTracking(audio);
    } catch (err) {
      message.error('语音合成请求失败');
    } finally {
      setAudioLoading(false);
    }
  };

  const handleAutoPlay = async () => {
    if (!isMountedRef.current) return;
    const nextSlide = slides[currentPage + 1] || slides[currentPage];
    if (!nextSlide?.lecture_text) return;

    setAudioLoading(true);
    try {
      const res = await ttsApi.synthesize({
        text: nextSlide.lecture_text,
        voice: selectedVoice,
        doc_id: id,
        page: currentPage,
      });
      if (!isMountedRef.current) return;
      const rawUrl = res.data?.audio_url || res.data?.url;
      if (!rawUrl) { setAudioLoading(false); return; }
      const audioUrl = ttsApi.resolveAudioUrl(rawUrl);
      const audio = new Audio(audioUrl);
      audio.volume = volume;
      audio.playbackRate = playbackRate;
      audioRef.current = audio;
      setupAudioListeners(audio);

      await audio.play();
      if (!isMountedRef.current) { audio.pause(); return; }
      setIsPlaying(true);
      startSentenceTracking(audio);
    } catch { /* ignore */ } finally {
      if (isMountedRef.current) setAudioLoading(false);
    }
  };

  const handleSeek = (val) => {
    if (audioRef.current) {
      audioRef.current.currentTime = val;
      setAudioProgress(val);
    }
  };

  const handlePublish = async () => {
    if (!publishTitle.trim()) {
      message.warning('请输入标题');
      return;
    }
    setPublishing(true);
    try {
      await docApi.publish(id, {
        title: publishTitle,
        description: publishDesc,
        tags: publishTags,
      });
      message.success('发布成功');
      setPublishModalOpen(false);
      fetchDoc();
    } catch (err) {
      message.error('发布失败');
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async () => {
    try {
      await docApi.unpublish(id);
      message.success('已撤回');
      fetchDoc();
    } catch {
      message.error('撤回失败');
    }
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
    } catch {
      message.error('导出失败');
    }
  };

  const openPublishModal = () => {
    setPublishTitle(doc?.title || '');
    setPublishDesc('');
    setPublishTags([]);
    setPublishModalOpen(true);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>
        <Spin size="large" tip="加载讲解中..." />
      </div>
    );
  }

  if (!doc) return <Empty description="文档不存在" />;

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

  const totalPages = slides.length;
  const hasPrev = currentPage > 0;
  const hasNext = currentPage < totalPages - 1;
  const isPublished = doc.lecture_visibility === 'public' || doc.is_published;
  const pdfUrl = docApi.getPdf(id);
  const showRightPanel = showPdf || showNotes;

  const tagOptions = [
    { label: '技术', value: '技术' },
    { label: '学术', value: '学术' },
    { label: '商业', value: '商业' },
    { label: '人文', value: '人文' },
    { label: '其他', value: '其他' },
  ];

  const rateOptions = [
    { value: 0.5, label: '0.5x' },
    { value: 0.75, label: '0.75x' },
    { value: 1, label: '1x' },
    { value: 1.25, label: '1.25x' },
    { value: 1.5, label: '1.5x' },
    { value: 2, label: '2x' },
  ];

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
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <Space size={8} style={{ flexShrink: 0 }}>
          <Button size="small" icon={<ArrowLeftOutlined />} onClick={() => navigate(`/reader/${id}`)}>
            返回
          </Button>
          <Text strong style={{ fontSize: 15, maxWidth: 200 }} ellipsis={{ tooltip: doc.title }}>
            {doc.title}
          </Text>
          <Tag color={isPublished ? 'green' : 'default'}>
            {isPublished ? <><GlobalOutlined /> 公开</> : <><LockOutlined /> 私有</>}
          </Tag>
        </Space>

        <Space size={8} style={{ flex: '0 1 auto' }}>
          <Select
            size="small"
            style={{ width: 120 }}
            value={selectedVoice}
            onChange={setSelectedVoice}
            placeholder="选择语音"
            options={voices.map((v) => ({
              label: v.label || v.name || v.id || v,
              value: v.id || v.name || v,
            }))}
          />
          <Tooltip title={isPlaying ? '暂停' : '播放语音'}>
            <Button
              size="small"
              type={isPlaying ? 'primary' : 'default'}
              icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
              loading={audioLoading}
              onClick={handlePlayPause}
            >
              {isPlaying ? '暂停' : '播放'}
            </Button>
          </Tooltip>
          <Select
            size="small"
            style={{ width: 72 }}
            value={playbackRate}
            onChange={setPlaybackRate}
            options={rateOptions}
          />
          <Tooltip title="音量">
            <Space size={4} style={{ display: 'flex', alignItems: 'center' }}>
              <SoundOutlined style={{ fontSize: 14, color: '#999' }} />
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={volume}
                onChange={setVolume}
                tooltip={{ formatter: (v) => `${Math.round(v * 100)}%` }}
                style={{ width: 70, margin: 0 }}
              />
            </Space>
          </Tooltip>
          <Tooltip title="音频结束后自动播放下一页">
            <Space size={4}>
              <Text type="secondary" style={{ fontSize: 12 }}>自动</Text>
              <Switch size="small" checked={autoPlayNext} onChange={setAutoPlayNext} />
            </Space>
          </Tooltip>
        </Space>

        <Space size={8}>
          <Tooltip title={showTranslation ? '隐藏译文' : '显示译文'}>
            <Button
              size="small"
              type={showTranslation ? 'primary' : 'default'}
              icon={<TranslationOutlined />}
              onClick={() => setShowTranslation(!showTranslation)}
            />
          </Tooltip>
          <Tooltip title={showPdf ? '隐藏PDF' : '显示PDF'}>
            <Button
              size="small"
              type={showPdf ? 'primary' : 'default'}
              icon={<FilePdfOutlined />}
              onClick={() => setShowPdf(!showPdf)}
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
          <Tooltip title="导出备注">
            <Button size="small" icon={<DownloadOutlined />} onClick={handleExportNotes}>
              导出
            </Button>
          </Tooltip>
          {isPublished ? (
            <Button size="small" icon={<StopOutlined />} danger onClick={handleUnpublish}>
              撤回
            </Button>
          ) : (
            <Button size="small" icon={<SendOutlined />} type="primary" ghost onClick={openPublishModal}>
              发布
            </Button>
          )}
          <Text type="secondary">{currentPage + 1} / {totalPages}</Text>
        </Space>
      </div>

      {/* 播放进度条 */}
      {(isPlaying || audioProgress > 0 || audioDuration > 0) && (
        <div style={{ padding: '4px 20px', background: '#fafafa', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          <Text type="secondary" style={{ fontSize: 11, minWidth: 36 }}>{formatTime(audioProgress)}</Text>
          <Slider
            min={0}
            max={audioDuration || 1}
            step={0.1}
            value={audioProgress}
            onChange={handleSeek}
            tooltip={{ formatter: (v) => formatTime(v) }}
            style={{ flex: 1, margin: 0 }}
          />
          <Text type="secondary" style={{ fontSize: 11, minWidth: 36 }}>{formatTime(audioDuration)}</Text>
        </div>
      )}

      {/* 三栏主体 */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>

        {/* 左栏 — 缩略图导航 */}
        <div
          ref={thumbnailListRef}
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
              data-page-idx={idx}
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
                    fontSize: 11, minWidth: 22, height: 22, lineHeight: '22px',
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
          <div style={{ marginBottom: 20 }}>
            <Tag color="blue" style={{ marginBottom: 8 }}>
              第 {slide.slide || currentPage + 1} 页
            </Tag>
            <Title level={3} style={{ margin: 0 }}>
              {slide.title}
            </Title>
          </div>

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

          {/* 讲解文本 — 带段落高亮 */}
          <Card
            size="small"
            style={{ marginBottom: 20, borderRadius: 10 }}
            title={
              <Space>
                <BookOutlined style={{ color: '#1890ff' }} />
                <Text strong>AI 讲解</Text>
                {isPlaying && (
                  <Tag color="processing" style={{ marginLeft: 8 }}>
                    <SoundOutlined /> 播放中
                  </Tag>
                )}
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
                  fontSize: 14, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: '#666', fontStyle: 'italic',
                }}
              >
                {slide.translation}
              </Paragraph>
            </Card>
          )}

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

          <div
            style={{
              display: 'flex', justifyContent: 'space-between', marginTop: 32, paddingBottom: 24,
            }}
          >
            <Button disabled={!hasPrev} icon={<LeftOutlined />} onClick={() => setCurrentPage((p) => p - 1)}>
              上一页
            </Button>
            <Button disabled={!hasNext} type="primary" onClick={() => setCurrentPage((p) => p + 1)}>
              下一页 <RightOutlined />
            </Button>
          </div>
        </div>

        {/* 右栏 — PDF预览 + 备注面板 */}
        {showRightPanel && (
          <div
            style={{
              width: 380, flexShrink: 0, borderLeft: '1px solid #f0f0f0',
              display: 'flex', flexDirection: 'column', background: '#fafafa', overflow: 'hidden',
            }}
          >
            {showPdf && (
              <div
                style={{
                  flex: showNotes ? '0 0 50%' : '1 1 auto',
                  borderBottom: showNotes ? '1px solid #f0f0f0' : 'none',
                  display: 'flex', flexDirection: 'column', minHeight: 0,
                }}
              >
                <div
                  style={{
                    padding: '8px 16px', borderBottom: '1px solid #f0f0f0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
                  }}
                >
                  <Text strong style={{ fontSize: 13 }}>
                    <FilePdfOutlined /> PDF 预览
                  </Text>
                  <Button size="small" type="text" onClick={() => setShowPdf(false)}>收起</Button>
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                  <iframe
                    src={`${pdfUrl}#page=${currentPage + 1}`}
                    style={{ width: '100%', height: '100%', border: 'none' }}
                    title="PDF Preview"
                  />
                </div>
              </div>
            )}

            {showNotes && (
              <div
                style={{
                  flex: showPdf ? '0 0 50%' : '1 1 auto',
                  display: 'flex', flexDirection: 'column', minHeight: 0,
                }}
              >
                <div
                  style={{
                    padding: '12px 16px', borderBottom: '1px solid #f0f0f0',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0,
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
                <div style={{ flex: 1, padding: 12, minHeight: 0 }}>
                  <TextArea
                    value={noteContent}
                    onChange={(e) => handleNoteChange(e.target.value)}
                    placeholder="在这里记录你对本页的学习笔记、心得体会..."
                    style={{
                      height: '100%', resize: 'none', border: 'none', background: '#fff',
                      borderRadius: 8, fontSize: 14, lineHeight: 1.8,
                    }}
                    autoSize={false}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <Modal
        title="发布到社区"
        open={publishModalOpen}
        onCancel={() => setPublishModalOpen(false)}
        footer={null}
        destroyOnClose
        width={520}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>标题</Text>
            <Input
              value={publishTitle}
              onChange={(e) => setPublishTitle(e.target.value)}
              placeholder="请输入标题"
              maxLength={100}
              showCount
            />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>描述</Text>
            <TextArea
              value={publishDesc}
              onChange={(e) => setPublishDesc(e.target.value)}
              placeholder="简要描述你的讲解内容..."
              rows={4}
              maxLength={500}
              showCount
            />
          </div>
          <div>
            <Text strong style={{ display: 'block', marginBottom: 6 }}>标签</Text>
            <Select
              mode="multiple"
              value={publishTags}
              onChange={setPublishTags}
              placeholder="选择标签"
              style={{ width: '100%' }}
              options={tagOptions}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <Button onClick={() => setPublishModalOpen(false)}>取消</Button>
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={publishing}
              onClick={handlePublish}
            >
              确认发布
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
