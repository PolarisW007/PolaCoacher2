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

### 10.2 稳定性提升（P1）— ✅ 已完成

- ✅ 代理增加重试（每个代理 URL 最多重试 2 次，退避 1s/3s）+ 新增 cors.lol 代理
- ✅ 搜索超时改为可配置 `SEARCH_TIMEOUT`（config.py）
- ✅ 下载策略新增 `libgen.is`、`libgen.gs` 两个镜像（共 6 个镜像）

### 10.3 体验优化（P2）— ✅ 已完成

- ⏳ 搜索结果预标记扫描版（Anna's Archive 暂无可靠元数据，待后续支持）
- ✅ 导入进度细分：搜索下载源 → 正在下载 → 下载完成 → AI 处理各步骤
- ✅ ZLib 凭据状态展示：`/zlib-status` API + 搜索弹窗顶部状态栏

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

---

## 十二、大 PDF 分批加载与生成策略

> 设计目标：以 **5MB** 为基本单元，避免大文件（50MB+）在下载、解析、AI 生成任何阶段把服务器 IO/内存打满导致挂掉。

### 12.1 当前风险分析

#### IO/内存风险点（按严重程度排序）

| 风险等级 | 环节 | 函数 | 问题 |
|---------|------|------|------|
| 🔴 **高** | PDF 下载 | `_try_download_pdf` / `download_zlib_book` | `resp.content` 整个 PDF 一次性读入内存（100MB PDF = 100MB 内存） |
| 🔴 **高** | 文本提取 | `_extract_text_from_pdf` | pdfplumber/pypdf 全量加载 PDF，`text_parts` 无上限 |
| 🔴 **高** | 结构化提取 | `_extract_with_pymupdf` | 全量加载 + 逐页提取图片，大图 `img_bytes` 全驻留内存 |
| 🔴 **高** | 文档处理 | `process_document` | 无全局并发限制，多文档同时处理时内存叠加 |
| 🟡 **中** | 讲解生成 | `_generate_all_lectures` | Semaphore(2) 但一次创建所有 30+ 个 task |
| 🟡 **中** | 场景图 | `_call_wanx_image` | 图片 `img_resp.content` 全量读入（约 0.5-2MB/张） |
| 🟢 **低** | 文件上传 | `_stream_to_disk` | 已实现流式写入，50MB 分块 |

#### 当前并发控制（不足）

| 模块 | 当前限制 | 问题 |
|------|---------|------|
| `process_document` 整体 | **无限制** | 5 个用户同时上传 = 5 个大 PDF 并发处理 |
| PDF 下载 | **无限制** | 多个 book_import 可同时下载 |
| 讲解生成 | Semaphore(2) | 仅限单文档内，跨文档无限制 |
| 场景图生成 | Semaphore(1) | 同上 |
| 翻译 | Semaphore(3) | 同上 |
| 结构化提取 | **无限制** | 与 process_document 并行执行 |

---

### 12.2 分批策略设计（5MB 单元）

#### 核心原则

```
1. 下载阶段：流式写入，内存中最多保留 5MB
2. 解析阶段：分页批处理，每批累积文本不超过 5MB
3. AI 生成阶段：分批提交，每批 5 个 slide
4. 全局并发：同时处理的文档数 ≤ 2
```

---

#### A. 下载阶段 — 流式写入磁盘

**当前问题**：`_try_download_pdf` 返回 `bytes`（整个文件在内存），`download_zlib_book` 同理。

**改造方案**：

```python
# ── 改造前 ──
async def _try_download_pdf(md5, ...) -> bytes | None:
    resp = await client.get(url)
    return resp.content  # 100MB 全部在内存

# ── 改造后 ──
STREAM_CHUNK = 5 * 1024 * 1024  # 5MB

async def _try_download_pdf_to_file(md5, save_path, ...) -> bool:
    """流式下载 PDF 到磁盘，内存峰值 ≤ 5MB"""
    async with client.stream("GET", url) as resp:
        if resp.status_code != 200:
            return False
        total = 0
        with open(save_path, "wb") as f:
            async for chunk in resp.aiter_bytes(STREAM_CHUNK):
                f.write(chunk)
                total += len(chunk)
                if total > MAX_DOWNLOAD_SIZE:  # 200MB 上限
                    raise ValueError("文件过大")
    # 验证 %PDF 头
    with open(save_path, "rb") as f:
        if not f.read(5).startswith(b"%PDF"):
            os.remove(save_path)
            return False
    return True
```

