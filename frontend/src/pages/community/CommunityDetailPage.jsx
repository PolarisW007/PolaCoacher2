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
import LoginModal from '../../components/LoginModal';
import dayjs from 'dayjs';

const { Text, Paragraph } = Typography;
const { TextArea } = Input;

function CommentItem({ comment, onReply, onDelete, currentUserId, docOwnerId }) {
  const canDelete = currentUserId === comment.author?.id || currentUserId === docOwnerId;

  return (
    <div style={{ marginBottom: 20, paddingBottom: 20, borderBottom: '1px solid rgba(226,234,243,0.6)' }}>
      <div style={{ display: 'flex', gap: 12 }}>
        <Avatar 
          icon={<UserOutlined />} 
          src={comment.author?.avatar_url} 
          style={{ border: '2px solid rgba(45,206,137,0.2)', backgroundColor: '#fff', color: '#aab4be' }} 
        />
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space>
              <Text strong style={{ color: '#1a2332' }}>{comment.author?.username || '匿名'}</Text>
              {comment.reply_to_user && (
                <Text style={{ color: '#8896a8', fontSize: 13 }}>回复 @{comment.reply_to_user.username}</Text>
              )}
            </Space>
            <Text style={{ fontSize: 12, color: '#aab4be' }}>
              {dayjs(comment.created_at).format('MM-DD HH:mm')}
            </Text>
          </div>
          <Paragraph style={{ margin: '8px 0 12px', color: comment.is_deleted ? '#aab4be' : '#334155', fontSize: 14 }}>
            {comment.content}
          </Paragraph>
          <Space size={16}>
            <span 
              onClick={() => {
                communityApi.likeComment(comment.id)
                  .then(() => message.success('已点赞'))
                  .catch((e) => message.error(e.message));
              }}
              style={{ cursor: 'pointer', color: '#8896a8', display: 'flex', alignItems: 'center', gap: 4, transition: 'color 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#f5365c'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#8896a8'}
            >
              <HeartOutlined /> {comment.like_count || 0}
            </span>
            <span 
              onClick={() => onReply(comment)}
              style={{ cursor: 'pointer', color: '#8896a8', display: 'flex', alignItems: 'center', gap: 4, transition: 'color 0.2s' }}
              onMouseEnter={(e) => e.currentTarget.style.color = '#11cdef'}
              onMouseLeave={(e) => e.currentTarget.style.color = '#8896a8'}
            >
              <MessageOutlined /> 回复
            </span>
            {canDelete && !comment.is_deleted && (
              <span 
                onClick={() => onDelete(comment.id)}
                style={{ cursor: 'pointer', color: '#aab4be', fontSize: 13, transition: 'color 0.2s' }}
                onMouseEnter={(e) => e.currentTarget.style.color = '#f5365c'}
                onMouseLeave={(e) => e.currentTarget.style.color = '#aab4be'}
              >
                删除
              </span>
            )}
          </Space>
          {comment.replies?.map((r) => (
            <div key={r.id} style={{ 
              marginTop: 16, 
              padding: '12px 16px', 
              background: 'rgba(240,244,248,0.4)', 
              borderRadius: 12,
              border: '1px solid rgba(226,234,243,0.5)'
            }}>
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
  const [loginModalOpen, setLoginModalOpen] = useState(false);

  const requireLogin = (action) => {
    if (!user) {
      setLoginModalOpen(true);
      return false;
    }
    return true;
  };

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
    if (!requireLogin()) return;
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
  if (!doc) return <Empty description={<Text style={{ color: '#8896a8' }}>讲解不存在</Text>} />;

  const cardStyle = {
    borderRadius: 14,
    border: '1px solid rgba(226,234,243,0.8)',
    boxShadow: '0 2px 16px rgba(0,0,0,0.05)',
    marginBottom: 24,
  };

  return (
    <div className="fade-in" style={{ maxWidth: 900, margin: '0 auto' }}>
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/community')}
        style={{ 
          marginBottom: 16,
          color: '#5a6a7e',
          display: 'flex',
          alignItems: 'center',
          padding: '4px 12px',
          borderRadius: 8,
          background: 'rgba(240,244,248,0.5)',
          border: '1px solid rgba(226,234,243,0.8)'
        }}
      >
        返回社区
      </Button>

      <Card style={cardStyle} styles={{ body: { padding: '24px 32px' } }}>
        <div style={{ fontSize: 24, fontWeight: 800, color: '#1a2332', letterSpacing: '-0.5px', marginBottom: 16 }}>
          {doc.title}
        </div>
        
        <Space style={{ marginBottom: 20 }} size={16}>
          <Text style={{ color: '#8896a8', display: 'flex', alignItems: 'center', gap: 4 }}>
            <EyeOutlined /> {doc.play_count} 次播放
          </Text>
          <Text style={{ color: '#8896a8', display: 'flex', alignItems: 'center', gap: 4 }}>
            <HeartOutlined /> {doc.like_count}
          </Text>
          <Text style={{ color: '#8896a8', display: 'flex', alignItems: 'center', gap: 4 }}>
            <MessageOutlined /> {doc.comment_count}
          </Text>
        </Space>
        
        {doc.tags?.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            {doc.tags.map((t) => (
              <Tag key={t} style={{ 
                borderRadius: 6, 
                border: 'none', 
                background: 'rgba(45,206,137,0.1)', 
                color: '#2dce89',
                padding: '2px 10px',
                fontSize: 13
              }}>
                {t}
              </Tag>
            ))}
          </div>
        )}
        
        {doc.description && (
          <Paragraph style={{ color: '#5a6a7e', fontSize: 15, lineHeight: 1.6, marginBottom: 24, background: 'rgba(240,244,248,0.3)', padding: 16, borderRadius: 10 }}>
            {doc.description}
          </Paragraph>
        )}
        
        <Space size={12}>
          <Button 
            type="primary" 
            icon={<PlayCircleOutlined />} 
            onClick={() => navigate(`/study/${doc.id}`)}
            style={{ 
              borderRadius: 10,
              background: 'linear-gradient(135deg, #2dce89, #11cdef)',
              border: 'none',
              boxShadow: '0 4px 14px rgba(45,206,137,0.35)',
              height: 40,
              paddingInline: 24,
              fontWeight: 600
            }}
          >
            播放讲解
          </Button>
          <Button 
            icon={<HeartOutlined />} 
            onClick={() => {
              if (!requireLogin()) return;
              communityApi.like(id).then(() => { message.success('已点赞'); fetchDetail(); }).catch((e) => message.error(e.message));
            }}
            style={{ borderRadius: 10, height: 40, color: '#5a6a7e', borderColor: '#e2eaf3' }}
          >
            点赞
          </Button>
          <Button 
            icon={<StarOutlined />} 
            onClick={() => {
              if (!requireLogin()) return;
              communityApi.favorite(id).then(() => message.success('已收藏')).catch((e) => message.error(e.message));
            }}
            style={{ borderRadius: 10, height: 40, color: '#5a6a7e', borderColor: '#e2eaf3' }}
          >
            收藏
          </Button>
        </Space>
      </Card>

      {doc.lecture_slides?.length > 0 && (
        <Card
          title={<span style={{ fontSize: 18, fontWeight: 700, color: '#1a2332' }}>讲解预览</span>}
          style={cardStyle}
          extra={<Tag style={{ borderRadius: 6, margin: 0, color: '#8896a8', background: 'rgba(240,244,248,0.8)', border: 'none' }}>共 {doc.lecture_slides.length} 页</Tag>}
          styles={{ header: { borderBottom: '1px solid rgba(226,234,243,0.6)', padding: '16px 24px' }, body: { padding: '24px' } }}
        >
          {doc.lecture_slides.slice(0, 3).map((slide, idx) => (
            <div key={idx} style={{ marginBottom: idx < 2 ? 24 : 0 }}>
              <Space style={{ marginBottom: 8 }}>
                <Tag style={{ borderRadius: 4, background: 'rgba(17,205,239,0.1)', color: '#11cdef', border: 'none', fontWeight: 600 }}>第 {slide.slide || idx + 1} 页</Tag>
                <Text strong style={{ fontSize: 15, color: '#1a2332' }}>{slide.title}</Text>
              </Space>
              
              <div style={{ marginLeft: 8, paddingLeft: 16, borderLeft: '2px solid rgba(45,206,137,0.3)' }}>
                {slide.points?.length > 0 && (
                  <ul style={{ margin: '8px 0', paddingLeft: 16 }}>
                    {slide.points.slice(0, 3).map((p, pi) => (
                      <li key={pi} style={{ fontSize: 14, lineHeight: 1.7, color: '#5a6a7e' }}>{p}</li>
                    ))}
                  </ul>
                )}
                {slide.lecture_text && (
                  <Paragraph ellipsis={{ rows: 2 }} style={{ fontSize: 14, marginTop: 8, marginBottom: 0, color: '#8896a8', fontStyle: 'italic' }}>
                    "{slide.lecture_text}"
                  </Paragraph>
                )}
              </div>
            </div>
          ))}
          
          {doc.lecture_slides.length > 3 && (
            <div style={{ 
              textAlign: 'center', 
              marginTop: 16, 
              paddingTop: 16,
              borderTop: '1px dashed rgba(226,234,243,0.8)'
            }}>
              <Button 
                type="link" 
                onClick={() => navigate(`/study/${doc.id}`)}
                style={{ color: '#2dce89', fontWeight: 500 }}
              >
                进入学习查看完整内容 →
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card 
        title={<span style={{ fontSize: 18, fontWeight: 700, color: '#1a2332' }}>全部评论 <span style={{ color: '#8896a8', fontSize: 14, fontWeight: 400 }}>({comments.length})</span></span>} 
        style={cardStyle}
        styles={{ header: { borderBottom: '1px solid rgba(226,234,243,0.6)', padding: '16px 24px' }, body: { padding: '24px' } }}
      >
        <div style={{ marginBottom: 32, padding: '20px', background: 'rgba(240,244,248,0.4)', borderRadius: 12, border: '1px solid rgba(226,234,243,0.6)' }}>
          {replyTo && (
            <Tag 
              closable 
              onClose={() => setReplyTo(null)} 
              style={{ marginBottom: 12, borderRadius: 6, padding: '4px 8px', background: '#fff', border: '1px solid #e2eaf3' }}
            >
              回复 <span style={{ color: '#11cdef', fontWeight: 500 }}>@{replyTo.author?.username}</span>
            </Tag>
          )}
          <div style={{ display: 'flex', gap: 12, flexDirection: 'column' }}>
            <TextArea
              rows={3}
              placeholder={replyTo ? `回复 @${replyTo.author?.username}...` : '写下你的评论或问题，与大家交流...'}
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              maxLength={500}
              showCount
              style={{ borderRadius: 10, borderColor: '#e2eaf3', fontSize: 14 }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={submitting}
                onClick={handleSubmitComment}
                style={{ 
                  borderRadius: 8,
                  background: 'linear-gradient(135deg, #2dce89, #11cdef)',
                  border: 'none',
                  boxShadow: '0 4px 14px rgba(45,206,137,0.3)',
                  paddingInline: 24,
                  fontWeight: 500
                }}
              >
                发布评论
              </Button>
            </div>
          </div>
        </div>

        {comments.length === 0 ? (
          <Empty 
            description={<Text style={{ color: '#8896a8' }}>暂无评论，来说两句吧~</Text>} 
            image={Empty.PRESENTED_IMAGE_SIMPLE} 
            style={{ margin: '40px 0' }}
          />
        ) : (
          <div>
            {comments.map((c) => (
              <CommentItem
                key={c.id}
                comment={c}
                onReply={setReplyTo}
                onDelete={handleDeleteComment}
                currentUserId={user?.id}
                docOwnerId={doc.user_id}
              />
            ))}
          </div>
        )}
      </Card>

      <LoginModal open={loginModalOpen} onClose={() => setLoginModalOpen(false)} />
    </div>
  );
}
