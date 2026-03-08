import { Card, Skeleton } from 'antd';

export default function SkeletonCard({ count = 4 }) {
  return Array.from({ length: count }, (_, i) => (
    <Card
      key={i}
      style={{ borderRadius: 12, overflow: 'hidden' }}
      styles={{ body: { padding: 16 } }}
    >
      <Skeleton.Image active style={{ width: '100%', height: 140, borderRadius: 8, marginBottom: 12 }} />
      <Skeleton active title={{ width: '80%' }} paragraph={{ rows: 2, width: ['60%', '40%'] }} />
    </Card>
  ));
}
