# 这也能代 v0

## 快速开始

1. 编辑 `index.html`，将 `YOUR_DEEPSEEK_API_KEY_HERE` 替换为你的 DeepSeek API 密钥
2. 双击 `index.html` 在浏览器中打开

## 本地运行

```bash
# 使用 Python
python -m http.server 8000
# 打开 http://localhost:8000

# 使用 Node.js
npx serve
# 打开 http://localhost:3000
```

## 部署到 Lighthouse

项目将使用 Nginx 托管静态 HTML 文件。

## API 配置

当前使用 DeepSeek API，如需更换：
- 修改 `index.html` 中的 `API_URL` 和 `API_KEY`
- 调整 `messages` 格式以适配其他 API
