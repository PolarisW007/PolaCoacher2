import client from './client';

export const docApi = {
  upload: (file, onProgress) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress,
    });
  },
  list: (params) => client.get('/documents/list', { params }),
  get: (id) => client.get(`/documents/${id}`),
  delete: (id) => client.delete(`/documents/${id}`),
  move: (id, groupId) => client.put(`/documents/${id}/move`, { group_id: groupId }),
  publish: (id, data) => client.post(`/documents/${id}/publish`, data),
  unpublish: (id) => client.post(`/documents/${id}/unpublish`),
};

export const groupApi = {
  list: () => client.get('/bookshelf/groups'),
  create: (name) => client.post('/bookshelf/groups', { name }),
  update: (id, data) => client.put(`/bookshelf/groups/${id}`, data),
  delete: (id) => client.delete(`/bookshelf/groups/${id}`),
};

export const lectureNoteApi = {
  list: (docId) => client.get(`/documents/${docId}/lecture-notes`),
  upsert: (docId, page, content) =>
    client.put(`/documents/${docId}/lecture-notes/${page}`, { content }),
  delete: (docId, page) => client.delete(`/documents/${docId}/lecture-notes/${page}`),
  export: (docId) => client.get(`/documents/${docId}/lecture-notes/export`),
};