**涉及修改**：
- `documents.py`: `_try_download_pdf` → `_try_download_pdf_to_file`
- `documents.py`: `_download_and_process_pdf` 调用方式
- `zlib_service.py`: `download_zlib_book` → `download_zlib_book_to_file`

---

#### B. 文本提取阶段 — 分页批处理

**当前问题**：`pdfplumber.open()` 一次性加载整份 PDF 的结构到内存。

**改造方案**：

```python
_BATCH_PAGES = 20          # 每批处理 20 页
_TEXT_BATCH_MAX = 5 * 1024 * 1024  # 每批文本累积上限 5MB

def _extract_text_from_pdf(file_path: str) -> tuple[str, int, list[str]]:
    """分批提取 PDF 文本，避免全量驻留内存"""
    import fitz
    doc = fitz.open(file_path)
    page_count = doc.page_count
    text_parts = []
    
    for batch_start in range(0, page_count, _BATCH_PAGES):
        batch_end = min(batch_start + _BATCH_PAGES, page_count)
        batch_text_size = 0
        
        for i in range(batch_start, batch_end):
            page = doc.load_page(i)
            page_text = page.get_text()
            text_parts.append(page_text)
            batch_text_size += len(page_text.encode("utf-8"))
            page = None  # 释放页面对象
            
            if batch_text_size > _TEXT_BATCH_MAX:
                break  # 当前批次文本量已达上限
        
        # 显式触发 GC，释放已处理页面的内存
        import gc; gc.collect()
    
    doc.close()
    full_text = "\n".join(text_parts)[:_FULL_TEXT_MAX_CHARS]
    return full_text, page_count, text_parts
```

**关键改动**：
- 使用 `fitz`（PyMuPDF）的 `load_page(i)` 逐页加载替代全量打开
- 每批处理 20 页后触发 GC
- 单批文本累积超过 5MB 时截断

---

#### C. 结构化提取 — 图片分批 + 大小限制

**当前问题**：`_extract_with_pymupdf` 对每页的每张图片 `doc.extract_image(xref)` 一次性读入 `img_bytes`。

**改造方案**：

```python
_MAX_IMAGE_SIZE = 5 * 1024 * 1024    # 单张图片上限 5MB
_MAX_IMAGES_PER_DOC = 50              # 全文档图片上限 50 张
_MAX_IMAGE_TOTAL_BYTES = 50 * 1024 * 1024  # 总图片上限 50MB

async def _extract_images_batch(doc, page_indices, save_dir, ...):
    """分批提取图片，跳过过大的图片"""
    saved_count = 0
    total_bytes = 0
    
    for page_idx in page_indices:
        page = doc.load_page(page_idx)
        images = page.get_images(full=True)
        
        for img_info in images:
            if saved_count >= _MAX_IMAGES_PER_DOC:
                return saved_count
            
            xref = img_info[0]
            img_data = doc.extract_image(xref)
            img_bytes = img_data["image"]
            
            # 跳过过大的图片
            if len(img_bytes) > _MAX_IMAGE_SIZE:
                continue
            
            total_bytes += len(img_bytes)
            if total_bytes > _MAX_IMAGE_TOTAL_BYTES:
                return saved_count
            
            # 写入磁盘后立即释放
            img_path = f"{save_dir}/img_{page_idx}_{saved_count}.png"
            with open(img_path, "wb") as f:
                f.write(img_bytes)
            del img_bytes
            saved_count += 1
        
        page = None
    
    return saved_count
```

---

#### D. AI 生成阶段 — 分批 Slide 处理

