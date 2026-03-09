import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Typography,
  Tabs,
  Button,
  Card,
  Row,
  Col,
  Empty,
  Upload,
  message,
  Spin,
  Tag,
  Progress,
  Dropdown,
  Input,
  Modal,
  Space,
  Tooltip,
  Form,
  Checkbox,
  Popconfirm,
  Badge,
  Select,
  Skeleton,
} from 'antd';
import {
  PlusOutlined,
  UploadOutlined,
  SearchOutlined,
  DeleteOutlined,
  PlayCircleOutlined,
  ShareAltOutlined,
  MoreOutlined,
  FileTextOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileMarkdownOutlined,
  EyeOutlined,
  GlobalOutlined,
  ReloadOutlined,
  LinkOutlined,
  BookOutlined,
  FolderOutlined,
  FolderAddOutlined,
  EditOutlined,
  SwapOutlined,
  CheckOutlined,
  CloseOutlined,
  ImportOutlined,
  InboxOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { docApi, groupApi, bookshelfApi } from '../../api/documents';
import { communityApi } from '../../api/community';
import { useAuth } from '../../store/AuthContext';

const { Title, Text, Paragraph } = Typography;

const statusMap = {
  importing: { color: 'blue', text: 'PDF 下载中' },
  pending: { color: 'gold', text: '等待处理' },
  pending_upload: { color: 'red', text: '下载失败' },
  processing: { color: 'processing', text: 'AI 处理中' },
  ready: { color: 'green', text: '已就绪' },
  error: { color: 'red', text: '处理失败' },
};

const progressSteps = [
  { max: 10, label: '准备中...' },
  { max: 25, label: '提取文本...' },
  { max: 45, label: '生成摘要...' },
  { max: 65, label: '提取知识点...' },
  { max: 85, label: '生成PPT大纲...' },
  { max: 100, label: '生成讲解...' },
];

function getProgressLabel(progress) {
  for (const step of progressSteps) {
    if (progress <= step.max) return step.label;
  }
  return '处理中...';
}

const fileTypeConfig = {
  pdf: { icon: FilePdfOutlined, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  docx: { icon: FileWordOutlined, gradient: 'linear-gradient(135deg, #2196F3 0%, #21CBF3 100%)' },
  txt: { icon: FileTextOutlined, gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  md: { icon: FileMarkdownOutlined, gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
};

function DocCard({ doc, onRefresh, selectable, selected, onSelect, groups, onMoveToGroup }) {
  const navigate = useNavigate();
  const st = statusMap[doc.status] || { color: 'default', text: doc.status };
  const ftConf = fileTypeConfig[doc.file_type] || fileTypeConfig.txt;
  const IconComp = ftConf.icon;

  const groupMenuItems = (groups || []).map((g) => ({
    key: `group_${g.id}`,
    label: g.name,
  }));

  const menuItems = [
    { key: 'read', icon: <EyeOutlined />, label: '阅读文档' },
    { key: 'play', icon: <PlayCircleOutlined />, label: '讲解播放', disabled: doc.status !== 'ready' },
    { key: 'publish', icon: <GlobalOutlined />, label: '发布到社区', disabled: doc.status !== 'ready' },
    { key: 'share', icon: <ShareAltOutlined />, label: '分享到社区', disabled: doc.status !== 'ready' },
    ...(groupMenuItems.length > 0
      ? [
          { type: 'divider' },
          {
            key: 'moveToGroup',
            icon: <SwapOutlined />,
            label: '移动到分组',
            children: [
              { key: 'group_none', label: '取消分组' },
              ...groupMenuItems,
            ],
          },
        ]
      : []),
    { type: 'divider' },
    { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true },
  ];

  const onMenuClick = async ({ key }) => {
    if (key === 'read') {
      navigate(`/study/${doc.id}`);
    } else if (key === 'play') {
      navigate(`/study/${doc.id}`);
    } else if (key === 'publish') {
      Modal.confirm({
        title: '发布到社区',
        content: `确定要将「${doc.title}」发布到社区吗？发布后其他用户可以看到该讲解。`,
        okText: '发布',
        onOk: async () => {
          try {
            await docApi.publish(doc.id, { visibility: 'public' });
            message.success('已发布到社区');
            onRefresh?.();
          } catch (err) {
            message.error(err.message);
          }
        },
      });
    } else if (key === 'delete') {
      Modal.confirm({
        title: '确认删除',
        content: `确定要删除「${doc.title}」吗？此操作不可撤销。`,
        okText: '删除',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            await docApi.delete(doc.id);
            message.success('已删除');
            onRefresh?.();
          } catch (err) {
            message.error(err.message);
          }
        },
      });
    } else if (key.startsWith('group_')) {
      const groupId = key === 'group_none' ? null : key.replace('group_', '');
      onMoveToGroup?.(doc.id, groupId);
    }
  };

  const handleCardClick = () => {
    if (selectable) {
      onSelect?.(doc.id);
    } else if (doc.status === 'pending_upload') {
      message.info('请先上传 PDF 文件');
    } else {
      navigate(`/study/${doc.id}`);
    }
  };

  return (
    <Card
      className="card-hover"
      hoverable
      style={{
        borderRadius: 12,
        overflow: 'hidden',
        border: selected ? '2px solid #2dce89' : undefined,
      }}
      styles={{ body: { padding: 16 } }}
      onClick={handleCardClick}
    >
      {selectable && (
        <Checkbox
          checked={selected}
          style={{ position: 'absolute', top: 8, left: 8, zIndex: 2 }}
          onClick={(e) => e.stopPropagation()}
          onChange={() => onSelect?.(doc.id)}
        />
      )}

      <div
        style={{
          height: 140,
          background: ftConf.gradient,
          borderRadius: 8,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 12,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {/* AI 生成封面图（优先），fallback 到渐变色+图标 */}
        {doc.cover_url ? (
          <img
            src={(() => {
              const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
              return doc.cover_url.startsWith('http')
                ? doc.cover_url
                : `${BASE}${doc.cover_url}`;
            })()}
            alt={doc.title}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            onError={(e) => { e.target.style.display = 'none'; }}
          />
        ) : (
          <IconComp style={{ fontSize: 40, color: 'rgba(255,255,255,0.85)' }} />
        )}

        {/* Hover 播放蒙层 */}
        {doc.status === 'ready' && doc.lecture_slides?.length > 0 && (
          <div
            onClick={(e) => { e.stopPropagation(); navigate(`/study/${doc.id}`); }}
            style={{
              position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.35)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              opacity: 0, transition: 'opacity 0.25s', cursor: 'pointer',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = 1; }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = 0; }}
          >
            <PlayCircleOutlined style={{ fontSize: 42, color: '#fff' }} />
          </div>
        )}
        {doc.lecture_visibility === 'public' && (
          <Tag color="green" style={{ position: 'absolute', top: 8, right: 8, margin: 0, borderRadius: 4 }}>
            <GlobalOutlined /> 公开
          </Tag>
        )}
        <Tag
          style={{
            position: 'absolute', bottom: 8, left: 8, margin: 0, borderRadius: 4,
            fontSize: 11, textTransform: 'uppercase',
            background: 'rgba(0,0,0,0.3)', color: '#fff', border: 'none',
          }}
        >
          {doc.file_type}
        </Tag>
      </div>

      <Tooltip title={doc.title}>
        <Paragraph
          ellipsis={{ rows: 2 }}
          style={{ fontWeight: 600, fontSize: 14, marginBottom: 8, minHeight: 42 }}
        >
          {doc.title}
        </Paragraph>
      </Tooltip>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Tag color={st.color} style={{ borderRadius: 4 }}>
          {st.text}
        </Tag>
        <Dropdown menu={{ items: menuItems, onClick: onMenuClick }} trigger={['click']}>
          <Button
            type="text"
            size="small"
            icon={<MoreOutlined />}
            onClick={(e) => e.stopPropagation()}
          />
        </Dropdown>
      </div>

      {(doc.status === 'processing' || doc.status === 'pending' || doc.status === 'importing') && (
        <div style={{ marginTop: 8 }}>
          <Progress
            percent={Math.round(doc.progress || 0)}
            size="small"
            strokeColor={{ '0%': '#2dce89', '100%': '#52c41a' }}
            format={(p) => (doc.status === 'pending' ? '排队中' : doc.status === 'importing' ? 'PDF下载中...' : `${p}%`)}
          />
          {doc.status === 'processing' && (
            <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 2 }}>
              {doc.processing_step || getProgressLabel(doc.progress || 0)}
            </Text>
          )}
        </div>
      )}

      {(doc.status === 'pending_upload' || (doc.status === 'error' && doc.source_type === 'book_search')) && (
        <div style={{ marginTop: 8 }}>
          {doc.source_url?.includes('/md5/') && (
            <Button
              type="primary"
              size="small"
              icon={<ReloadOutlined />}
              block
              style={{ marginBottom: 6 }}
              onClick={(e) => {
                e.stopPropagation();
                docApi.retryDownload(doc.id).then(() => {
                  message.success('正在重新下载 PDF，请稍候...');
                  onRefresh?.();
                }).catch((err) => {
                  message.error(err.message || '重试失败');
                });
              }}
            >
              重新自动下载
            </Button>
          )}
          <Upload
            accept=".pdf"
            showUploadList={false}
            beforeUpload={(file) => {
              docApi.uploadPdf(doc.id, file).then(() => {
                message.success('PDF 已上传，开始处理');
                onRefresh?.();
              }).catch((err) => {
                message.error(err.response?.data?.detail || '上传失败');
              });
              return false;
            }}
          >
            <Button
              type="dashed"
              size="small"
              icon={<UploadOutlined />}
              block
              style={{ borderColor: '#faad14', color: '#faad14' }}
              onClick={(e) => e.stopPropagation()}
            >
              手动上传 PDF
            </Button>
          </Upload>
        </div>
      )}

      {doc.status === 'ready' && doc.summary && (
        <Paragraph
          ellipsis={{ rows: 2 }}
          type="secondary"
          style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}
        >
          {doc.summary}
        </Paragraph>
      )}
    </Card>
  );
}

