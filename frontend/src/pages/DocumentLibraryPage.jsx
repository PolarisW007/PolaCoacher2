import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Button,
  Input,
  Select,
  Space,
  Modal,
  message,
  Typography,
  Pagination,
  Empty,
  Spin,
  Tooltip,
} from 'antd';
import {
  SearchOutlined,
  ReadOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileTextOutlined,
  FileMarkdownOutlined,
  MoreOutlined,
  FieldTimeOutlined,
  BookOutlined,
} from '@ant-design/icons';
import { docApi } from '../api/documents';
import dayjs from 'dayjs';

const { Text, Paragraph } = Typography;

const statusMap = {
  uploading: { text: '上传中', bg: 'rgba(17,205,239,0.15)', color: '#11cdef' },
  processing: { text: '处理中', bg: 'rgba(17,205,239,0.15)', color: '#11cdef' },
  ready: { text: '已就绪', bg: 'rgba(45,206,137,0.15)', color: '#2dce89' },
  error: { text: '处理失败', bg: 'rgba(245,54,92,0.15)', color: '#f5365c' },
  pending: { text: '排队中', bg: 'rgba(90,106,126,0.15)', color: '#5a6a7e' },
};

const typeIconMap = {
  pdf: <FilePdfOutlined />,
  docx: <FileWordOutlined />,
  txt: <FileTextOutlined />,
  md: <FileMarkdownOutlined />,
};

const typeColorMap = {
  pdf: { bg: 'linear-gradient(135deg, #f5365c 0%, #fb6340 100%)', color: '#fff' },
  docx: { bg: 'linear-gradient(135deg, #11cdef 0%, #1171ef 100%)', color: '#fff' },
  txt: { bg: 'linear-gradient(135deg, #2dce89 0%, #2dcecc 100%)', color: '#fff' },
  md: { bg: 'linear-gradient(135deg, #8965e0 0%, #bc65e0 100%)', color: '#fff' },
};