**当前问题**：`_generate_all_lectures` 一次创建所有 slide 的 task（可能 30+），虽有 Semaphore(2) 但协程对象全部在内存。

**改造方案**：

```python
_SLIDE_BATCH = 5  # 每批处理 5 个 slide

async def _generate_all_lectures(doc_id, slides, ...):
    """分批生成讲解，每批 5 个 slide"""
    sem = asyncio.Semaphore(2)
    total = len(slides)
    
    for batch_start in range(0, total, _SLIDE_BATCH):
        batch = slides[batch_start : batch_start + _SLIDE_BATCH]
        
        async def _gen(slide, idx):
            async with sem:
                # 生成讲解文本 + 翻译
                ...
        
        tasks = [_gen(s, batch_start + i) for i, s in enumerate(batch)]
        await asyncio.gather(*tasks)
        
        # 每批完成后持久化到数据库，释放内存
        async with async_session_factory() as db:
            doc = await db.get(Document, doc_id)
            doc.lecture_slides = slides  # 保存进度
            await db.commit()
        
        logger.info(f"[Doc {doc_id}] 讲解进度 {min(batch_start + _SLIDE_BATCH, total)}/{total}")
```

**同样适用于**：
- `_generate_all_slide_images`：已经是 Semaphore(1)，但也应分批创建 task
- `_pregenerate_audio`：已串行，无需改动

---

#### E. 全局并发控制 — 文档处理队列

**当前问题**：`asyncio.create_task(process_document(doc_id))` 无限制，5 个用户同时上传 = 5 个大文档并发处理。

**改造方案**：

```python
# 在 doc_processor.py 顶部添加全局信号量
_PROCESS_SEM = asyncio.Semaphore(2)  # 全局最多同时处理 2 个文档

async def process_document(doc_id: int):
    """带全局并发控制的文档处理入口"""
    async with _PROCESS_SEM:
        await _process_document_impl(doc_id)

# 下载也需要全局限制
_DOWNLOAD_SEM = asyncio.Semaphore(2)  # 全局最多同时下载 2 个文件

async def _download_and_process_pdf(task_id, doc_id, md5, book_source):
    async with _DOWNLOAD_SEM:
        await _download_and_process_pdf_impl(...)
```

---

### 12.3 完整分批处理流程

```
用户上传/导入 PDF（可能 100MB+）
        │
        ▼
┌─ 全局下载信号量 (max=2) ──────────────────────────────┐
│                                                        │
│  流式下载，5MB 分块写入磁盘                             │
│  内存峰值: ≤ 5MB                                       │
│  下载完成后验证 %PDF 头                                  │
│                                                        │
└────────────────────────────────────────────────────────┘
        │
        ▼
┌─ 全局处理信号量 (max=2) ──────────────────────────────┐
│                                                        │
│  Step 1: 文本提取（分页批处理）                          │
│    ├── 每 20 页为一批                                    │
│    ├── 每批文本累积 ≤ 5MB 时截断                         │
│    ├── 批间 gc.collect() 释放内存                        │
│    └── 内存峰值: ≤ 当前批 20 页的文本 + PDF 页面结构      │
│                                                        │
│  Step 2: AI 摘要 + 关键点（单次调用，文本已截断 80K）     │
│    └── 内存峰值: ≤ 请求体 ~100KB                        │
│                                                        │
│  Step 3: 文档类型识别（单次调用）                        │
│    └── 内存峰值: ≤ 请求体 ~10KB                         │
│                                                        │
│  Step 4: PPT/讲解 Slides 生成（单次调用）                │
│    └── 内存峰值: ≤ 请求体 ~100KB                        │
│                                                        │
│  Step 5: 讲解文本 + TTS（分批，每批 5 个 slide）          │
│    ├── 每批 5 个 slide × Semaphore(2) = 同时 2 个 AI 调用 │
│    ├── 批间持久化到数据库                                 │
│    └── 内存峰值: ≤ 5 个 slide 的讲解文本 ~50KB            │
│                                                        │
│  Step 6: 结构化提取（分页 + 图片限制）                    │
│    ├── 单张图片 > 5MB → 跳过                             │
│    ├── 全文档图片总量 > 50MB → 停止提取                   │
│    ├── 最多提取 50 张图片                                 │
│    └── 内存峰值: ≤ 单张图片 5MB + 页面结构                │
│                                                        │
│  Step 7: 场景图生成（Semaphore(1)，5 分钟延迟）           │
│    ├── 逐张生成，分批创建 task                            │
│    └── 内存峰值: ≤ 单张图片 ~2MB                         │
│                                                        │
│  Step 8: 封面图生成（单次）                              │
│    └── 内存峰值: ≤ ~2MB                                 │
│                                                        │
└────────────────────────────────────────────────────────┘
        │
        ▼
  status = "ready" ✅
  全程内存峰值控制在 ≤ 20MB（单文档）
```

