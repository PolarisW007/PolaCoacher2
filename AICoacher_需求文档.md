# AICoacher（AI 藏经阁）— 产品需求文档

## 一、项目概述

### 1.1 产品定位

AICoacher（品牌名：**AI 藏经阁**）是一款基于 AI 的智能文档学习与知识传播平台。用户上传 PDF 文档后，系统自动进行内容解析、摘要提取、AI 讲解生成、语音合成，并支持一键生成小红书/朋友圈图文分享内容，实现从"知识输入"到"知识传播"的全链路闭环。

### 1.2 技术架构

| 层级 | 技术选型 |
|------|----------|
| 后端框架 | Python + FastAPI（异步） |
| 数据库 | PostgreSQL（asyncpg） |
| AI 引擎 | 阿里云 DashScope（Qwen Plus / CosyVoice / 通义万象） |
| 前端框架 | React 18 + Vite 5 |
| UI 组件库 | Ant Design v5 |
| 路由方案 | React Router v6（HashRouter） |
| HTTP 通信 | Axios |
| 认证方案 | JWT（python-jose）+ OAuth2 |
| 部署环境 | 阿里云 ECS + Nginx + Supervisor |

---

## 二、用户角色

| 角色 | 说明 |
|------|------|
| 普通用户 | 注册/登录后可上传文档、查看讲解、生成分享内容 |

---

## 三、功能需求

### 3.1 用户认证模块

#### 3.1.1 注册

- **FR-AUTH-001**：支持手机号注册
- **FR-AUTH-002**：支持邮箱注册
- **FR-AUTH-003**：注册时发送 OTP 验证码验证身份
- **FR-AUTH-004**：密码加密存储（passlib）

#### 3.1.2 登录

- **FR-AUTH-005**：支持账号密码登录
- **FR-AUTH-006**：支持手机/邮箱验证码登录
- **FR-AUTH-007**：登录成功返回 JWT Token，前端存储于 localStorage
- **FR-AUTH-008**：Axios 拦截器自动携带 Token，401 时自动登出

#### 3.1.3 会话管理

- **FR-AUTH-009**：`GET /api/auth/me` 获取当前用户信息
- **FR-AUTH-010**：Token 过期后强制重新登录

---

### 3.2 文档管理模块（知识繁星）

#### 3.2.1 文档上传

- **FR-DOC-001**：支持 PDF 文件拖拽上传
- **FR-DOC-002**：上传后自动触发后台异步文档处理流程
- **FR-DOC-003**：文档处理流程包括：
  1. pdfplumber 解析 PDF，逐页提取文本
  2. Qwen Plus 生成文档摘要
  3. Qwen Plus 提取关键知识点
  4. Qwen Plus 生成 PPT 结构化内容
  5. 存入 PostgreSQL 并实时更新处理进度

#### 3.2.2 文档列表

- **FR-DOC-004**：分页展示用户文档列表
- **FR-DOC-005**：支持按关键词搜索文档
- **FR-DOC-006**：支持按分类筛选文档
- **FR-DOC-007**：展示文档处理状态与进度（轮询）
- **FR-DOC-008**：支持删除文档

#### 3.2.3 文档阅读

- **FR-DOC-009**：在线查看 PDF 原文（pdfjs-dist 渲染）
- **FR-DOC-010**：展示 AI 生成的摘要与关键点

---

### 3.3 AI 讲解模块

#### 3.3.1 讲解生成

- **FR-LEC-001**：一键触发 AI 讲解生成（`POST /api/documents/{id}/generate-lecture`）
- **FR-LEC-002**：基于 PPT 内容与原文分页，Qwen Plus 并行生成每页讲解文本（4 并发）
- **FR-LEC-003**：讲解生成后自动触发后台翻译（英→中，3 并发）
- **FR-LEC-004**：讲解生成后自动触发后台音频预生成（2 并发）

#### 3.3.2 文档播放器（DocumentPlayer）

- **FR-LEC-005**：三栏布局播放界面：
  - 左栏：幻灯片缩略图导航
  - 中栏：核心要点 + PDF 原文 + AI 讲解文本
  - 右栏：PDF 预览 / 原文译文双语对照
- **FR-LEC-006**：语音播放功能：
  - CosyVoice 多音色选择
  - 预生成音频缓存机制
  - 自动播放下一页
  - 播放/暂停控制
- **FR-LEC-007**：翻译对照功能：英文原文与中文译文并排展示
- **FR-LEC-008**：逐页查看与自由切换

---

### 3.4 语音合成模块（TTS）

