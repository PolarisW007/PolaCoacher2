# 书籍搜索与 PDF 下载功能架构文档

> 版本：v1.0 | 更新日期：2026-03-15
> 基于线上服务器代码分析 + 500 错误日志排查

---

## 一、功能概述

用户在书架页点击「添加文档」→「书籍搜索」，输入关键词后搜索全球开放书库，选择结果后自动下载 PDF 并进行 AI 分析处理。

**当前问题（截图中的 500 错误）：**
- `POST /api/documents/28/reprocess` → `NOT NULL constraint failed: documents.file_path`
  - 原因：小王子文档下载失败后 `file_path` 为 NULL，重处理时触发非空约束
- `POST /api/history/record` → 阅读历史写入偶发 500

---

## 二、涉及文件清单

### 前端

| 文件 | 职责 |
|------|------|
| `frontend/src/pages/bookshelf/BookshelfPage.jsx` | 书架页：搜索弹窗、结果列表、导入按钮、状态展示 |
| `frontend/src/api/documents.js` | API 封装：`bookSearch`、`bookImport`、`bookImportStatus`、`retryDownload`、`reprocess` |
| `frontend/src/api/client.js` | Axios 实例：baseURL、token 注入、超时配置 |

### 后端

| 文件 | 职责 |
|------|------|
| `backend/app/api/endpoints/documents.py` | 核心：搜索、导入、下载、重试、重处理 API |
| `backend/app/services/zlib_service.py` | Z-Library 登录会话管理、书籍下载 |
| `backend/app/services/doc_processor.py` | 文档处理：文本提取、摘要、PPT、讲解、场景图生成 |
| `backend/app/models/social.py` | `BookImportTask` 模型（导入任务表） |
| `backend/app/models/document.py` | `Document` 模型（文档主表） |
| `backend/app/schemas/document.py` | `BookSearchRequest`、`BookImportRequest` 请求体定义 |
| `backend/app/core/config.py` | `ZLIB_EMAIL`、`ZLIB_PASSWORD` 等配置 |
| `backend/app/api/router.py` | 路由注册（静态路由优先挂载，防止 `{doc_id}` 误匹配） |

---

## 三、完整数据流

