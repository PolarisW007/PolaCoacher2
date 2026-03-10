import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Typography,
  Card,
  Table,
  Tag,
  Button,
  Input,
  Select,
  Space,
  Modal,
  message,
} from 'antd';
import {
  SearchOutlined,
  ReadOutlined,
  PlayCircleOutlined,
  DeleteOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
} from '@ant-design/icons';
import { docApi } from '../api/documents';
import dayjs from 'dayjs';

const { Title, Text } = Typography;

const statusMap = {
  uploading: { text: '上传中', color: 'processing' },
  processing: { text: '处理中', color: 'processing' },
  ready: { text: '就绪', color: 'success' },
  error: { text: '错误', color: 'error' },
  pending: { text: '待处理', color: 'default' },
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
      const params = {
        page,
        page_size: pageSize,
        sort_by: sortBy,
        sort_order: sortOrder,
      };
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

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  const handleSearch = (value) => {
    setSearch(value);
    setPage(1);
  };

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
      render: (text) => <Text strong>{text || '未命名'}</Text>,
    },
    {
      title: '类型',
      dataIndex: 'file_type',
      key: 'file_type',
      width: 90,
      render: (type) => (
        <Tag style={{ textTransform: 'uppercase' }}>{type || '-'}</Tag>
      ),
    },
    {
      title: '大小',
      dataIndex: 'file_size',
      key: 'file_size',
      width: 100,
      render: formatFileSize,
    },
    {
      title: '页数',
      dataIndex: 'page_count',
      key: 'page_count',
      width: 80,
      render: (v) => v ?? '-',
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const cfg = statusMap[status] || { text: status, color: 'default' };
        return <Tag color={cfg.color}>{cfg.text}</Tag>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 140,
      render: (t) => (t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '-'),
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_, record) => (
        <Space>
          <Button
            type="text"
            size="small"
            icon={<ReadOutlined />}
            onClick={() => navigate(`/reader/${record.id}`)}
          >
            阅读
          </Button>
          <Button
            type="text"
            size="small"
            icon={<PlayCircleOutlined />}
            style={{ color: '#2dce89' }}
            disabled={record.status !== 'ready'}
            onClick={() => navigate(`/study/${record.id}`)}
          >
            播放
          </Button>
          <Button
            type="text"
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record)}
          />
        </Space>
      ),
    },
  ];

  return (
    <div className="fade-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>
          文档库
        </Title>
        <Text type="secondary" style={{ fontSize: 15 }}>
          全部文档列表管理
        </Text>
      </div>

      <Card style={{ borderRadius: 12 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 20,
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <Input.Search
            placeholder="搜索文档标题..."
            allowClear
            onSearch={handleSearch}
            style={{ maxWidth: 360 }}
            prefix={<SearchOutlined style={{ color: '#b2bec3' }} />}
          />

          <Space>
            <Select
              value={sortBy}
              onChange={(v) => {
                setSortBy(v);
                setPage(1);
              }}
              style={{ width: 130 }}
              options={[
                { value: 'created_at', label: '创建时间' },
                { value: 'title', label: '标题' },
                { value: 'file_size', label: '文件大小' },
              ]}
            />
            <Button
              icon={
                sortOrder === 'asc' ? (
                  <SortAscendingOutlined />
                ) : (
                  <SortDescendingOutlined />
                )
              }
              onClick={() => {
                setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
                setPage(1);
              }}
            />
          </Space>
        </div>

        <Table
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
        />
      </Card>
    </div>
  );
}