- **FR-TTS-001**：基于阿里云 CosyVoice 服务进行语音合成
- **FR-TTS-002**：支持多种音色选择（`GET /api/tts/voices`）
- **FR-TTS-003**：支持按需合成（`POST /api/tts/synthesize`）
- **FR-TTS-004**：音频按页缓存至文件系统（`./data/audio/`），避免重复合成
- **FR-TTS-005**：支持查询文档音频就绪状态（`GET /api/documents/{id}/audio-status`）
- **FR-TTS-006**：支持触发指定页音频生成（`POST /api/documents/{id}/trigger-audio`）

---

### 3.5 社交分享模块

#### 3.5.1 小红书图文生成

- **FR-SHARE-001**：基于文档内容，AI 生成小红书风格标题与文案
- **FR-SHARE-002**：通义万象（wanx2.1-t2i-turbo）生成封面图
- **FR-SHARE-003**：生成结构化图文幻灯片（slides）
- **FR-SHARE-004**：小红书图文列表查看（`GET /api/xiaohongshu/posts`）

#### 3.5.2 朋友圈图文生成

- **FR-SHARE-005**：基于文档内容，AI 生成朋友圈风格文案
- **FR-SHARE-006**：通义万象生成配图
- **FR-SHARE-007**：朋友圈图文列表查看（`GET /api/moments/posts`）

---

### 3.6 翻译模块

- **FR-TRANS-001**：支持 AI 文本翻译（`POST /api/analysis/translate`）
- **FR-TRANS-002**：讲解生成后自动后台翻译各页内容

---

## 四、非功能需求

### 4.1 性能

- **NFR-PERF-001**：讲解生成支持 4 并发处理
- **NFR-PERF-002**：音频合成支持 2 并发处理
- **NFR-PERF-003**：翻译支持 3 并发处理
- **NFR-PERF-004**：文档列表支持分页加载与预加载
- **NFR-PERF-005**：API 响应缓存与用户文档索引缓存

### 4.2 安全

- **NFR-SEC-001**：密码使用 passlib 加密存储
- **NFR-SEC-002**：所有 API 接口需 JWT 认证（认证接口除外）
- **NFR-SEC-003**：Axios 拦截器处理 401 自动登出

### 4.3 可用性

- **NFR-UX-001**：深色主题 UI 设计（主色 `#0d1117`、`#161b22`，高亮色 `#1890ff`）
- **NFR-UX-002**：文档处理进度实时轮询反馈
- **NFR-UX-003**：拖拽上传交互体验

---

## 五、数据模型

### 5.1 users 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 用户 ID |
| username | VARCHAR | 用户名 |
| phone | VARCHAR | 手机号 |
| email | VARCHAR | 邮箱 |
| password_hash | VARCHAR | 加密密码 |
| created_at | TIMESTAMP | 注册时间 |
| last_login | TIMESTAMP | 最后登录时间 |

### 5.2 documents 表

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 文档 ID |
| user_id | INTEGER FK | 所属用户 |
| title | VARCHAR | 文档标题 |
| filename | VARCHAR | 文件名 |
| file_path | VARCHAR | 存储路径 |
| file_size | BIGINT | 文件大小 |
| page_count | INTEGER | 页数 |
| word_count | INTEGER | 字数 |
| summary | TEXT | AI 摘要 |
| key_points | JSONB | AI 关键点 |
| ppt_content | JSONB | PPT 结构化内容 |
| lecture_slides | JSONB | 讲解内容（含翻译） |
| status | VARCHAR | 处理状态 |
| progress | FLOAT | 处理进度 |
| audio_ready_pages | JSONB | 已生成音频的页码 |
| created_at | TIMESTAMP | 创建时间 |

### 5.3 xhs_posts 表（小红书图文）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | SERIAL PK | 帖子 ID |
| user_id | INTEGER FK | 所属用户 |
| document_id | INTEGER FK | 关联文档 |
| title | VARCHAR | 标题 |
| content | TEXT | 文案内容 |
| cover_prompt | TEXT | 封面图 prompt |
| cover_url | VARCHAR | 封面图 URL |
| image_status | VARCHAR | 图片生成状态 |
| slides | JSONB | 幻灯片内容 |

### 5.4 moments_posts 表（朋友圈图文）

结构与 xhs_posts 类似。

---

## 六、API 接口清单

### 6.1 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/send-otp` | 发送验证码 |
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 账号密码登录 |
| POST | `/api/auth/login-otp` | 验证码登录 |
| GET | `/api/auth/me` | 获取当前用户 |

