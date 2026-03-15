import client from './client';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export const docApi = {
  upload: (file, onProgress) => {
    const form = new FormData();
    form.append('file', file);
    return client.post('/documents/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress,
      timeout: 0,
    });
  },
  importUrl: (data) => client.post('/documents/import-url', data),
  bookSearch: (params) => client.get('/documents/book-search', { params, timeout: 90000 }),
  bookImport: (data) => client.post('/documents/book-import', data),
  bookImportStatus: (taskId) => client.get(`/documents/book-import/${taskId}/status`),
  bookImportRetry: (taskId) => client.post(`/documents/book-import/${taskId}/retry`),
  retryDownload: (docId) => client.post(`/documents/${docId}/retry-download`),
  checkIsbn: (isbn) => client.get(`/documents/check-isbn/${isbn}`),
  zlibStatus: () => client.get('/documents/zlib-status'),
  list: (params) => client.get('/documents/list', { params }),
  get: (id) => client.get(`/documents/${id}`),
  delete: (id) => client.delete(`/documents/${id}`),
  reprocess: (id) => client.post(`/documents/${id}/reprocess`),
  move: (id, groupId) => client.put(`/documents/${id}/move`, { group_id: groupId }),
  publish: (id, data) => client.post(`/documents/${id}/publish`, data),
  unpublish: (id) => client.post(`/documents/${id}/unpublish`),
  generateLecture: (id) => client.post(`/documents/${id}/generate-lecture`),
  getLecture: (id) => client.get(`/documents/${id}/lecture`),
  getFileUrl: (id) => client.get(`/documents/${id}/file-url`),
  getPdf: (id) => `${BASE}/api/documents/${id}/pdf`,
  uploadPdf: (id, file, onProgress) => {
    const form = new FormData();
    form.append('file', file);
    return client.post(`/documents/${id}/upload-pdf`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: onProgress,
      timeout: 0,
    });
  },
  generateCover: (id) => client.post(`/documents/${id}/generate-cover`),
  completionCard: (id) => client.post(`/documents/${id}/completion-card`),
  chat: (id, data) => client.post(`/documents/${id}/chat`, data),
  chatHistory: (id, params) => client.get(`/documents/${id}/chat/history`, { params }),
  deleteChatSession: (id, sessionId) => client.delete(`/documents/${id}/chat/sessions/${sessionId}`),
  createNote: (id, data) => client.post(`/documents/${id}/notes`, data),
  listNotes: (id) => client.get(`/documents/${id}/notes`),
  updateNote: (noteId, data) => client.put(`/notes/${noteId}`, data),
  deleteNote: (noteId) => client.delete(`/notes/${noteId}`),
  shareXhs: (id) => client.post(`/documents/${id}/share/xiaohongshu`),
  shareMoments: (id) => client.post(`/documents/${id}/share/moments`),
  // 阅读器相关
  getContent: (id, params) => client.get(`/documents/${id}/content`, { params }),
  getTranslation: (id, params) => client.get(`/documents/${id}/translation`, { params }),
  triggerTranslate: (id, targetLang) => client.post(`/documents/${id}/translate`, { target_lang: targetLang }),
  reparse: (id) => client.post(`/documents/${id}/reparse`),
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

export const bookshelfApi = {
  list: (params) => client.get('/bookshelf/list', { params }),
  add: (documentId) => client.post('/bookshelf/add', { document_id: documentId }),
  remove: (docId) => client.delete(`/bookshelf/remove/${docId}`),
  batchOp: (data) => client.put('/bookshelf/documents/batch', data),
  moveDoc: (docId, groupId) => client.put(`/bookshelf/documents/${docId}/move`, { group_id: groupId }),
};

export const ttsApi = {
  voices: () => client.get('/tts/voices'),
  synthesize: (data) => client.post('/tts/synthesize', data),
  audioStatus: (docId) => client.get(`/tts/documents/${docId}/audio-status`),
  triggerAudio: (docId, page) => client.post(`/tts/documents/${docId}/trigger-audio/${page}`),
  preload: (data) => client.post('/tts/preload', data),
  resolveAudioUrl: (relUrl) => {
    if (!relUrl) return '';
    if (relUrl.startsWith('http')) return relUrl;
    return `${BASE}${relUrl.startsWith('/') ? relUrl : `/${relUrl}`}`;
  },
};

export const historyApi = {
  list: (params) => client.get('/history', { params }),
  record: (data) => client.post('/history/record', data),
  delete: (id) => client.delete(`/history/${id}`),
};

export const settingsApi = {
  get: () => client.get('/settings'),
  update: (data) => client.put('/settings', data),
};

export const analysisApi = {
  translate: (data) => client.post('/analysis/translate', data),
};

export const shareApi = {
  xhsPosts: (params) => client.get('/xiaohongshu/posts', { params }),
  momentsPosts: (params) => client.get('/moments/posts', { params }),
};