function AddCard({ onClick }) {
  return (
    <Card
      hoverable
      style={{
        borderRadius: 12,
        border: '2px dashed #d9d9d9',
        height: '100%',
        minHeight: 280,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#fafafa',
        cursor: 'pointer',
        transition: 'border-color 0.2s',
      }}
      styles={{ body: { textAlign: 'center' } }}
      onClick={onClick}
    >
      <div>
        <PlusOutlined style={{ fontSize: 32, color: '#bfbfbf', marginBottom: 12 }} />
        <br />
        <Text type="secondary">添加文档到书架</Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12 }}>
          支持上传、URL导入、文库搜索、书籍搜索
        </Text>
      </div>
    </Card>
  );
}

function GroupCard({ group, docs, onRefresh, onEdit, onDelete, allGroups, onMoveToGroup }) {
  const [expanded, setExpanded] = useState(false);
  const groupDocs = docs.filter((d) => d.group_id === group.id);

  return (
    <Card
      className="card-hover"
      hoverable
      style={{ borderRadius: 12, overflow: 'hidden' }}
      styles={{ body: { padding: 16 } }}
    >
      <div
        onClick={() => setExpanded(!expanded)}
        style={{ cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Space>
            <FolderOutlined style={{ fontSize: 24, color: '#2dce89' }} />
            <div>
              <Text strong style={{ fontSize: 16 }}>{group.name}</Text>
              <br />
              <Text type="secondary" style={{ fontSize: 12 }}>{groupDocs.length} 篇文档</Text>
            </div>
          </Space>
          <Space>
            <Tooltip title="重命名">
              <Button
                type="text"
                size="small"
                icon={<EditOutlined />}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit(group);
                }}
              />
            </Tooltip>
            <Popconfirm
              title="确认删除分组"
              description="删除分组不会删除其中的文档，文档将移至未分组。"
              onConfirm={() => onDelete(group.id)}
              okText="删除"
              cancelText="取消"
            >
              <Button
                type="text"
                size="small"
                danger
                icon={<DeleteOutlined />}
                onClick={(e) => e.stopPropagation()}
              />
            </Popconfirm>
          </Space>
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: 16 }}>
          {groupDocs.length === 0 ? (
            <Empty description="分组中暂无文档" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <Row gutter={[16, 16]}>
              {groupDocs.map((doc) => (
                <Col key={doc.id} xs={24} sm={12} md={8}>
                  <DocCard
                    doc={doc}
                    onRefresh={onRefresh}
                    groups={allGroups}
                    onMoveToGroup={onMoveToGroup}
                  />
                </Col>
              ))}
            </Row>
          )}
        </div>
      )}
    </Card>
  );
}