```
用户输入关键词 → 前端 handleBookSearch()
        │
        ▼
GET /api/documents/book-search?query=小王子
        │
        ▼
┌─ 后端 book_search() ─────────────────────────────────────────┐
│                                                               │
│  并行请求 Anna's Archive (https://annas-archive.gl/search):   │
│    ├── src=lgrsnf  (Libgen 非小说)  ──┐                      │
│    ├── src=lgli    (Libgen 小说)    ──┤ can_auto_download=True│
│    ├── src=lgrs    (Libgen RS)      ──┘                      │
│    └── src=zlib    (Z-Library)     ── can_auto_download=有凭据│
│                                                               │
│  代理策略（依次尝试）:                                        │
│    1. api.codetabs.com/v1/proxy/                             │
│    2. api.allorigins.win/raw                                 │
│    3. 直连 annas-archive.gl                                   │
│                                                               │
│  _parse_annas_archive_html() → 提取 md5/title/author/cover  │
│  去重 + 排序（can_auto_download 优先，zlib 次之）              │
│                                                               │
│  返回 results[] (最多 99 条)                                  │
└──────────────────────────────────────────────────────────────┘
        │
        ▼ 用户选择一条结果，点击「导入」
        │
POST /api/documents/book-import
  body: { title, author, md5, book_source, file_type, cover_url, ... }
        │
        ▼
┌─ 后端 book_import() ────────────────────────────────────────┐
│                                                              │
│  1. 创建 Document (status="importing", file_path=临时占位)   │
│  2. 创建 BookImportTask (status="downloading")               │
│  3. asyncio.create_task(_download_and_process_pdf)           │
│  4. 立即返回 { task_id, document_id }                        │
│                                                              │
└──────────────────────────────────────────────────────────────┘
        │
        ▼ 异步后台执行
        │
┌─ _download_and_process_pdf(task_id, doc_id, md5, book_source) ─┐
│                                                                  │
│  _try_download_pdf(md5, book_source) → 6 种下载策略:            │
│                                                                  │
│  策略 1: library.lol/main/{md5}                                  │
│    → 解析页面找 get.php 或 /dl/ 链接 → 直连下载                   │
│                                                                  │
│  策略 2: libgen.rs/book/index.php?md5={md5}                     │
│    → 同上                                                        │
│                                                                  │
│  策略 3: libgen.st (备用域名)                                    │
│    → 同上                                                        │
│                                                                  │
│  策略 4: libgen.li/ads.php?md5={md5}                            │
│    → 直连 + 代理兜底                                             │
│                                                                  │
│  策略 5: Anna's Archive /md5/{md5} 页面                         │
│    → 解析二级链接或备用 md5 → 递归下载                            │
│                                                                  │
│  策略 6: Z-Library (仅 book_source="zlib")                      │
│    → zlib_service.download_zlib_book(md5)                       │
│    → 5 个域名轮询 (z-lib.gd, 1lib.sk, z-lib.ai, ...)           │
│                                                                  │
│  ✅ 下载成功:                                                    │
│    → 验证 %PDF 头                                                │
│    → 写入 data/uploads/{uuid}.pdf                               │
│    → 更新 Document: file_path, file_size, status="processing"    │
│    → 调用 process_document(doc_id) 进入 AI 处理流程              │
│                                                                  │
│  ❌ 下载失败:                                                    │
│    → BookImportTask.status = "error"                            │
│    → Document.status = "pending_upload"                         │
│    → Document.error_detail = 用户可读错误说明                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
        │
        ▼ 下载成功后
        │
┌─ process_document(doc_id) — doc_processor.py ───────────────┐
│                                                              │
│  Step 1: 提取文本                                            │
│    → pdfplumber (主方案)                                     │
│    → pypdf (降级方案)                                        │
│    → 两者均无文字 → 判定为扫描版，status="error"              │
│                                                              │
│  Step 2: AI 分析文档类型                                     │
│    → classify_document_type()                                │
│    → detect_known_ip()                                       │
│                                                              │
│  Step 3: 生成摘要 + 关键点                                   │
│  Step 4: 生成讲解 Slides + TTS 音频                          │
│  Step 5: 异步生成场景图 (wanx2.1-t2i-plus)                   │
│  Step 6: 生成封面图                                          │
│  Step 7: 结构化内容提取 (chapters + paragraphs)              │
│                                                              │
│  status = "ready" ✅                                         │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 四、搜索数据源详解

### 4.1 Anna's Archive — 唯一搜索入口

所有搜索请求都通过 [Anna's Archive](https://annas-archive.gl) 进行，它是一个聚合搜索引擎，整合了以下书库：

| 书库源 (src) | 全称 | 特点 | 自动下载 |
|-------------|------|------|---------|
| `lgrsnf` | Library Genesis (Non-Fiction) | 学术论文、技术书籍为主 | ✅ 通过 Libgen 镜像直连 |
| `lgli` | Library Genesis (Fiction) | 小说、文学作品 | ✅ 通过 Libgen 镜像直连 |
| `lgrs` | Library Genesis RS | Libgen 的 RS 分支 | ✅ 通过 Libgen 镜像直连 |
| `zlib` | Z-Library | 品种最全，需账号 | ⚠️ 需配置 ZLIB_EMAIL/PASSWORD |

### 4.2 代理策略

由于国内无法直连 Anna's Archive，采用代理访问：

```
优先级 1: api.codetabs.com/v1/proxy/?quest={url}
优先级 2: api.allorigins.win/raw?url={url}
优先级 3: 直连 annas-archive.gl（国内通常不可达）
```

### 4.3 搜索结果解析

`_parse_annas_archive_html(html, libgen_source)` 从 HTML 中提取：

| 字段 | 来源 |
|------|------|
| `md5` | URL 路径中的 MD5 hash |
| `title` | `<h3>` 标签文本 |
| `author` | 作者信息文本 |
| `file_type` | 文件格式标识（pdf/epub/...） |
| `file_size` | 文件大小文本 |
| `cover_url` | 封面缩略图 URL |
| `can_auto_download` | libgen 源 + pdf 格式 = true |
| `book_source` | lgrsnf / lgli / lgrs / zlib |

---

## 五、PDF 下载策略详解

### 5.1 Libgen 镜像下载（策略 1-4）

```
MD5 → library.lol/main/{md5}
       │
       ├── 解析页面 HTML
       ├── 找到 get.php?md5=... 或 /dl/... 链接
       └── 直接 GET 下载 PDF bytes
           │
           ├── 验证响应头 Content-Type 含 "pdf" 或 "octet"
           ├── 验证内容以 %PDF 开头
           └── 返回 bytes
