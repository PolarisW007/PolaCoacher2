import client from './client';

export const communityApi = {
  listLectures: (params) => client.get('/community/lectures', { params }),
  getLecture: (id) => client.get(`/community/lectures/${id}`),
  like: (id) => client.post(`/community/lectures/${id}/like`),
  unlike: (id) => client.delete(`/community/lectures/${id}/like`),
  favorite: (id) => client.post(`/community/lectures/${id}/favorite`),
  unfavorite: (id) => client.delete(`/community/lectures/${id}/favorite`),
  listComments: (docId, params) =>
    client.get(`/community/lectures/${docId}/comments`, { params }),
  createComment: (docId, data) =>
    client.post(`/community/lectures/${docId}/comments`, data),
  deleteComment: (commentId) => client.delete(`/community/comments/${commentId}`),
  likeComment: (commentId) => client.post(`/community/comments/${commentId}/like`),
  unlikeComment: (commentId) => client.delete(`/community/comments/${commentId}/like`),
  myPublications: (params) => client.get('/community/my-publications', { params }),
};

export const notificationApi = {
  list: (params) => client.get('/notifications', { params }),
  unreadCount: () => client.get('/notifications/unread-count'),
  markRead: (id) => client.put(`/notifications/${id}/read`),
  markAllRead: () => client.put('/notifications/read-all'),
};
