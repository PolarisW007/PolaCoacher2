import { useState, useEffect, useRef, useCallback } from 'react';
import { Button, Space, Spin, Result, Skeleton, Tooltip } from 'antd';
import {
  ReloadOutlined, ZoomInOutlined, ZoomOutOutlined,
  LeftOutlined, RightOutlined, FilePdfOutlined,
  FullscreenOutlined,
} from '@ant-design/icons';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure pdf.js worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * PdfViewer — 基于 react-pdf，支持带 JWT 认证的 PDF 渲染。
 * 通过在 URL 中附加 token 参数实现认证（后端 get_pdf 接受 ?token= 查询参数）。
 *
 * Props:
 *   url          — PDF 的 API 地址（不含 token）
 *   currentPage  — 当前讲解页 (0-based)，自动跳转对应 PDF 页
 *   onPageChange — (pageNumber: number) 用户手动翻页回调 (1-based)
 *   height       — 容器高度，默认 '100%'
 */
export default function PdfViewer({ url, currentPage = 0, onPageChange, height = '100%' }) {
  const [numPages, setNumPages]   = useState(null);
  const [pageNumber, setPageNumber] = useState(1);   // 1-based
  const [scale, setScale]         = useState(1.0);
  const [docError, setDocError]   = useState(null);
  const [key, setKey]             = useState(0);     // force remount on retry

  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // Build authenticated URL: append ?token=<jwt> so pdf.js worker can fetch with auth
  const authUrl = useCallback(() => {
    if (!url) return null;
    const token = localStorage.getItem('token');
    if (!token) return url;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}token=${encodeURIComponent(token)}`;
  }, [url]);

  // Sync currentPage (0-based lecture slide) → PDF page (1-based)
  useEffect(() => {
    const target = Math.max(1, currentPage + 1);
    setPageNumber(numPages ? Math.min(target, numPages) : target);
  }, [currentPage, numPages]);

  // Reset error when url changes
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
    const page = Math.max(1, Math.min(numPages || 1, n));
    setPageNumber(page);
    onPageChange?.(page);
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
          <span style={{ color: '#ccc', fontSize: 12, minWidth: 70, textAlign: 'center' }}>
            {numPages ? `${pageNumber} / ${numPages}` : '加载中…'}
          </span>
          <Tooltip title="下一页">
            <Button
              size="small" icon={<RightOutlined />}
              disabled={!numPages || pageNumber >= numPages}
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
          <Document
            key={key}
            file={authUrl()}
            onLoadSuccess={({ numPages: n }) => setNumPages(n)}
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
        )}
      </div>
    </div>
  );
}
