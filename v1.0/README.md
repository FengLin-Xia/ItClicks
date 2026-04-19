# It Clicks v1.0

## 项目结构

```
v1.0/
├── frontend/           # 前端代码
│   ├── index.html     # 起始页
│   ├── canvas.html    # 画布页
│   └── style.css      # 样式文件
├── backend/           # 后端代码
│   ├── server.js      # Node.js 服务器
│   ├── package.json
│   └── .env           # 环境变量（包含 API 密钥）
├── nginx.conf         # Nginx 配置
└── docker-compose.yml # Docker 编排
```

## 部署到 Lighthouse

1. 停止旧容器
2. 上传项目
3. 使用 docker-compose 启动

```bash
docker stop itclicks && docker rm itclicks
docker-compose up -d
```

## 功能

- **起始页**：自动生成 seed / 换一换 / 代一代
- **画布页**：可编辑 / 继续一段 / 改写选中
- **后端 API**：DeepSeek 代理 + 限流（30次/分钟）
- **Writer Prompt**：高质量生成器

## API

### POST /api/generate

Request:
```json
{
  "mode": "seed" | "assist",
  "op": "continue" | "rewrite",
  "hint": "一句名字/感觉/否定",
  "context": {
    "selected": "选中文本",
    "around_cursor": "光标附近",
    "tail": "末尾片段"
  },
  "state": {
    "tone": "restrained" | "intense"
  }
}
```

Response:
```json
{
  "text": "生成文本",
  "meta": {
    "retry": 0,
    "critic": {
      "pass": true,
      "confidence": 0.86,
      "problems": []
    }
  }
}
```
