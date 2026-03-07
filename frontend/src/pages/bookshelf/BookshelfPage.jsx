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
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { docApi } from '../../api/documents';
import { useAuth } from '../../store/AuthContext';

const { Title, Text, Paragraph } = Typography;

const statusMap = {
  importing: { color: 'blue', text: '导入中' },
  pending: { color: 'gold', text: '等待处理' },
  processing: { color: 'processing', text: 'AI 处理中' },
  ready: { color: 'green', text: '已就绪' },
  error: { color: 'red', text: '处理失败' },
};

const fileTypeConfig = {
  pdf: { icon: FilePdfOutlined, gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' },
  docx: { icon: FileWordOutlined, gradient: 'linear-gradient(135deg, #2196F3 0%, #21CBF3 100%)' },
  txt: { icon: FileTextOutlined, gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)' },
  md: { icon: FileMarkdownOutlined, gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)' },
};

function DocCard({ doc, onRefresh }) {
  const navigate = useNavigate();
  const st = statusMap[doc.status] || { color: 'default', text: doc.status };
  const ftConf = fileTypeConfig[doc.file_type] || fileTypeConfig.txt;
  const IconComp = ftConf.icon;

  const menuItems = [
    { key: 'read', icon: <EyeOutlined />, label: '阅读文档' },
    { key: 'play', icon: <PlayCircleOutlined />, label: '讲解播放', disabled: doc.status !== 'ready' },
    { key: 'share', icon: <ShareAltOutlined />, label: '分享到社区', disabled: doc.status !== 'ready' },
    { type: 'divider' },
    { key: 'delete', icon: <DeleteOutlined />, label: '删除', danger: true },
  ];

  const onMenuClick = async ({ key }) => {
    if (key === 'read') navigate(`/reader/${doc.id}`);
    else if (key === 'play') navigate(`/play/${doc.id}`);
    else if (key === 'delete') {
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
    }
  };

  return (
    <Card
      className="card-hover"
      hoverable
      style={{ borderRadius: 12, overflow: 'hidden' }}
      styles={{ body: { padding: 16 } }}
      onClick={() => navigate(`/reader/${doc.id}`)}
    >
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
        }}
      >
        <IconComp style={{ fontSize: 40, color: 'rgba(255,255,255,0.85)' }} />
        {doc.lecture_visibility === 'public' && (
          <Tag
            color="green"
            style={{ position: 'absolute', top: 8, right: 8, margin: 0, borderRadius: 4 }}
          >
            <GlobalOutlined /> 公开
          </Tag>
        )}
        <Tag
          style={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            margin: 0,
            borderRadius: 4,
            fontSize: 11,
            textTransform: 'uppercase',
            background: 'rgba(0,0,0,0.3)',
            color: '#fff',
            border: 'none',
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

      {(doc.status === 'processing' || doc.status === 'pending') && (
        <Progress
          percent={Math.round(doc.progress)}
          size="small"
          style={{ marginTop: 8 }}
          strokeColor="#2dce89"
          format={(p) => (doc.status === 'pending' ? '排队中' : `${p}%`)}
        />
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

function AddCard() {
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
    >
      <div>
        <PlusOutlined style={{ fontSize: 32, color: '#bfbfbf', marginBottom: 12 }} />
        <br />
        <Text type="secondary">上传文档到书架</Text>
        <br />
        <Text type="secondary" style={{ fontSize: 12 }}>
          支持 PDF、Word、TXT、Markdown
        </Text>
      </div>
    </Card>
  );
}

export default function BookshelfPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('default');
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const pollingRef = useRef(null);

  const fetchDocs = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const params = { page: 1, page_size: 100 };
      if (searchText) params.search = searchText;
      if (activeTab === 'lecture') params.status = 'ready';
      const res = await docApi.list(params);
      setDocs(res.data.items);
      return res.data.items;
    } catch (err) {
      message.error(err.message);
      return [];
    } finally {
      setLoading(false);
    }
  }, [user, searchText, activeTab]);

  useEffect(() => {
    fetchDocs();
  }, [fetchDocs]);

  useEffect(() => {
    const hasProcessing = docs.some(
      (d) => d.status === 'pending' || d.status === 'processing' || d.status === 'importing'
    );
    if (hasProcessing && !pollingRef.current) {
      pollingRef.current = setInterval(async () => {
        const items = await fetchDocs();
        const still = items?.some(
          (d) => d.status === 'pending' || d.status === 'processing' || d.status === 'importing'
        );
        if (!still && pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
      }, 3000);
    }
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [docs, fetchDocs]);

  const handleUpload = async (file) => {
    try {
      await docApi.upload(file);
      message.success('上传成功，AI 正在处理中...');
      fetchDocs();
    } catch (err) {
      message.error(err.message);
    }
    return false;
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
    { key: 'default', label: '全部' },
    { key: 'lecture', label: '已就绪' },
    { key: 'document', label: '文档' },
    { key: 'group', label: '分组' },
  ];

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
          onChange={setActiveTab}
          items={tabItems}
          style={{ marginBottom: 0 }}
        />
        <Space>
          <Input
            placeholder="搜索文档..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 200, borderRadius: 8 }}
            allowClear
          />
          <Tooltip title="刷新">
            <Button icon={<ReloadOutlined />} onClick={fetchDocs} />
          </Tooltip>
          <Upload beforeUpload={handleUpload} showUploadList={false} accept=".pdf,.docx,.txt,.md">
            <Button type="primary" icon={<UploadOutlined />}>
              上传文档
            </Button>
          </Upload>
        </Space>
      </div>

      <Spin spinning={loading}>
        <Row gutter={[20, 20]}>
          <Col xs={24} sm={12} md={8} lg={6}>
            <Upload
              beforeUpload={handleUpload}
              showUploadList={false}
              accept=".pdf,.docx,.txt,.md"
            >
              <AddCard />
            </Upload>
          </Col>
          {docs.map((doc) => (
            <Col key={doc.id} xs={24} sm={12} md={8} lg={6}>
              <DocCard doc={doc} onRefresh={fetchDocs} />
            </Col>
          ))}
        </Row>
      </Spin>
    </div>
  );
}
