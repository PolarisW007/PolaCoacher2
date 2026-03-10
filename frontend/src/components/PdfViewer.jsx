import { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Space, Spin, Result, Skeleton, Tooltip } from 'antd';
import {
  ReloadOutlined, ZoomInOutlined, ZoomOutOutlined,
  LeftOutlined, RightOutlined, FilePdfOutlined,
  FullscreenOutlined, DownloadOutlined, LockOutlined,
} from '@ant-design/icons';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure pdf.js worker — use CDN to avoid nginx MIME type issues with .mjs
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

const PAGE_LIMIT = 50; // 在线最多渲染 50 页，超出提示下载

// 将 PDF outline 扁平化为树形结构（react-pdf 返回的格式）
function flattenOutline(items, depth = 0) {
  if (!items || !items.length) return [];
  return items.map((item) => ({
    title: item.title,
    page: item.dest?.[0]?._pageIndex != null ? item.dest[0]._pageIndex + 1 : null,
    bold: item.bold,
    italic: item.italic,
    items: flattenOutline(item.items || [], depth + 1),
  }));
}

/**
 * PdfViewer — 基于 react-pdf，支持带 JWT 认证的 PDF 渲染。
 * 超过 50 页时，第 50 页显示下载引导浮层，不再渲染后续页。
 *
 * Props:
 *   url           — PDF 的 API 地址（不含 token）
 *   currentPage   — 当前讲解页 (0-based)，自动跳转对应 PDF 页（讲解播放模式用）
 *   onPageChange  — (pageNumber: number) 用户手动翻页回调 (1-based)
 *   onTotalPages  — (total: number) PDF 总页数回调
 *   onOutline     — (tree: array) PDF 目录树回调
 *   onGoToRef     — (fn) 注入跳页函数，供父组件调用
 *   height        — 容器高度，默认 '100%'
 *   filename      — 下载文件名（可选）
 */