const formatFileSize = (bytes) => {
  if (!bytes) return '-';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export default function DocumentLibraryPage() {
  const navigate = useNavigate();
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const pageSize = 12; // Grid view shows 12 items per page better

  const fetchDocs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, page_size: pageSize, sort_by: sortBy, sort_order: sortOrder };
      if (search.trim()) params.search = search.trim();
      const res = await docApi.list(params);
      setDocs(res.data.items || []);
      setTotal(res.data.total || 0);
    } catch (err) {
      message.error('加载失败：' + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  }, [page, search, sortBy, sortOrder]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const handleSearch = (value) => { setSearch(value); setPage(1); };

  const handleDelete = (e, doc) => {
    e.stopPropagation();
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除「${doc.title}」吗？此操作不可恢复。`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          await docApi.delete(doc.id);
          message.success('已删除');
          fetchDocs();
        } catch (err) {
          message.error('删除失败：' + (err.response?.data?.detail || err.message));
        }
      },
    });
  };

  const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

  return (
    <div className="fade-in" style={{ maxWidth: 1400, margin: '0 auto', paddingBottom: 40 }}>
      <style>{`
        .doc-card {
          border-radius: 16px;
          background: #fff;
          border: 1px solid rgba(226,234,243,0.8);
          overflow: hidden;
          transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
          position: relative;
          display: flex;
          flex-direction: column;
          height: 100%;
          cursor: pointer;
        }
        .doc-card:hover {
          transform: translateY(-6px);
          box-shadow: 0 12px 24px rgba(0,0,0,0.08);
          border-color: rgba(45,206,137,0.3);
        }
        .doc-cover {
          height: 160px;
          position: relative;
          overflow: hidden;
          background: #f8f9fa;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .doc-cover img {
          width: 100%;
          height: 100%;
          object-fit: cover;
          transition: transform 0.5s ease;
        }
        .doc-card:hover .doc-cover img {
          transform: scale(1.05);
        }
        .doc-type-badge {
          position: absolute;
          top: 12px;
          left: 12px;
          padding: 4px 10px;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.5px;
          text-transform: uppercase;
          box-shadow: 0 4px 10px rgba(0,0,0,0.1);
          z-index: 2;
        }
        .doc-status-badge {
          position: absolute;
          top: 12px;
          right: 12px;
          padding: 4px 10px;
          border-radius: 8px;
          font-size: 11px;
          font-weight: 600;
          backdrop-filter: blur(8px);
          -webkit-backdrop-filter: blur(8px);
          z-index: 2;
        }
        .doc-content {
          padding: 16px;
          flex: 1;
          display: flex;
          flex-direction: column;
        }
        .doc-title {
          font-size: 16px;
          font-weight: 700;
          color: #1a2332;
          margin-bottom: 8px;
          line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .doc-summary {
          font-size: 13px;
          color: #5a6a7e;
          line-height: 1.6;
          flex: 1;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
          margin-bottom: 12px;
        }
        .doc-meta {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 12px;
          color: #8896a8;
          padding-top: 12px;
          border-top: 1px solid rgba(226,234,243,0.6);
        }
        .doc-meta-item {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .doc-actions {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(255,255,255,0.95);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          padding: 12px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          transform: translateY(100%);
          transition: transform 0.3s ease;
          border-top: 1px solid rgba(226,234,243,0.8);
        }
        .doc-card:hover .doc-actions {
          transform: translateY(0);
        }
        @media (max-width: 768px) {
          .doc-actions {
            transform: translateY(0);
            position: relative;
            background: transparent;
            padding: 12px 0 0 0;
            border-top: none;
            margin-top: 12px;
            border-top: 1px dashed #eee;
          }
          .doc-grid {
            grid-template-columns: 1fr !important;
          }
          .controls-bar {
            flex-direction: column;
            align-items: stretch !important;
          }
          .controls-bar > .ant-space {
            width: 100%;
            justify-content: space-between;
          }
        }
      `}</style>

      {/* Header & Controls */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'linear-gradient(135deg, #11cdef 0%, #1171ef 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 20, boxShadow: '0 4px 12px rgba(17,205,239,0.3)'
          }}>
            <BookOutlined />
          </div>
          <div>
            <div style={{ fontSize: 26, fontWeight: 800, color: '#1a2332', letterSpacing: '-0.5px' }}>
              文档库
            </div>
          </div>
        </div>
        <Text style={{ color: '#8896a8', fontSize: 14 }}>在这里管理和回顾你上传的所有文档资料</Text>
      </div>

      <div className="controls-bar" style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 24, gap: 16,
        background: '#fff', padding: '16px 20px', borderRadius: 16,
        boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
        border: '1px solid rgba(226,234,243,0.8)'
      }}>
        <Input.Search
          placeholder="搜索文档标题..."
          allowClear
          onSearch={handleSearch}
          style={{ maxWidth: 360, flex: 1 }}
          size="large"
          prefix={<SearchOutlined style={{ color: '#aab4be' }} />}
        />
        <Space size={12}>
          <Select
            value={sortBy}
            onChange={(v) => { setSortBy(v); setPage(1); }}
            style={{ width: 140 }}
            size="large"
            options={[
              { value: 'created_at', label: '按时间排序' },
              { value: 'title', label: '按标题排序' },
              { value: 'file_size', label: '按大小排序' },
            ]}
          />
          <Button
            size="large"
            icon={sortOrder === 'asc' ? <SortAscendingOutlined /> : <SortDescendingOutlined />}
            onClick={() => { setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc')); setPage(1); }}
          />
        </Space>
      </div>

      {/* Main Content */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <Spin size="large" tip="加载文档中..." />
        </div>
      ) : docs.length === 0 ? (
        <div style={{ background: '#fff', borderRadius: 16, padding: '80px 0', border: '1px solid #edf2f7', textAlign: 'center' }}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={<span style={{ color: '#8896a8', fontSize: 15 }}>这里空空如也，快去书架上传文档吧</span>}
          />
          <Button type="primary" size="large" style={{ marginTop: 16, borderRadius: 8 }} onClick={() => navigate('/')}>
            前往书架上传
          </Button>
        </div>
      ) : (
        <>
          <div className="doc-grid" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
            gap: 24,
            marginBottom: 32
          }}>
            {docs.map(doc => {
              const typeCfg = typeColorMap[doc.file_type] || typeColorMap.txt;
              const statusCfg = statusMap[doc.status] || statusMap.pending;
              const isReady = doc.status === 'ready';

              return (
                <div key={doc.id} className="doc-card" onClick={() => isReady && navigate(`/reader/${doc.id}`)}>
                  {/* Cover Area */}
                  <div className="doc-cover">
                    <div className="doc-type-badge" style={{ background: typeCfg.bg, color: typeCfg.color }}>
                      <Space size={4}>{typeIconMap[doc.file_type] || <FileTextOutlined />} {doc.file_type}</Space>
                    </div>
                    <div className="doc-status-badge" style={{ background: statusCfg.bg, color: statusCfg.color }}>
                      {statusCfg.text}
                    </div>
                    
                    {doc.cover_url ? (
                      <img src={doc.cover_url.startsWith('http') ? doc.cover_url : `${BASE}${doc.cover_url}`} alt={doc.title} loading="lazy" />
                    ) : (
                      <div style={{
                        width: '100%', height: '100%',
                        background: 'linear-gradient(135deg, #f6f8fd 0%, #f1f4f9 100%)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        color: '#d1d9e6'
                      }}>
                        {typeIconMap[doc.file_type] || <FileTextOutlined style={{ fontSize: 48 }} />}
                      </div>
                    )}
                  </div>

                  {/* Content Area */}
                  <div className="doc-content">
                    <div className="doc-title" title={doc.title}>{doc.title || '未命名文档'}</div>
                    <div className="doc-summary">
                      {doc.summary || 'AI 正在努力阅读并提炼摘要中，请稍候...'}
                    </div>
                    
                    <div className="doc-meta">
                      <div className="doc-meta-item">
                        <FieldTimeOutlined /> {dayjs(doc.created_at).format('YYYY-MM-DD')}
                      </div>
                      <div className="doc-meta-item" style={{ marginLeft: 'auto' }}>
                        {formatFileSize(doc.file_size)}
                      </div>
                      {doc.page_count && (
                        <div className="doc-meta-item">
                          · {doc.page_count} 页
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Hover Actions */}
                  <div className="doc-actions" onClick={e => e.stopPropagation()}>
                    <Space>
                      <Button
                        type="primary"
                        shape="round"
                        icon={<ReadOutlined />}
                        onClick={() => navigate(`/reader/${doc.id}`)}
                        disabled={!isReady}
                        style={{ background: isReady ? 'linear-gradient(135deg, #2dce89 0%, #11cdef 100%)' : '#ccc', border: 'none' }}
                      >
                        阅读
                      </Button>
                      <Tooltip title={isReady ? "AI 讲解" : "处理中"}>
                        <Button
                          shape="circle"
                          icon={<PlayCircleOutlined />}
                          onClick={() => navigate(`/study/${doc.id}`)}
                          disabled={!isReady}
                          style={{ color: isReady ? '#2dce89' : '#ccc', borderColor: isReady ? '#2dce89' : '#ccc' }}
                        />
                      </Tooltip>
                    </Space>
                    <Tooltip title="删除文档">
                      <Button
                        type="text"
                        danger
                        shape="circle"
                        icon={<DeleteOutlined />}
                        onClick={(e) => handleDelete(e, doc)}
                      />
                    </Tooltip>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', background: '#fff', padding: '16px', borderRadius: 16, border: '1px solid #edf2f7' }}>
            <Pagination
              current={page}
              pageSize={pageSize}
              total={total}
              onChange={setPage}
              showSizeChanger={false}
              showTotal={(t) => `共 ${t} 个文档`}
            />
          </div>
        </>
      )}
    </div>
  );
}