```

四个 Libgen 镜像域名依次尝试：
1. `library.lol`
2. `libgen.rs`
3. `libgen.st`
4. `libgen.li`

### 5.2 Z-Library 下载（策略 6）

```
┌─ ensure_zlib_session() ─────────────────────────┐
│  检查已有 session cookie 是否有效               │
│  无效则用 ZLIB_EMAIL/PASSWORD 重新登录          │
│  成功后缓存 session cookies                     │
└──────────────────────────────────────────────────┘
        │
        ▼
┌─ download_zlib_book(md5) ───────────────────────┐
│  遍历 5 个 ZLib 域名:                           │
│    z-lib.gd → 1lib.sk → z-lib.ai →             │
│    z-lib.id → z-lib.cv                          │
│                                                  │
│  每个域名:                                       │
│    1. GET https://{domain}/md5/{md5}             │
│    2. 正则提取 /dl/... 下载链接                  │
│    3. GET 下载链接 → 验证 %PDF 头               │
│    4. 成功则返回 bytes                           │
└──────────────────────────────────────────────────┘
```

---

## 六、错误处理与失败恢复

### 6.1 下载失败分类

| 错误类型 | error_detail 文案 | Document.status |
|---------|------------------|----------------|
| 非 PDF 格式 | "下载的文件不是有效的 PDF 格式..." | `pending_upload` |
| 所有镜像均失败 | "该书籍在所有镜像源均无法自动下载..." | `pending_upload` |
| 文件过大 | "书籍文件过大..." | `pending_upload` |
| 扫描版 PDF | "该文件可能是扫描版图片PDF..." | `error` |

### 6.2 恢复机制

| 操作 | API | 逻辑 |
|------|-----|------|
| 重新下载 | `POST /documents/{id}/retry-download` | 重新执行 `_try_download_pdf`，根据 source_type 判断走 Libgen 还是 ZLib |
| 重新处理 | `POST /documents/{id}/reprocess` | 不重新下载，只重新跑文本提取 + AI 分析 |
| 手动上传 | `POST /documents/{id}/upload-pdf` | 用户手动上传 PDF 替换 |

### 6.3 当前 BUG：reprocess 500 错误

**根因**：`Document.file_path` 列定义为 `NOT NULL`，但下载失败的文档 `file_path` 为 NULL。
当用户点击「重新处理」时，代码尝试更新 document 状态，触发 autoflush，
SQLAlchemy 检测到 `file_path=None` 违反非空约束 → 抛出 `IntegrityError`。

```
sqlalchemy.exc.IntegrityError:
  NOT NULL constraint failed: documents.file_path
  [SQL: UPDATE documents SET file_path=?, status=?, ... WHERE documents.id = ?]
  [parameters: (None, 'importing', None, 28)]
```

**修复方案**：`reprocess` 端点应先检查 `file_path` 是否存在，不存在则引导用户使用「重新下载」或「手动上传」。

---

## 七、前端交互流程

### 7.1 搜索弹窗

```
BookshelfPage
  └── 点击「+添加文档」卡片
       └── showBookSearch = true
            └── 搜索弹窗 (Modal)
                 ├── 输入框 + 搜索按钮
                 ├── handleBookSearch(query)
                 │    └── docApi.bookSearch({ query }) — timeout 90s
                 └── 结果列表
                      └── 每条结果显示：封面、标题、作者、格式、大小
                           └── 「导入」按钮 → handleBookImport(book)
```

### 7.2 导入状态展示

```
文档卡片上的状态展示:
  ├── status="importing"    → 🔄 "下载中..."
  ├── status="processing"   → 🔄 "AI 处理中..." + 进度条
  ├── status="ready"        → ✅ "已就绪" + 摘要预览
  ├── status="pending_upload" → ❌ "下载失败" + error_detail
  │    ├── 「🔄 重新自动下载」按钮 → retryDownload(id)
  │    └── 「📤 手动上传 PDF」按钮 → uploadPdf(id, file)
  └── status="error"        → ❌ "处理失败" + error_detail
       └── 「🔄 重新处理」按钮 → reprocess(id)
