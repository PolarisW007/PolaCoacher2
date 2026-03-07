# AICoacher 2.0 — AI 藏经阁

> 重构你的学习体验

基于 AI 的智能文档学习与知识传播平台。

## 技术栈

- **后端**: Python + FastAPI + PostgreSQL + SQLAlchemy + Celery + Redis
- **前端**: React 18 + Vite 5 + Ant Design v5 + React Router v6
- **AI**: 阿里云 DashScope (Qwen Plus / CosyVoice / 通义万象)

## 快速开始

### 后端

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env    # 编辑配置
uvicorn app.main:app --host 0.0.0.0 --port 8765 --reload
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

访问 http://localhost:5173

## 项目结构

```
AICoacher2.0/
├── backend/
│   ├── app/
│   │   ├── api/endpoints/     # API 路由
│   │   ├── core/              # 配置、数据库、安全
│   │   ├── models/            # SQLAlchemy 模型
│   │   ├── schemas/           # Pydantic 模型
│   │   ├── services/          # 业务逻辑
│   │   └── utils/             # 工具函数
│   ├── data/                  # 文件存储
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── api/               # API 请求
│   │   ├── components/        # 通用组件
│   │   ├── layouts/           # 布局组件
│   │   ├── pages/             # 页面组件
│   │   ├── store/             # 状态管理
│   │   └── styles/            # 样式文件
│   └── package.json
└── README.md
```
