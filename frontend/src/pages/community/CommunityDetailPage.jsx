import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Typography,
  Card,
  Space,
  Tag,
  Button,
  Divider,
  Input,
  List,
  Avatar,
  message,
  Spin,
  Empty,
} from 'antd';
import {
  HeartOutlined,
  HeartFilled,
  StarOutlined,
  StarFilled,
  MessageOutlined,
  ArrowLeftOutlined,
  PlayCircleOutlined,
  EyeOutlined,
  UserOutlined,
  SendOutlined,
} from '@ant-design/icons';
import { communityApi } from '../../api/community';
import { useAuth } from '../../store/AuthContext';
import dayjs from 'dayjs';

const { Title, Text, Paragraph } = Typography;
const { TextArea } = Input;

function CommentItem({ comment, onReply, onDelete, currentUserId, docOwnerId }) {
  const canDelete = currentUserId === comment.author?.id || currentUserId === docOwnerId;

  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <Avatar icon={<UserOutlined />} src={comment.author?.avatar_url} />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <Text strong>{comment.author?.username || '匿名'}</Text>
              {comment.reply_to_user && (
                <Text type="secondary">回复 @{comment.reply_to_user.username}</Text>
              )}
            </Space>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {dayjs(comment.created_at).format('MM-DD HH:mm')}
            </Text>
          </div>
          <Paragraph style={{ margin: '4px 0 8px', color: comment.is_deleted ? '#999' : '#333' }}>
            {comment.content}
          </Paragraph>
          <Space>
            <Button type="text" size="small" onClick={() => onReply(comment)}>
              回复
            </Button>
            {canDelete && !comment.is_deleted && (
              <Button type="text" size="small" danger onClick={() => onDelete(comment.id)}>
                删除
              </Button>
            )}
          </Space>
          {comment.replies?.map((r) => (
            <div key={r.id} style={{ marginTop: 12, paddingLeft: 16, borderLeft: '2px solid #f0f0f0' }}>
              <CommentItem
                comment={r}
                onReply={onReply}
                onDelete={onDelete}
                currentUserId={currentUserId}
                docOwnerId={docOwnerId}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CommunityDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [doc, setDoc] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [commentText, setCommentText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const fetchDetail = useCallback(async () => {
    try {
      const res = await communityApi.getLecture(id);
      setDoc(res.data);
    } catch (err) {
      message.error(err.message);
    }
  }, [id]);

  const fetchComments = useCallback(async () => {
    try {
      const res = await communityApi.listComments(id, { page: 1, page_size: 50 });
      setComments(res.data.items);
    } catch {
      /* noop */
    }
  }, [id]);

  useEffect(() => {
    Promise.all([fetchDetail(), fetchComments()]).finally(() => setLoading(false));
  }, [fetchDetail, fetchComments]);

  const handleSubmitComment = async () => {
    if (!commentText.trim()) return;
    if (!user) {
      message.warning('请先登录');
      navigate('/login');
      return;
    }
    setSubmitting(true);
    try {
      await communityApi.createComment(id, {
        content: commentText.trim(),
        parent_id: replyTo?.id || null,
      });
      setCommentText('');
      setReplyTo(null);
      fetchComments();
      message.success('评论成功');
    } catch (err) {
      message.error(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    try {
      await communityApi.deleteComment(commentId);
      message.success('已删除');
      fetchComments();
    } catch (err) {
      message.error(err.message);
    }
  };

  if (loading) return <Spin style={{ display: 'block', margin: '120px auto' }} size="large" />;
  if (!doc) return <Empty description="讲解不存在" />;

  return (
    <div className="fade-in" style={{ maxWidth: 900, margin: '0 auto' }}>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/community')}
        style={{ marginBottom: 16 }}
      >
        返回社区
      </Button>

      <Card style={{ borderRadius: 12, marginBottom: 24 }}>
        <Title level={3}>{doc.title}</Title>
        <Space style={{ marginBottom: 16 }}>
          <Text type="secondary">
            <EyeOutlined /> {doc.play_count} 次播放
          </Text>
          <Text type="secondary">
            <HeartOutlined /> {doc.like_count}
          </Text>
          <Text type="secondary">
            <MessageOutlined /> {doc.comment_count}
          </Text>
        </Space>
        {doc.tags?.length > 0 && (
          <div style={{ marginBottom: 12 }}>
            {doc.tags.map((t) => (
              <Tag key={t} color="green" style={{ borderRadius: 4 }}>
                {t}
              </Tag>
            ))}
          </div>
        )}
        {doc.description && (
          <Paragraph type="secondary">{doc.description}</Paragraph>
        )}
        <Space>
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => navigate(`/play/${doc.id}`)}>
            播放讲解
          </Button>
          <Button icon={<HeartOutlined />} onClick={() => {
            if (!user) { navigate('/login'); return; }
            communityApi.like(id).then(() => { message.success('已点赞'); fetchDetail(); }).catch((e) => message.error(e.message));
          }}>
            点赞
          </Button>
          <Button icon={<StarOutlined />} onClick={() => {
            if (!user) { navigate('/login'); return; }
            communityApi.favorite(id).then(() => message.success('已收藏')).catch((e) => message.error(e.message));
          }}>
            收藏
          </Button>
        </Space>
      </Card>

      <Card title={`评论 (${comments.length})`} style={{ borderRadius: 12 }}>
        <div style={{ marginBottom: 24 }}>
          {replyTo && (
            <Tag closable onClose={() => setReplyTo(null)} style={{ marginBottom: 8 }}>
              回复 @{replyTo.author?.username}
            </Tag>
          )}
          <div style={{ display: 'flex', gap: 12 }}>
            <TextArea
              rows={2}
              placeholder={replyTo ? `回复 @${replyTo.author?.username}...` : '写下你的评论...'}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              maxLength={500}
              showCount
              style={{ borderRadius: 8 }}
            />
            <Button
              type="primary"
              icon={<SendOutlined />}
              loading={submitting}
              onClick={handleSubmitComment}
              style={{ height: 'auto' }}
            >
              发送
            </Button>
          </div>
        </div>

        <Divider />

        {comments.length === 0 ? (
          <Empty description="暂无评论，来说两句吧~" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          comments.map((c) => (
            <CommentItem
              key={c.id}
              comment={c}
              onReply={setReplyTo}
              onDelete={handleDeleteComment}
              currentUserId={user?.id}
              docOwnerId={doc.user_id}
            />
          ))
        )}
      </Card>
    </div>
  );
}