function AddDocModal({ open, onClose, onUploadDone }) {
  const [mode, setMode] = useState(null); // null | 'upload' | 'url' | 'library' | 'book'
  const [urlForm] = Form.useForm();
  const [bookQuery, setBookQuery] = useState('');
  const [bookResults, setBookResults] = useState([]);
  const [bookSearching, setBookSearching] = useState(false);
  const [importingBooks, setImportingBooks] = useState(new Set());
  const [uploading, setUploading] = useState(false);
  const [urlSubmitting, setUrlSubmitting] = useState(false);

  const resetState = () => {
    setMode(null);
    setBookQuery('');
    setBookResults([]);
    setBookSearching(false);
    setImportingBooks(new Set());
    setUploading(false);
    setUrlSubmitting(false);
    urlForm.resetFields();
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

  const handleUpload = async (file) => {
    setUploading(true);
    try {
      await docApi.upload(file);
      message.success('上传成功，AI 正在处理中...');
      onUploadDone?.();
      handleClose();
    } catch (err) {
      message.error(err.message);
    } finally {
      setUploading(false);
    }
    return false;
  };

  const handleUrlSubmit = async () => {
    try {
      const values = await urlForm.validateFields();
      setUrlSubmitting(true);
      await docApi.importUrl({ url: values.url, title: values.title || undefined });
      message.success('URL 导入成功，AI 正在处理中...');
      onUploadDone?.();
      handleClose();
    } catch (err) {
      if (err.errorFields) return;
      message.error(err.message);
    } finally {
      setUrlSubmitting(false);
    }
  };

  const [searchError, setSearchError] = useState('');

  const handleBookSearch = async () => {
    if (!bookQuery.trim()) return;
    setBookSearching(true);
    setSearchError('');
    try {
      const res = await docApi.bookSearch({ query: bookQuery.trim() });
      const data = res.data;
      const results = data?.results || data?.items || [];
      setBookResults(results);
      if (results.length === 0 && data?.search_url) {
        setSearchError(data.error || '');
      }
    } catch (err) {
      message.error(err.message);
    } finally {
      setBookSearching(false);
    }
  };

  const handleBookImport = async (book) => {
    const bookKey = book.md5 || book.isbn || book.id;
    setImportingBooks((prev) => new Set([...prev, bookKey]));
    try {
      if (book.isbn) {
        try {
          const check = await docApi.checkIsbn(book.isbn);
          if (check.data?.exists) {
            message.warning('该书已在书架中，无需重复导入');
            return;
          }
        } catch { /* ignore */ }
      }

      await docApi.bookImport({
        title: book.title,
        author: book.author,
        isbn: book.isbn,
        md5: book.md5 || undefined,
        publisher: book.publisher,
        publish_year: book.publish_year,
        language: book.language,
        file_size: book.file_size,
        cover_url: book.cover_url || null,
        source: book.source || 'annas_archive',
      });
      if (book.can_auto_download) {
        message.success(`《${book.title}》正在自动下载并导入，请稍候...`);
      } else if (book.md5) {
        message.info(`《${book.title}》已添加到书架，请在书架中手动上传 PDF 文件`);
      } else {
        message.success(`《${book.title}》已添加到书架`);
      }
      onUploadDone?.();
      handleClose();
    } catch (err) {
      message.error(err.response?.data?.detail || err.message);
    } finally {
      setImportingBooks((prev) => {
        const next = new Set(prev);
        next.delete(bookKey);
        return next;
      });
    }
  };

  const optionCardStyle = {
    flex: 1,
    minWidth: 120,
    cursor: 'pointer',
    textAlign: 'center',
    borderRadius: 12,
    padding: '24px 16px',
    transition: 'all 0.2s',
    border: '1px solid #f0f0f0',
  };

  const renderModeSelection = () => (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <Card
        hoverable
        style={optionCardStyle}
        styles={{ body: { padding: '24px 16px' } }}
        onClick={() => setMode('upload')}
      >
        <UploadOutlined style={{ fontSize: 32, color: '#2dce89', marginBottom: 8 }} />
        <br />
        <Text strong>本地上传</Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12 }}>PDF、Word、TXT、MD</Text>
      </Card>
      <Card
        hoverable
        style={optionCardStyle}
        styles={{ body: { padding: '24px 16px' } }}
        onClick={() => setMode('url')}
      >
        <LinkOutlined style={{ fontSize: 32, color: '#1890ff', marginBottom: 8 }} />
        <br />
        <Text strong>URL 导入</Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12 }}>从网页链接导入</Text>
      </Card>
      <Card
        hoverable
        style={optionCardStyle}
        styles={{ body: { padding: '24px 16px' } }}
        onClick={() => setMode('library')}
      >
        <SearchOutlined style={{ fontSize: 32, color: '#fa8c16', marginBottom: 8 }} />
        <br />
        <Text strong>文库搜索</Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12 }}>搜索在线文库</Text>
      </Card>
      <Card
        hoverable
        style={optionCardStyle}
        styles={{ body: { padding: '24px 16px' } }}
        onClick={() => setMode('book')}
      >
        <BookOutlined style={{ fontSize: 32, color: '#722ed1', marginBottom: 8 }} />
        <br />
        <Text strong>书籍搜索</Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12 }}>全球开放书库搜索 PDF</Text>
      </Card>
    </div>
  );

  const renderUpload = () => (
    <div style={{ textAlign: 'center', padding: '20px 0' }}>
      <Upload.Dragger
        beforeUpload={handleUpload}
        showUploadList={false}
        accept=".pdf,.docx,.txt,.md"
        disabled={uploading}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined style={{ color: '#2dce89', fontSize: 48 }} />
        </p>
        <p className="ant-upload-text">点击或拖拽文件到此区域上传</p>
        <p className="ant-upload-hint">支持 PDF、Word、TXT、Markdown 格式</p>
      </Upload.Dragger>
      {uploading && <Spin style={{ marginTop: 16 }} tip="上传中..." />}
    </div>
  );

  const renderUrlImport = () => (
    <Form form={urlForm} layout="vertical" style={{ marginTop: 8 }}>
      <Form.Item
        name="url"
        label="网页链接"
        rules={[
          { required: true, message: '请输入 URL' },
          { type: 'url', message: '请输入有效的 URL' },
        ]}
      >
        <Input placeholder="https://example.com/article" prefix={<LinkOutlined />} />
      </Form.Item>
      <Form.Item name="title" label="标题（可选）">
        <Input placeholder="自定义文档标题，留空则自动识别" />
      </Form.Item>
      <div style={{ textAlign: 'right' }}>
        <Space>
          <Button onClick={() => setMode(null)}>返回</Button>
          <Button type="primary" onClick={handleUrlSubmit} loading={urlSubmitting}>
            导入
          </Button>
        </Space>
      </div>
    </Form>
  );

  const [libraryQuery, setLibraryQuery] = useState('');
  const [libraryResults, setLibraryResults] = useState([]);
  const [librarySearching, setLibrarySearching] = useState(false);

  const handleLibrarySearch = async () => {
    if (!libraryQuery.trim()) return;
    setLibrarySearching(true);
    try {
      const res = await communityApi.listLectures({ search: libraryQuery.trim(), page: 1, page_size: 20 });
      setLibraryResults(res.data?.items || []);
    } catch (err) {
      message.error(err.message);
    } finally {
      setLibrarySearching(false);
    }
  };

  const handleAddToShelf = async (doc) => {
    try {
      await bookshelfApi.add(doc.id);
      message.success(`已添加「${doc.title}」到书架`);
    } catch (err) {
      message.error(err.message);
    }
  };

  const renderLibrarySearch = () => (
    <div style={{ marginTop: 8 }}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
        搜索社区中已公开的文档资源，一键添加到个人书架
      </Text>
      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
        <Input
          placeholder="搜索文库中的文档..."
          value={libraryQuery}
          onChange={(e) => setLibraryQuery(e.target.value)}
          onPressEnter={handleLibrarySearch}
          prefix={<SearchOutlined />}
        />
        <Button type="primary" onClick={handleLibrarySearch} loading={librarySearching}>
          搜索
        </Button>
      </Space.Compact>

      <Spin spinning={librarySearching}>
        {libraryResults.length > 0 ? (
          <div style={{ maxHeight: 360, overflowY: 'auto' }}>
            {libraryResults.map((doc) => (
              <Card
                key={doc.id}
                size="small"
                style={{ marginBottom: 8, borderRadius: 8 }}
                styles={{ body: { padding: 12 } }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ flex: 1, marginRight: 12 }}>
                    <Text strong>{doc.title}</Text>
                    {doc.owner?.username && (
                      <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                        by {doc.owner.username}
                      </Text>
                    )}
                    {doc.summary && (
                      <Paragraph
                        ellipsis={{ rows: 1 }}
                        type="secondary"
                        style={{ fontSize: 12, marginBottom: 0, marginTop: 4 }}
                      >
                        {doc.summary}
                      </Paragraph>
                    )}
                  </div>
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => handleAddToShelf(doc)}
                  >
                    添加
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          !librarySearching && (
            <Empty
              description={libraryQuery ? '未找到相关文档' : '输入关键词搜索文库'}
              image={Empty.PRESENTED_IMAGE_SIMPLE}
            />
          )
        )}
      </Spin>

      <div style={{ textAlign: 'right', marginTop: 16 }}>
        <Button onClick={() => setMode(null)}>返回</Button>
      </div>
    </div>
  );

  const renderBookSearch = () => (
    <div style={{ marginTop: 8 }}>
      <Text type="secondary" style={{ display: 'block', marginBottom: 10, fontSize: 12 }}>
        搜索全球开放书库，PDF 格式将自动下载并进行 AI 分析
      </Text>
      <Space.Compact style={{ width: '100%', marginBottom: 16 }}>
        <Input
          placeholder="输入书名、作者或 ISBN 搜索（支持中英文）"
          value={bookQuery}
          onChange={(e) => setBookQuery(e.target.value)}
          onPressEnter={handleBookSearch}
          prefix={<SearchOutlined />}
        />
        <Button type="primary" onClick={handleBookSearch} loading={bookSearching}>
          搜索
        </Button>
      </Space.Compact>

      <Spin spinning={bookSearching}>
        {bookResults.length > 0 ? (
          <div style={{ maxHeight: 420, overflowY: 'auto' }}>
            {bookResults.map((book, idx) => {
              const bookKey = book.md5 || book.isbn || idx;
              const isPdf = book.file_type === 'pdf';
              const canAutoDownload = book.can_auto_download === true;
              const isZlib = book.book_source === 'zlib';

              // 边框颜色：绿=Libgen自动下载，蓝=ZLib账号下载，灰=仅导入
              const borderColor = canAutoDownload ? '#52c41a' : isZlib ? '#1677ff' : '#e8e8e8';

              const importTip = canAutoDownload
                ? '✅ Libgen 来源，点击自动下载 PDF'
                : isZlib
                  ? '🔑 Z-Library 来源，将尝试账号自动下载'
                  : `格式为 ${book.file_type || '未知'}，仅支持 PDF`;

              const tagColor = canAutoDownload ? 'success' : isZlib ? 'processing' : 'default';
              const tagLabel = canAutoDownload ? '自动下载' : isZlib ? 'ZLib下载' : 'PDF';

              const coverGradient = canAutoDownload
                ? 'linear-gradient(135deg, #52c41a, #237804)'
                : isZlib
                  ? 'linear-gradient(135deg, #1677ff, #0050b3)'
                  : 'linear-gradient(135deg, #667eea, #764ba2)';

              return (
                <Card
                  key={bookKey}
                  size="small"
                  style={{
                    marginBottom: 8,
                    borderRadius: 8,
                    border: `1px solid ${isPdf ? borderColor : '#f0f0f0'}`,
                    opacity: isPdf ? 1 : 0.5,
                  }}
                  styles={{ body: { padding: 12 } }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                    {book.cover_url ? (
                      <img
                        src={book.cover_url}
                        alt={book.title}
                        style={{ width: 40, height: 56, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    ) : (
                      <div style={{
                        width: 40, height: 56, borderRadius: 4, flexShrink: 0,
                        background: isPdf ? coverGradient : 'linear-gradient(135deg, #ccc, #999)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        <BookOutlined style={{ color: '#fff', fontSize: 18 }} />
                      </div>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Text strong style={{ display: 'block', marginBottom: 2 }}>{book.title}</Text>
                      {book.author && (
                        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>
                          {book.author}
                        </Text>
                      )}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {isPdf && (
                          <Tag color={tagColor} style={{ fontSize: 10, margin: 0, padding: '0 4px' }}>{tagLabel}</Tag>
                        )}
                        <Tag color={isPdf ? 'green' : 'default'} style={{ fontSize: 10, margin: 0, padding: '0 4px', textTransform: 'uppercase' }}>
                          {book.file_type || 'unknown'}
                        </Tag>
                        {book.file_size && <Tag style={{ fontSize: 10, margin: 0, padding: '0 4px' }}>{book.file_size}</Tag>}
                        {book.language && <Tag color="blue" style={{ fontSize: 10, margin: 0, padding: '0 4px' }}>{book.language}</Tag>}
                        {book.publish_year && <Tag style={{ fontSize: 10, margin: 0, padding: '0 4px' }}>{book.publish_year}</Tag>}
                        {book.publisher && <Tag style={{ fontSize: 10, margin: 0, padding: '0 4px' }}>{book.publisher.length > 20 ? book.publisher.slice(0,20) + '…' : book.publisher}</Tag>}
                      </div>
                    </div>
                    <Tooltip title={importTip}>
                      <Button
                        type={(canAutoDownload || isZlib) ? 'primary' : 'default'}
                        size="small"
                        icon={<ImportOutlined />}
                        loading={importingBooks.has(bookKey)}
                        disabled={!isPdf}
                        onClick={() => handleBookImport(book)}
                        style={isZlib && !canAutoDownload ? { background: '#1677ff', borderColor: '#1677ff' } : {}}
                      >
                        {canAutoDownload ? '导入' : isZlib ? '导入' : isPdf ? '导入' : book.file_type?.toUpperCase()}
                      </Button>
                    </Tooltip>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          !bookSearching && (
            <div>
              {searchError ? (
                <div style={{ textAlign: 'center', padding: '24px 0' }}>
                  <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                    {searchError}
                  </Text>
                  <Button
                    type="link"
                    onClick={() => window.open(`https://annas-archive.gl/search?q=${encodeURIComponent(bookQuery)}&ext=pdf`, '_blank')}
                  >
                    在浏览器中打开搜索
                  </Button>
                </div>
              ) : (
                <Empty
                  description={bookQuery ? '未找到相关 PDF 书籍，换个关键词试试' : '输入书名、作者或 ISBN 开始搜索'}
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                />
              )}
            </div>
          )
        )}
      </Spin>

      <div style={{ textAlign: 'right', marginTop: 16 }}>
        <Button onClick={() => setMode(null)}>返回</Button>
      </div>
    </div>
  );

  const titleMap = {
    null: '添加文档',
    upload: '本地上传',
    url: 'URL 导入',
    library: '文库搜索',
    book: '书籍搜索',
  };

  return (
    <Modal
      title={titleMap[mode] || '添加文档'}
      open={open}
      onCancel={handleClose}
      footer={null}
      width={mode ? 520 : 600}
      destroyOnClose
    >
      {mode === null && renderModeSelection()}
      {mode === 'upload' && renderUpload()}
      {mode === 'url' && renderUrlImport()}
      {mode === 'library' && renderLibrarySearch()}
      {mode === 'book' && renderBookSearch()}
    </Modal>
  );
}

function MoveToGroupModal({ open, onClose, groups, selectedDocIds, onDone }) {
  const [targetGroupId, setTargetGroupId] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleOk = async () => {
    setLoading(true);
    try {
      await bookshelfApi.batchOp({
        doc_ids: selectedDocIds,
        action: 'move_group',
        group_id: targetGroupId,
      });
      message.success('移动成功');
      onDone?.();
      onClose();
    } catch (err) {
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="移动到分组"
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      okText="移动"
      destroyOnClose
    >
      <div style={{ marginTop: 16 }}>
        <Text style={{ display: 'block', marginBottom: 8 }}>
          将 {selectedDocIds.length} 篇文档移动到：
        </Text>
        <Select
          style={{ width: '100%' }}
          placeholder="选择目标分组"
          value={targetGroupId}
          onChange={setTargetGroupId}
          allowClear
          options={[
            { value: null, label: '取消分组（不在任何分组中）' },
            ...(groups || []).map((g) => ({ value: g.id, label: g.name })),
          ]}
        />
      </div>
    </Modal>
  );
}

function CreateGroupModal({ open, onClose, editingGroup, onDone }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open && editingGroup) {
      form.setFieldsValue({ name: editingGroup.name });
    } else if (open) {
      form.resetFields();
    }
  }, [open, editingGroup, form]);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      if (editingGroup) {
        await groupApi.update(editingGroup.id, { name: values.name });
        message.success('分组已更新');
      } else {
        await groupApi.create(values.name);
        message.success('分组已创建');
      }
      onDone?.();
      onClose();
    } catch (err) {
      if (err.errorFields) return;
      message.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title={editingGroup ? '重命名分组' : '创建分组'}
      open={open}
      onOk={handleOk}
      onCancel={onClose}
      confirmLoading={loading}
      okText={editingGroup ? '保存' : '创建'}
      destroyOnClose
    >
      <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
        <Form.Item
          name="name"
          label="分组名称"
          rules={[{ required: true, message: '请输入分组名称' }]}
        >
          <Input placeholder="例如：学习资料、工作文档" maxLength={30} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function BookshelfPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('default');
  const [docs, setDocs] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const pollingRef = useRef(null);

  const [addDocModalOpen, setAddDocModalOpen] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  const [moveGroupModalOpen, setMoveGroupModalOpen] = useState(false);
  const [createGroupModalOpen, setCreateGroupModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState(null);

  const coverTriggeredRef = useRef(new Set());

  const fetchDocs = useCallback(async (silent = false) => {
    if (!user) return;
    if (!silent) setLoading(true);
    try {
      const params = { page: 1, page_size: 100 };
      if (searchText) params.search = searchText;
      const res = await docApi.list(params);
      const items = res.data.items;
      setDocs(items);
      items
        .filter((d) => d.status === 'ready' && !d.cover_url && !coverTriggeredRef.current.has(d.id))
        .slice(0, 5)
        .forEach((d) => {
          coverTriggeredRef.current.add(d.id);
          docApi.generateCover(d.id).catch(() => { /* silent */ });
        });
      return items;
    } catch (err) {
      if (!silent) message.error(err.message);
      return [];
    } finally {
      if (!silent) setLoading(false);
    }
  }, [user, searchText, activeTab]);

  const fetchGroups = useCallback(async () => {
    if (!user) return;
    try {
      const res = await groupApi.list();
      setGroups(res.data?.items || res.data || []);
    } catch {
      // groups may not be available yet
    }
  }, [user]);

  useEffect(() => {
    fetchDocs();
    fetchGroups();
  }, [fetchDocs, fetchGroups]);

  const fetchDocsRef = useRef(fetchDocs);
  fetchDocsRef.current = fetchDocs;

  const startPolling = useCallback(() => {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
      const items = await fetchDocsRef.current(true);
      const still = items?.some(
        (d) => d.status === 'pending' || d.status === 'processing' || d.status === 'importing'
      );
      if (!still && pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }, 5000);
  }, []);

  const prevHasProcessingRef = useRef(false);
  useEffect(() => {
    const hasProcessing = docs.some(
      (d) => d.status === 'pending' || d.status === 'processing' || d.status === 'importing'
    );
    if (hasProcessing && !prevHasProcessingRef.current) {
      startPolling();
    } else if (!hasProcessing && pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }
    prevHasProcessingRef.current = hasProcessing;
  }, [docs, startPolling]);

  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, []);

  const handleMoveToGroup = async (docId, groupId) => {
    try {
      await bookshelfApi.moveDoc(docId, groupId);
      message.success(groupId ? '已移动到分组' : '已取消分组');
      fetchDocs();
    } catch (err) {
      message.error(err.message);
    }
  };

  const handleSelectDoc = (docId) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const handleBatchDelete = () => {
    if (selectedDocIds.length === 0) {
      message.warning('请先选择文档');
      return;
    }
    Modal.confirm({
      title: '批量删除',
      content: `确定要删除选中的 ${selectedDocIds.length} 篇文档吗？此操作不可撤销。`,
      okText: '删除',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await bookshelfApi.batchOp({ doc_ids: selectedDocIds, action: 'delete' });
          message.success(`已删除 ${selectedDocIds.length} 篇文档`);
          setSelectedDocIds([]);
          setBatchMode(false);
          fetchDocs();
        } catch (err) {
          message.error(err.message);
        }
      },
    });
  };

  const handleBatchMove = () => {
    if (selectedDocIds.length === 0) {
      message.warning('请先选择文档');
      return;
    }
    setMoveGroupModalOpen(true);
  };

  const exitBatchMode = () => {
    setBatchMode(false);
    setSelectedDocIds([]);
  };

  const handleDeleteGroup = async (groupId) => {
    try {
      await groupApi.delete(groupId);
      message.success('分组已删除');
      fetchGroups();
      fetchDocs();
    } catch (err) {
      message.error(err.message);
    }
  };

  const handleEditGroup = (group) => {
    setEditingGroup(group);
    setCreateGroupModalOpen(true);
  };

  const handleRefreshAll = () => {
    fetchDocs();
    fetchGroups();
  };

  if (!user) {
    return (
      <div style={{ textAlign: 'center', paddingTop: 120 }}>
        <Title level={2}>AI 藏经阁</Title>
        <Paragraph type="secondary" style={{ fontSize: 16, marginBottom: 32 }}>
          重构你的学习体验
        </Paragraph>
        <Button type="primary" size="large" onClick={() => navigate('/login')}>
          登录后开始使用
        </Button>
      </div>
    );
  }

  const tabItems = [
    { key: 'default', label: '默认' },
    { key: 'studying', label: '学习中' },
    { key: 'completed', label: '学习完成' },
  ];

  const listenedPagesStore = (() => {
    try { return JSON.parse(localStorage.getItem('listenedPages') || '{}'); } catch { return {}; }
  })();
  const completedDocIds = (() => {
    try { return new Set(JSON.parse(localStorage.getItem('completedDocs') || '[]')); } catch { return new Set(); }
  })();

  const filteredDocs = docs.filter((doc) => {
    const docId = String(doc.id);
    const hasListened = (listenedPagesStore[docId]?.length || 0) > 0;
    const isCompleted = completedDocIds.has(docId);
    if (activeTab === 'studying') return hasListened && !isCompleted;
    if (activeTab === 'completed') return isCompleted;
    return true;
  });

  const ungroupedDocs = filteredDocs.filter((d) => !d.group_id);

  const renderSkeletonGrid = () => (
    <Row gutter={[20, 20]}>
      <Col xs={24} sm={12} md={8} lg={6}>
        <AddCard onClick={() => setAddDocModalOpen(true)} />
      </Col>
      {Array.from({ length: 7 }, (_, i) => (
        <Col key={i} xs={24} sm={12} md={8} lg={6}>
          <Card style={{ borderRadius: 12, overflow: 'hidden' }} styles={{ body: { padding: 16 } }}>
            <Skeleton.Image active style={{ width: '100%', height: 140, borderRadius: 8, marginBottom: 12, display: 'block' }} />
            <Skeleton active title={{ width: '80%' }} paragraph={{ rows: 2, width: ['60%', '40%'] }} />
          </Card>
        </Col>
      ))}
    </Row>
  );

  const renderDocGrid = (docList) => {
    if (loading) return renderSkeletonGrid();
    return (
      <Row gutter={[20, 20]}>
        <Col xs={24} sm={12} md={8} lg={6}>
          <AddCard onClick={() => setAddDocModalOpen(true)} />
        </Col>
        {docList.map((doc) => (
          <Col key={doc.id} xs={24} sm={12} md={8} lg={6}>
            <DocCard
              doc={doc}
              onRefresh={handleRefreshAll}
              selectable={batchMode}
              selected={selectedDocIds.includes(doc.id)}
              onSelect={handleSelectDoc}
              groups={groups}
              onMoveToGroup={handleMoveToGroup}
            />
          </Col>
        ))}
        {docList.length === 0 && (
          <Col xs={24} sm={12} md={16} lg={18}>
            <Empty description="暂无文档" style={{ padding: '40px 0' }} />
          </Col>
        )}
      </Row>
    );
  };

  const renderGroupView = () => (
    <div>
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text type="secondary">{groups.length} 个分组</Text>
        <Button
          type="primary"
          icon={<FolderAddOutlined />}
          onClick={() => {
            setEditingGroup(null);
            setCreateGroupModalOpen(true);
          }}
        >
          创建分组
        </Button>
      </div>

      {groups.length === 0 ? (
        <Empty
          description="还没有分组"
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          style={{ padding: '60px 0' }}
        >
          <Button
            type="primary"
            icon={<FolderAddOutlined />}
            onClick={() => {
              setEditingGroup(null);
              setCreateGroupModalOpen(true);
            }}
          >
            创建第一个分组
          </Button>
        </Empty>
      ) : (
        <Row gutter={[20, 20]}>
          {groups.map((group) => (
            <Col key={group.id} xs={24} md={12}>
              <GroupCard
                group={group}
                docs={docs}
                onRefresh={handleRefreshAll}
                onEdit={handleEditGroup}
                onDelete={handleDeleteGroup}
                allGroups={groups}
                onMoveToGroup={handleMoveToGroup}
              />
            </Col>
          ))}
        </Row>
      )}

      {ungroupedDocs.length > 0 && groups.length > 0 && (
        <div style={{ marginTop: 32 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
            未分组文档（{ungroupedDocs.length} 篇）
          </Text>
          <Row gutter={[20, 20]}>
            {ungroupedDocs.map((doc) => (
              <Col key={doc.id} xs={24} sm={12} md={8} lg={6}>
                <DocCard
                  doc={doc}
                  onRefresh={handleRefreshAll}
                  groups={groups}
                  onMoveToGroup={handleMoveToGroup}
                />
              </Col>
            ))}
          </Row>
        </div>
      )}
    </div>
  );

  return (
    <div className="fade-in" style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ marginBottom: 4 }}>
          我的书架
        </Title>
        <Text type="secondary">管理你的文档，开启 AI 讲解之旅</Text>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            setActiveTab(key);
            exitBatchMode();
          }}
          items={tabItems}
          style={{ marginBottom: 0 }}
        />
        <Space>
          {batchMode ? (
            <>
              <Badge count={selectedDocIds.length} overflowCount={99}>
                <Text strong>已选择</Text>
              </Badge>
              <Button
                icon={<SwapOutlined />}
                onClick={handleBatchMove}
                disabled={selectedDocIds.length === 0}
              >
                移动到分组
              </Button>
              <Button
                danger
                icon={<DeleteOutlined />}
                onClick={handleBatchDelete}
                disabled={selectedDocIds.length === 0}
              >
                批量删除
              </Button>
              <Button icon={<CloseOutlined />} onClick={exitBatchMode}>
                取消
              </Button>
            </>
          ) : (
            <>
              <Input
                placeholder="搜索文档..."
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                style={{ width: 200, borderRadius: 8 }}
                allowClear
              />
              <Tooltip title="刷新">
                <Button icon={<ReloadOutlined />} onClick={handleRefreshAll} />
              </Tooltip>
              <Tooltip title="批量操作">
                <Button icon={<CheckOutlined />} onClick={() => setBatchMode(true)}>
                  批量操作
                </Button>
              </Tooltip>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => setAddDocModalOpen(true)}
              >
                添加文档
              </Button>
            </>
          )}
        </Space>
      </div>

      {renderDocGrid(filteredDocs)}

      <AddDocModal
        open={addDocModalOpen}
        onClose={() => setAddDocModalOpen(false)}
        onUploadDone={handleRefreshAll}
      />

      <MoveToGroupModal
        open={moveGroupModalOpen}
        onClose={() => setMoveGroupModalOpen(false)}
        groups={groups}
        selectedDocIds={selectedDocIds}
        onDone={() => {
          setSelectedDocIds([]);
          setBatchMode(false);
          handleRefreshAll();
        }}
      />

      <CreateGroupModal
        open={createGroupModalOpen}
        onClose={() => {
          setCreateGroupModalOpen(false);
          setEditingGroup(null);
        }}
        editingGroup={editingGroup}
        onDone={handleRefreshAll}
      />
    </div>
  );
}
