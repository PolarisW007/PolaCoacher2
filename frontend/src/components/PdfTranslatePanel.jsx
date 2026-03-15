/**
 * PdfTranslatePanel — PDF 右侧对照翻译面板
 *
 * 接收当前页码，调用后端 /pdf-page-translate 接口，
 * 以「纸张」风格渲染译文，排版参照 PDF 原文：
 *   - heading → 大字号粗体
 *   - text     → 正文段落
 *   - caption  → 小字注释
 *   - image    → 图片占位条
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { Spin, Tooltip } from 'antd';
import { TranslationOutlined, PictureOutlined } from '@ant-design/icons';
import client from '../api/client';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

function fetchPageTranslation(docId, page, targetLang = 'zh') {
  return client.get(`/documents/${docId}/pdf-page-translate`, {
    params: { page, target_lang: targetLang },
    timeout: 90000,
  });
}

// ── 单个块渲染 ──────────────────────────────────
function Block({ blk, showOriginal }) {
  if (blk.type === 'image') {
    const pct = blk.width_ratio ? `${Math.round(blk.width_ratio * 100)}%` : '80%';
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        width: pct, margin: '12px auto',
        height: 48, borderRadius: 6,
        background: 'rgba(0,0,0,0.06)',
        color: '#aaa', fontSize: 13, gap: 6,
      }}>
        <PictureOutlined /> 图片
      </div>
    );
  }

  const isHeading = blk.type === 'heading';
  const isCaption = blk.type === 'caption';

  return (
    <div style={{ marginBottom: isHeading ? 14 : 8 }}>
      {/* 译文 */}
      <p style={{
        margin: 0,
        fontSize: isHeading ? 15 : isCaption ? 11 : 13.5,
        fontWeight: isHeading ? 700 : 400,
        lineHeight: isHeading ? 1.5 : 1.75,
        color: isCaption ? '#666' : '#1a1a1a',
        textAlign: isCaption ? 'center' : 'left',
      }}>
        {blk.translated || blk.text}
      </p>
      {/* 可选：显示原文（浅色小字） */}
      {showOriginal && blk.text && blk.translated && blk.translated !== blk.text && (
        <p style={{
          margin: '3px 0 0',
          fontSize: isCaption ? 10 : 11.5,
          color: '#999',
          lineHeight: 1.5,
          borderLeft: '2px solid #e0e0e0',
          paddingLeft: 8,
        }}>
          {blk.text}
        </p>
      )}
    </div>
  );
}

// ── 主面板 ──────────────────────────────────────
export default function PdfTranslatePanel({ docId, page, targetLang = 'zh', bgColor = '#f5f5f0' }) {
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadedPage, setLoadedPage] = useState(null);
  const [totalPages, setTotalPages] = useState(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [cached, setCached] = useState(false);
  const abortRef = useRef(null);

  const load = useCallback(async (pg) => {
    if (!docId || !pg) return;
    if (abortRef.current) abortRef.current.cancel?.();

    setLoading(true);
    setError('');
    setCached(false);
    try {
      const res = await fetchPageTranslation(docId, pg, targetLang);
      const data = res?.data?.data || res?.data || {};
      setBlocks(data.blocks || []);
      setTotalPages(data.total_pages || null);
      setLoadedPage(pg);
      setCached(!!data.cached);
    } catch (e) {
      if (e?.code === 'ERR_CANCELED') return;
      setError(e?.response?.data?.detail || e.message || '翻译失败');
    } finally {
      setLoading(false);
    }
  }, [docId, targetLang]);

  useEffect(() => {
    load(page);
  }, [page, load]);

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: bgColor,
      borderLeft: '1px solid rgba(0,0,0,0.12)',
    }}>
      {/* 面板标题栏 */}
      <div style={{
        height: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: '#3a3d40',
        flexShrink: 0,
      }}>
        <span style={{ color: '#ccc', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <TranslationOutlined />
          对照译文
          {totalPages && (
            <span style={{ color: '#888', marginLeft: 4 }}>
              第 {loadedPage} / {totalPages} 页
            </span>
          )}
          {cached && (
            <span style={{ color: '#52c41a', fontSize: 10, marginLeft: 4 }}>已缓存</span>
          )}
        </span>
        <Tooltip title={showOriginal ? '隐藏原文' : '显示原文对照'}>
          <span
            onClick={() => setShowOriginal(v => !v)}
            style={{
              fontSize: 11, color: showOriginal ? '#52c41a' : '#888',
              cursor: 'pointer', userSelect: 'none',
              padding: '2px 8px', borderRadius: 4,
              border: `1px solid ${showOriginal ? '#52c41a' : '#555'}`,
            }}
          >
            原文
          </span>
        </Tooltip>
      </div>

      {/* 内容区（仿 PDF 纸张样式） */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '24px 28px',
        background: '#fff',
        boxSizing: 'border-box',
      }}>
        {loading && (
          <div style={{ textAlign: 'center', paddingTop: 60 }}>
            <Spin size="large" />
            <div style={{ marginTop: 16, color: '#888', fontSize: 13 }}>
              正在翻译第 {page} 页…
            </div>
          </div>
        )}

        {!loading && error && (
          <div style={{ textAlign: 'center', paddingTop: 40, color: '#ff4d4f', fontSize: 13 }}>
            {error}
          </div>
        )}

        {!loading && !error && blocks.length === 0 && (
          <div style={{ textAlign: 'center', paddingTop: 40, color: '#aaa', fontSize: 13 }}>
            本页无可提取文字
          </div>
        )}

        {!loading && !error && blocks.map((blk, i) => (
          <Block key={i} blk={blk} showOriginal={showOriginal} />
        ))}
      </div>
    </div>
  );
}