---

### 12.4 代码修改清单

| 文件 | 修改内容 | 优先级 | 状态 |
|------|---------|--------|------|
| `config.py` | 新增分批处理配置常量 | P0 | ✅ 已完成 |
| `documents.py` | `_try_download_pdf` → `_try_download_pdf_to_file` 流式写入磁盘 | P0 | ✅ 已完成 |
| `documents.py` | `_download_and_process_pdf` 加全局下载信号量 `_DOWNLOAD_SEM` | P0 | ✅ 已完成 |
| `zlib_service.py` | 新增 `download_zlib_book_to_file` 流式版本 | P0 | ✅ 已完成 |
| `doc_processor.py` | 顶部添加 `_PROCESS_SEM = Semaphore(2)` 全局处理信号量 | P0 | ✅ 已完成 |
| `doc_processor.py` | `_generate_all_lectures` 分批 5 个 slide + 批间持久化 | P1 | ✅ 已完成 |
| `doc_processor.py` | `_generate_all_slide_images` 分批创建 task | P1 | ✅ 已完成 |
| `content_service.py` | `_extract_with_pymupdf` 图片大小/数量/总量限制 | P1 | ✅ 已完成 |
| `content_service.py` | `_extract_structured_plain` 加 `f.read()` 上限 2MB | P1 | ✅ 已完成 |
| `ai_service.py` | `_call_wanx_image` 图片流式写入 | P2 | ✅ 已完成 |

### 12.5 配置常量（建议添加到 config.py）

```python
# ── 分批处理配置 ──────────────────────────────
STREAM_CHUNK_SIZE = 5 * 1024 * 1024      # 下载/读取分块大小：5MB
MAX_DOWNLOAD_SIZE_MB = 200               # 单文件下载上限：200MB

PROCESS_CONCURRENCY = 2                  # 全局同时处理文档数
DOWNLOAD_CONCURRENCY = 2                 # 全局同时下载数

TEXT_EXTRACT_BATCH_PAGES = 20            # 文本提取每批页数
TEXT_BATCH_MAX_BYTES = 5 * 1024 * 1024   # 每批文本累积上限：5MB

SLIDE_BATCH_SIZE = 5                     # 讲解生成每批 slide 数

MAX_IMAGE_SIZE = 5 * 1024 * 1024         # 单张图片上限：5MB
MAX_IMAGES_PER_DOC = 50                  # 全文档图片上限：50 张
MAX_IMAGE_TOTAL_BYTES = 50 * 1024 * 1024 # 全文档图片总量上限：50MB
```

### 12.6 预期效果

| 指标 | 改造前 | 改造后 |
|------|--------|--------|
| 下载 100MB PDF 内存峰值 | ~100MB | ≤ 5MB |
| 提取 500 页 PDF 内存 | ~50MB（全量文本） | ≤ 10MB（20页/批） |
| 5 个文档同时处理 | 5× 内存叠加，可能 OOM | 排队处理，最多 2× |
| 大图提取 | 无上限，可能 OOM | 单张 ≤ 5MB，总量 ≤ 50MB |
| 30 个 slide 讲解生成 | 30 个协程同时创建 | 分 6 批，每批 5 个 |