export default function PdfViewer({ url, currentPage = 0, onPageChange, onTotalPages, onOutline, onGoToRef, height = '100%', filename = 'document.pdf' }) {
  const [numPages, setNumPages]     = useState(null);
  const [pageNumber, setPageNumber] = useState(1);   // 1-based
  const [scale, setScale]           = useState(1.0);
  const [docError, setDocError]     = useState(null);
  const [key, setKey]               = useState(0);   // force remount on retry

  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // 实际可浏览的最大页码（受 PAGE_LIMIT 限制）
  const visiblePages = numPages ? Math.min(numPages, PAGE_LIMIT) : null;
  const isLimited    = numPages != null && numPages > PAGE_LIMIT;
  // 当前是否在最后一可见页（且原始文档还有更多页）
  const isAtLimit    = isLimited && pageNumber === PAGE_LIMIT;

  // Build authenticated URL: append ?token=<jwt> so pdf.js worker can fetch with auth
  const authUrl = useCallback(() => {
    if (!url) return null;
    const token = localStorage.getItem('token');
    if (!token) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  }, [url]);

  // Sync currentPage (0-based lecture slide) → PDF page (1-based, capped at PAGE_LIMIT)
  useEffect(() => {
    const target = Math.max(1, currentPage + 1);
    const capped = visiblePages ? Math.min(target, visiblePages) : target;
    setPageNumber(capped);
  }, [currentPage, visiblePages]);

  // Reset when url changes
  useEffect(() => {
    setDocError(null);
    setNumPages(null);
    setPageNumber(1);
    setKey(k => k + 1);
  }, [url]);

  // Measure container width for responsive rendering
  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        if (w > 0) setContainerWidth(w);
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const goTo = (n) => {
    const page = Math.max(1, Math.min(visiblePages || 1, n));
    setPageNumber(page);
    onPageChange?.(page);
  };

  // 注入跳页函数供父组件调用
  useEffect(() => {
    onGoToRef?.(goTo);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visiblePages]);

  const handleDownload = () => {
    const link = document.createElement('a');
    link.href = authUrl();
    link.download = filename;
    link.click();
  };

  const heightStyle = typeof height === 'number' ? `${height}px` : height;

  if (!url) {
    return (
      <Result
        icon={<FilePdfOutlined style={{ color: '#bbb' }} />}
        subTitle="暂无文档原文"
        style={{ padding: '40px 0' }}
      />
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: heightStyle, background: '#525659' }}>
      {/* 工具栏 */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 12px', background: '#3a3d40', flexShrink: 0, gap: 8,
      }}>
        {/* 页码导航 */}
        <Space size={4}>
          <Tooltip title="上一页">
            <Button
              size="small" icon={<LeftOutlined />}
              disabled={pageNumber <= 1}
              onClick={() => goTo(pageNumber - 1)}
              style={{ color: '#ccc', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
          <span style={{ color: '#ccc', fontSize: 12, minWidth: 80, textAlign: 'center' }}>
            {visiblePages
              ? isLimited
                ? `${pageNumber} / ${PAGE_LIMIT}（共${numPages}页）`
                : `${pageNumber} / ${numPages}`
              : '加载中…'}
          </span>
          <Tooltip title="下一页">
            <Button
              size="small" icon={<RightOutlined />}
              disabled={!visiblePages || pageNumber >= visiblePages}
              onClick={() => goTo(pageNumber + 1)}
              style={{ color: '#ccc', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
        </Space>

        {/* 缩放 + 操作 */}
        <Space size={4}>
          <Tooltip title="缩小">
            <Button
              size="small" icon={<ZoomOutOutlined />}
              disabled={scale <= 0.5}
              onClick={() => setScale(s => Math.max(0.5, +(s - 0.25).toFixed(2)))}
              style={{ color: '#ccc', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
          <span style={{ color: '#ccc', fontSize: 12, minWidth: 40, textAlign: 'center' }}>
            {Math.round(scale * 100)}%
          </span>
          <Tooltip title="放大">
            <Button
              size="small" icon={<ZoomInOutlined />}
              disabled={scale >= 3}
              onClick={() => setScale(s => Math.min(3, +(s + 0.25).toFixed(2)))}
              style={{ color: '#ccc', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
          <Tooltip title="刷新">
            <Button
              size="small" icon={<ReloadOutlined />}
              onClick={() => { setDocError(null); setKey(k => k + 1); }}
              style={{ color: '#ccc', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
          <Tooltip title="下载完整PDF">
            <Button
              size="small" icon={<DownloadOutlined />}
              onClick={handleDownload}
              style={{ color: '#52c41a', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
          <Tooltip title="新窗口打开">
            <Button
              size="small" icon={<FullscreenOutlined />}
              onClick={() => authUrl() && window.open(authUrl(), '_blank')}
              style={{ color: '#ccc', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
        </Space>
      </div>

      {/* PDF 内容区 */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0' }}
      >
        {docError ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <Result
              status="warning"
              title={<span style={{ color: '#fff' }}>文档加载失败</span>}
              subTitle={<span style={{ color: '#ccc' }}>{docError}</span>}
              extra={
                <Button icon={<ReloadOutlined />} onClick={() => { setDocError(null); setKey(k => k + 1); }}>
                  重试
                </Button>
              }
            />
          </div>
        ) : (
          <div style={{ position: 'relative', width: '100%', display: 'flex', justifyContent: 'center' }}>
            <Document
              key={key}
              file={authUrl()}
              onLoadSuccess={({ numPages: n, ...docProxy }) => {
                setNumPages(n);
                onTotalPages?.(n);
                // 解析 PDF outline（目录树）
                if (onOutline) {
                  docProxy._pdfInfo?.pdfDocument?.getOutline?.().then?.((outline) => {
                    onOutline(flattenOutline(outline || []));
                  }).catch(() => onOutline([]));
                }
              }}
              onLoadError={(err) => setDocError(err?.message || 'PDF 加载失败，请重试')}
              loading={
                <div style={{ padding: 24, width: containerWidth || '100%' }}>
                  <Spin size="large" style={{ display: 'block', margin: '60px auto' }} />
                  <Skeleton active paragraph={{ rows: 6 }} style={{ marginTop: 24 }} />
                </div>
              }
              error={
                <Result
                  status="warning"
                  title={<span style={{ color: '#fff' }}>PDF 解析失败</span>}
                  extra={<Button icon={<ReloadOutlined />} onClick={() => setKey(k => k + 1)}>重试</Button>}
                />
              }
            >
              <Page
                pageNumber={pageNumber}
                width={Math.min((containerWidth || 600) * scale, (containerWidth || 600))}
                scale={scale}
                renderTextLayer
                renderAnnotationLayer
                loading={
                  <div style={{ padding: 24, width: containerWidth || '100%' }}>
                    <Skeleton active paragraph={{ rows: 12 }} />
                  </div>
                }
              />
            </Document>

            {/* 超出 50 页时的锁定浮层（仅在第 50 页显示） */}
            {isAtLimit && (
              <div style={{
                position: 'absolute', inset: 0,
                background: 'linear-gradient(to bottom, rgba(30,30,30,0.1) 0%, rgba(20,20,20,0.92) 40%, rgba(10,10,10,0.98) 100%)',
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end',
                paddingBottom: 48, paddingInline: 24,
              }}>
                <div style={{
                  textAlign: 'center', maxWidth: 320,
                  background: 'rgba(255,255,255,0.06)', backdropFilter: 'blur(8px)',
                  borderRadius: 16, padding: '28px 32px', border: '1px solid rgba(255,255,255,0.12)',
                }}>
                  <LockOutlined style={{ fontSize: 36, color: '#faad14', marginBottom: 12 }} />
                  <div style={{ color: '#fff', fontSize: 16, fontWeight: 600, marginBottom: 8 }}>
                    在线预览已到第 {PAGE_LIMIT} 页
                  </div>
                  <div style={{ color: '#bbb', fontSize: 13, lineHeight: 1.7, marginBottom: 20 }}>
                    该文档共 <span style={{ color: '#faad14', fontWeight: 600 }}>{numPages}</span> 页，
                    在线阅读最多支持 {PAGE_LIMIT} 页。<br />
                    下载完整 PDF 到本地即可阅读全部内容。
                  </div>
                  <Button
                    type="primary"
                    size="large"
                    icon={<DownloadOutlined />}
                    onClick={handleDownload}
                    style={{
                      width: '100%', borderRadius: 8, fontWeight: 600,
                      background: 'linear-gradient(135deg, #2dce89 0%, #1a7a52 100%)',
                      border: 'none', height: 44,
                    }}
                  >
                    下载完整 PDF（{numPages} 页）
                  </Button>
                  <div style={{ color: '#888', fontSize: 12, marginTop: 12 }}>
                    或点击右上角 <FullscreenOutlined style={{ fontSize: 11 }} /> 在新窗口打开
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