```

---

## 八、关键函数速查

### 后端 (documents.py)

| 函数 | 路由 | 参数 | 核心逻辑 |
|------|------|------|---------|
| `book_search()` | GET `/book-search` | `query, language, format, page` | 并行搜索 4 源，解析 HTML，去重排序 |
| `book_import()` | POST `/book-import` | `BookImportRequest` | 创建 Doc+Task，异步下载 |
| `_download_and_process_pdf()` | 内部异步 | `task_id, doc_id, md5, book_source` | 调下载 → 写文件 → process_document |
| `_try_download_pdf()` | 内部 | `md5, book_source` | 6 策略尝试下载 |
| `retry_download()` | POST `/{id}/retry-download` | `doc_id` | 重新下载已失败的书 |
| `reprocess()` | POST `/{id}/reprocess` | `doc_id, force_redownload` | 重新跑文本提取+AI |

### 后端 (zlib_service.py)

| 函数 | 参数 | 核心逻辑 |
|------|------|---------|
| `ensure_zlib_session()` | 无 | 检查/刷新 ZLib 登录 cookie |
| `download_zlib_book(md5)` | `md5` | 5 域名轮询下载 |
| `mark_cred_invalid()` | 无 | 标记凭据失效 |

### 后端 (doc_processor.py)

| 函数 | 参数 | 核心逻辑 |
|------|------|---------|
| `process_document(doc_id)` | `doc_id` | 全流程：提取 → 摘要 → 讲解 → 场景图 → 封面 |
| `_extract_text_from_pdf(path)` | `file_path` | pdfplumber + pypdf 降级，判断扫描版 |

---

## 九、当前问题点汇总

| # | 问题 | 严重度 | 影响 |
|---|------|--------|------|
| 1 | **reprocess 500**: file_path 为 NULL 时触发非空约束 | 🔴 高 | 下载失败的书无法重处理 |
| 2 | **history/record 500**: 偶发写入失败 | 🟡 中 | 阅读历史丢失，不影响核心功能 |
| 3 | **代理不稳定**: allorigins 返回 500/522 | 🟡 中 | 搜索结果偶尔缺失某些源 |
| 4 | **扫描版无法事前识别**: 只有下载+解析后才知道 | 🟡 中 | 浪费下载时间和带宽 |
| 5 | **ZLib 登录态失效**: 无自动恢复提示 | 🟢 低 | ZLib 源搜索结果为 0 |
| 6 | **导入进度无细粒度**: 只有 importing/ready/error | 🟢 低 | 用户等待体验差 |

---

## 十、修复计划

### 10.1 立即修复（P0）

**问题 1: reprocess 500 — file_path 为 NULL**

修改 `reprocess()` 端点，增加 file_path 前置检查：

```python
# 在 reprocess() 开头
if not doc.file_path or not os.path.exists(doc.file_path):
    raise HTTPException(
        status_code=400,
        detail="文档尚未下载成功，请先使用「重新下载」或「手动上传 PDF」"
    )
```

**问题 2: history/record 500**

排查 `ReadingHistory` 模型的写入逻辑，可能是字段类型不匹配或并发写入冲突。

### 10.2 稳定性提升（P1）

- 代理增加重试（当前仅单次尝试）
- 搜索超时从 30s 调整为可配置
- 下载策略增加更多 Libgen 镜像

### 10.3 体验优化（P2）

- 搜索结果预标记扫描版（若 Anna's Archive 提供元数据）
- 导入进度细分：下载中 → AI 提取中 → 生成讲解中 → 完成
- ZLib 凭据状态展示在设置页

---

## 十一、目录结构速查

```
backend/app/
├── api/
│   ├── endpoints/
│   │   └── documents.py        ← 搜索/导入/下载/重试 核心逻辑
│   └── router.py               ← 路由注册
├── services/
│   ├── zlib_service.py          ← Z-Library 登录+下载
│   └── doc_processor.py         ← 文档处理全流程
├── models/
│   ├── document.py              ← Document 模型
│   └── social.py                ← BookImportTask 模型
├── schemas/
│   └── document.py              ← BookSearchRequest / BookImportRequest
└── core/
    └── config.py                ← ZLIB_EMAIL, ZLIB_PASSWORD 等配置

frontend/src/
├── api/
│   ├── documents.js             ← bookSearch / bookImport / retryDownload API
│   └── client.js                ← Axios 实例
└── pages/
    └── bookshelf/
        └── BookshelfPage.jsx    ← 书架页 + 搜索弹窗 + 导入交互
```