### 6.2 文档

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/documents/upload` | 上传文档 |
| GET | `/api/documents/list` | 文档列表 |
| GET | `/api/documents/{id}` | 文档详情 |
| DELETE | `/api/documents/{id}` | 删除文档 |
| GET | `/api/documents/{id}/pdf` | 获取 PDF 文件 |
| GET | `/api/documents/{id}/lecture` | 获取讲解内容 |
| POST | `/api/documents/{id}/generate-lecture` | 生成 AI 讲解 |
| GET | `/api/documents/{id}/audio/{page}` | 获取页音频 |
| GET | `/api/documents/{id}/audio-status` | 音频就绪状态 |
| POST | `/api/documents/{id}/trigger-audio` | 触发音频生成 |

### 6.3 分享

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/documents/{id}/share/xiaohongshu` | 生成小红书图文 |
| POST | `/api/documents/{id}/share/moments` | 生成朋友圈图文 |
| GET | `/api/xiaohongshu/posts` | 小红书图文列表 |
| GET | `/api/moments/posts` | 朋友圈图文列表 |

### 6.4 其他

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/analysis/translate` | AI 翻译 |
| GET | `/api/tts/voices` | 可用音色列表 |
| POST | `/api/tts/synthesize` | 语音合成 |

---

## 七、页面路由

| 路由 | 组件 | 说明 |
|------|------|------|
| `/login` | Login | 登录页 |
| `/register` | Register | 注册页 |
| `/` | KnowledgeStar | 知识繁星（首页） |
| `/documents` | DocumentLibrary | 文档管理 |
| `/reader/:id` | DocumentReader | 文档阅读 |
| `/play/:id` | DocumentPlayer | 文档讲解播放 |

---

## 八、核心业务流程

### 8.1 文档处理流程

```
用户上传 PDF
    ↓
pdfplumber 逐页解析文本
    ↓
Qwen Plus 生成摘要
    ↓
Qwen Plus 提取关键知识点
    ↓
Qwen Plus 生成 PPT 结构化内容
    ↓
存入 PostgreSQL（实时更新进度）
```

### 8.2 AI 讲解生成流程

```
用户点击"生成讲解"
    ↓
基于 PPT 内容 + 原文分页
    ↓
Qwen Plus 并行生成每页讲解（4 并发）
    ↓
    ├── 后台翻译（英→中，3 并发）
    └── 后台预生成音频（CosyVoice，2 并发）
    ↓
用户进入播放器查看/收听
```

### 8.3 社交分享流程

```
用户点击"生成小红书/朋友圈"
    ↓
Qwen Plus 生成标题 + 文案
    ↓
通义万象生成封面图
    ↓
返回可分享的图文内容
```

---

## 九、部署架构

```
用户浏览器
    ↓
Nginx（端口 80/443）
    ├── 静态资源 → 前端 build（Vite 构建）
    └── /api/* → FastAPI（uvicorn，端口 8765）
                    ├── PostgreSQL
                    ├── 文件系统（PDF / 音频）
                    └── 阿里云 DashScope API
```

- 生产地址：`http://42.121.164.11/#/`
- 进程管理：Supervisor

---

## 十、第三方依赖

### 后端

| 依赖 | 用途 |
|------|------|
| fastapi | Web 框架 |
| uvicorn | ASGI 服务器 |
| pydantic | 数据校验 |
| asyncpg | PostgreSQL 异步驱动 |
| python-multipart | 文件上传 |
| pdfplumber | PDF 解析 |
| python-jose | JWT 生成/验证 |
| passlib | 密码加密 |
| requests | HTTP 请求 |
| python-dotenv | 环境变量管理 |
| dashscope | 阿里云 AI SDK |

### 前端

| 依赖 | 用途 |
|------|------|
| react / react-dom | UI 框架 |
| react-router-dom | 路由 |
| antd | UI 组件库 |
| axios | HTTP 请求 |
| pdfjs-dist | PDF 渲染 |
| react-icons | 图标库 |
| react-markdown | Markdown 渲染 |
| styled-components | CSS-in-JS |
| vite | 构建工具 |

---

## 十一、已知问题与优化建议

| 编号 | 问题 | 建议 |
|------|------|------|
| 1 | 数据源混用：部分接口仍用内存 JSON（`UPLOADED_DOCUMENTS`），文档创建已迁移至 PostgreSQL，存在数据不一致风险 | 统一迁移至 PostgreSQL |
| 2 | CRUD 函数命名不一致：`demo_app.py` 调用 `crud_update_document`，但 crud 模块导出为 `update_document` | 修正函数命名与导入 |
| 3 | JSON 文件存储：`users.json`、`xhs_posts.json`、`moments_posts.json` 仍使用文件存储 | 迁移至 PostgreSQL |
| 4 | 音频缓存无清理机制 | 增加过期清理策略 |
| 5 | AI 调用缺少重试与降级 | 增加重试机制与错误降级策略 |
