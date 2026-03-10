import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Card,
  Table,
  Button,
  Input,
  Select,
  Space,
  Modal,
  message,
  Typography,
} from 'antd';
import {
  SearchOutlined,
  ReadOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  FileTextOutlined,
} from '@ant-design/icons';
import { docApi } from '../api/documents';
import dayjs from 'dayjs';

const { Text } = Typography;

const statusMap = {
  uploading: { text: '上传中', bg: 'rgba(17,205,239,0.1)', color: '#11cdef' },
  processing: { text: '处理中', bg: 'rgba(17,205,239,0.1)', color: '#11cdef' },
  ready: { text: '就绪', bg: 'rgba(45,206,137,0.1)', color: '#2dce89' },
  error: { text: '错误', bg: 'rgba(245,54,92,0.1)', color: '#f5365c' },
  pending: { text: '待处理', bg: 'rgba(90,106,126,0.1)', color: '#5a6a7e' },
};

const typeColorMap = {
  pdf: { bg: 'rgba(91,79,212,0.1)', color: '#5b4fd4' },
  docx: { bg: 'rgba(14,165,233,0.1)', color: '#0ea5e9' },
  txt: { bg: 'rgba(45,206,137,0.1)', color: '#2dce89' },
  md: { bg: 'rgba(244,63,94,0.1)', color: '#f43f5e' },
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
  const pageSize = 20;

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

  const handleDelete = (doc) => {
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

  const columns = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      ellipsis: true,
      render: (text, record) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, flexShrink: 0,
            background: typeColorMap[record.file_type]?.bg || 'rgba(45,206,137,0.1)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <FileTextOutlined style={{ color: typeColorMap[record.file_type]?.color || '#2dce89', fontSize: 15 }} />
          </div>
          <Text strong style={{ color: '#1a2332' }}>{text || '未命名'}</Text>
        </div>
      ),
    },
    {
      title: '类型',
      dataIndex: 'file_type',
      key: 'file_type',
      width: 80,
      render: (type) => {
        const cfg = typeColorMap[type] || typeColorMap.txt;
        return (
          <span style={{
            padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.5px',
            background: cfg.bg, color: cfg.color,
          }}>
            {type || '-'}
          </span>
        );
      },
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 100,
      render: (v) => <Text style={{ color: '#8896a8', fontSize: 13 }}>{formatFileSize(v)}</Text>,
    },
    {
      title: '页数',
      dataIndex: 'page_count',
      key: 'page_count',
      width: 70,
      render: (v) => <Text style={{ color: '#8896a8', fontSize: 13 }}>{v ?? '-'}</Text>,
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 90,
      render: (status) => {
        const cfg = statusMap[status] || { text: status, bg: 'rgba(90,106,126,0.1)', color: '#5a6a7e' };
        return (
          <span style={{
            padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 500,
            background: cfg.bg, color: cfg.color,
          }}>
            {cfg.text}
          </span>
        );
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 130,
      render: (t) => <Text style={{ color: '#8896a8', fontSize: 12 }}>{t ? dayjs(t).format('MM-DD HH:mm') : '-'}</Text>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      render: (_, record) => (
        <Space size={4}>
          <Button
            type="text"
            size="small"
            icon={<ReadOutlined style={{ color: '#5a6a7e' }} />}
            onClick={() => navigate(`/reader/${record.id}`)}
            style={{ borderRadius: 6 }}
          >
            <span style={{ color: '#5a6a7e', fontSize: 12 }}>阅读</span>
          </Button>
          <Button
            type="text"
            size="small"
            icon={<PlayCircleOutlined style={{ color: record.status === 'ready' ? '#2dce89' : '#ccc' }} />}
            disabled={record.status !== 'ready'}
            onClick={() => navigate(`/study/${record.id}`)}
            style={{ borderRadius: 6 }}
          >
            <span style={{ fontSize: 12, color: record.status === 'ready' ? '#2dce89' : '#ccc' }}>播放</span>
          </Button>
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
            style={{ borderRadius: 6 }}
          />
        </Space>
      ),
    },
  ];

  return (
    <div className="fade-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 26, fontWeight: 800, color: '#1a2332', letterSpacing: '-0.5px', marginBottom: 4 }}>
          文档库
        </div>
        <Text style={{ color: '#8896a8', fontSize: 13 }}>全部文档列表管理</Text>
      </div>

      <Card
        style={{
          borderRadius: 14,
          border: '1px solid rgba(226,234,243,0.8)',
          boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
        }}
      >
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 20, flexWrap: 'wrap', gap: 12,
        }}>
          <Input.Search
            placeholder="搜索文档标题..."
            allowClear
            onSearch={handleSearch}
            style={{ maxWidth: 320, borderRadius: 10 }}
            prefix={<SearchOutlined style={{ color: '#aab4be' }} />}
          />
          <Space>
            <Select
              value={sortBy}
              onChange={(v) => { setSortBy(v); setPage(1); }}
              style={{ width: 120, borderRadius: 10 }}
              options={[
                { value: 'created_at', label: '创建时间' },
                { value: 'title', label: '标题' },
                { value: 'file_size', label: '文件大小' },
              ]}
            />
            <Button
              icon={sortOrder === 'asc' ? <SortAscendingOutlined /> : <SortDescendingOutlined />}
              onClick={() => { setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc')); setPage(1); }}
              style={{ borderRadius: 10 }}
            />
          </Space>
        </div>

        <Table
          className="sci-table"
          dataSource={docs}
          columns={columns}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p) => setPage(p),
            showSizeChanger: false,
            showTotal: (t) => `共 ${t} 个文档`,
          }}
          scroll={{ x: 800 }}
          rowClassName={() => 'sci-table-row'}
        />
      </Card>
    </div>
  );
}
