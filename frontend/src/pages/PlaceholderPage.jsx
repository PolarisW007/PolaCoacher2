import { Typography, Card } from 'antd';
import { ToolOutlined } from '@ant-design/icons';

const { Title, Text } = Typography;

export default function PlaceholderPage({ title = '功能开发中', description }) {
  return (
    <div style={{ maxWidth: 600, margin: '80px auto', textAlign: 'center' }}>
      <Card style={{ borderRadius: 16, padding: '40px 24px' }}>
        <ToolOutlined style={{ fontSize: 48, color: '#bfbfbf', marginBottom: 24 }} />
        <Title level={3}>{title}</Title>
        <Text type="secondary">{description || '该功能正在紧张开发中，敬请期待...'}</Text>
      </Card>
    </div>
  );
}
