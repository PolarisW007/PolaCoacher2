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

// Configure pdf.js worker (Vite asset handling)
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * PdfViewer — 基于 react-pdf 渲染 PDF，支持：
 *   - 带 Authorization 头的安全加载
 *   - currentPage 属性联动讲解页码
 *   - 缩放控制、页码导航、加载骨架屏、错误重试
 *
 * Props:
 *   url          — PDF 的 API 地址
 *   currentPage  — 当前讲解页 (0-based)，自动跳转对应 PDF 页
 *   onPageChange — (pageNumber: number) 用户手动翻页回调 (1-based)
 *   height       — 容器高度，默认 '100%'
 */
export default function PdfViewer({ url, currentPage = 0, onPageChange, height = '100%' }) {
  const [blobUrl, setBlobUrl]       = useState(null);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [fetchError, setFetchError] = useState(null);
  const blobRef                     = useRef(null);

  const [numPages, setNumPages]     = useState(null);
  const [pageNumber, setPageNumber] = useState(1);      // 1-based PDF page
  const [scale, setScale]           = useState(1.0);
  const [docLoading, setDocLoading] = useState(false);

  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(600);

  // Sync currentPage (0-based lecture slide) → PDF page (1-based)
  useEffect(() => {
    const target = Math.max(1, currentPage + 1);
    setPageNumber((prev) => {
      if (numPages && target > numPages) return numPages;
      return target;
    });
  }, [currentPage, numPages]);

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

  // Fetch PDF with Authorization header → blob URL
  const loadPdf = useCallback(async (pdfUrl) => {
    if (!pdfUrl) return;
    setFetchLoading(true);
    setFetchError(null);
    if (blobRef.current) {
      URL.revokeObjectURL(blobRef.current);
      blobRef.current = null;
      setBlobUrl(null);
    }
    try {
      const token = localStorage.getItem('token');
      const resp = await fetch(pdfUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const blob = await resp.blob();
      const objUrl = URL.createObjectURL(blob);
      blobRef.current = objUrl;
      setBlobUrl(objUrl);
    } catch (err) {
      setFetchError(err.message || '文档加载失败');
    } finally {
      setFetchLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPdf(url);
    return () => {
      if (blobRef.current) {
        URL.revokeObjectURL(blobRef.current);
        blobRef.current = null;
      }
    };
  }, [url, loadPdf]);

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
      {/* Toolbar */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '6px 12px', background: '#3a3d40', flexShrink: 0, gap: 8,
      }}>
        {/* Page navigation */}
        <Space size={4}>
          <Tooltip title="上一页 (←)">
            <Button
              size="small" icon={<LeftOutlined />}
              disabled={pageNumber <= 1}
              onClick={() => goTo(pageNumber - 1)}
              style={{ color: '#ccc', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
          <span style={{ color: '#ccc', fontSize: 12, minWidth: 70, textAlign: 'center' }}>
            {numPages ? `${pageNumber} / ${numPages}` : '—'}
          </span>
          <Tooltip title="下一页 (→)">
            <Button
              size="small" icon={<RightOutlined />}
              disabled={!numPages || pageNumber >= numPages}
              onClick={() => goTo(pageNumber + 1)}
              style={{ color: '#ccc', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
        </Space>

        {/* Zoom + actions */}
        <Space size={4}>
          <Tooltip title="缩小">
            <Button
              size="small" icon={<ZoomOutOutlined />}
              disabled={scale <= 0.5}
              onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))}
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
              onClick={() => setScale((s) => Math.min(3, +(s + 0.25).toFixed(2)))}
              style={{ color: '#ccc', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
          <Tooltip title="刷新">
            <Button
              size="small" icon={<ReloadOutlined />}
              onClick={() => loadPdf(url)}
              style={{ color: '#ccc', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
          <Tooltip title="新窗口打开">
            <Button
              size="small" icon={<FullscreenOutlined />}
              disabled={!blobUrl}
              onClick={() => blobUrl && window.open(blobUrl, '_blank')}
              style={{ color: '#ccc', background: 'transparent', border: '1px solid #555' }}
            />
          </Tooltip>
        </Space>
      </div>

      {/* Content area */}
      <div
        ref={containerRef}
        style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', alignItems: 'center' }}
      >
        {/* Fetching PDF */}
        {fetchLoading && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, width: '100%' }}>
            <Spin size="large" />
            <span style={{ marginTop: 12, color: '#ccc', fontSize: 13 }}>加载文档中…</span>
          </div>
        )}

        {/* Fetch error */}
        {!fetchLoading && fetchError && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <Result
              status="warning"
              title={<span style={{ color: '#fff' }}>文档加载失败</span>}
              subTitle={<span style={{ color: '#ccc' }}>{fetchError}</span>}
              extra={<Button icon={<ReloadOutlined />} onClick={() => loadPdf(url)}>重试</Button>}
            />
          </div>
        )}

        {/* PDF Document */}
        {!fetchLoading && !fetchError && blobUrl && (
          <Document
            file={blobUrl}
            onLoadSuccess={({ numPages: n }) => {
              setNumPages(n);
              setDocLoading(false);
            }}
            onLoadError={() => {
              setDocLoading(false);
              setFetchError('PDF 解析失败，文件可能已损坏');
            }}
            onLoadProgress={() => setDocLoading(true)}
            loading={
              <div style={{ padding: 24, width: '100%' }}>
                <Skeleton active paragraph={{ rows: 8 }} />
              </div>
            }
            error={
              <Result
                status="warning"
                title={<span style={{ color: '#fff' }}>PDF 解析失败</span>}
                extra={<Button icon={<ReloadOutlined />} onClick={() => loadPdf(url)}>重试</Button>}
              />
            }
            style={{ width: '100%' }}
          >
            <Page
              pageNumber={pageNumber}
              width={containerWidth * scale}
              renderTextLayer
              renderAnnotationLayer
              loading={
                <div style={{ padding: 24, width: containerWidth }}>
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
