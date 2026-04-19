# It Clicks V1.2

面向代餐圈层的 AI 情绪结构生成产品。刷流（Feed）+ 自定义生成。

## 项目结构

```
v1.2/
├── frontend/
│   ├── index.html    # 刷流页（主入口）
│   ├── customize.html # 自定义生成页（跳新页）
│   ├── seed.html     # 关系原型（隐藏入口）
│   └── canvas.html   # 画布（保留接口）
├── backend/
│   ├── server.js     # Node 服务（保留 /api/generate、/api/log-action、/health；新增 /api/feed、/api/customize）
│   ├── package.json
│   └── logs/         # SQLite + 内容池
├── prdv1.2.md
├── refactor-prep.md
└── README.md
```

## 本地运行

1. 复制环境变量：
  ```bash
   cd backend
   cp ../../v1.1/backend/.env .env   # 或新建 .env，填写 DEEPSEEK_API_KEY、PORT
  ```
2. 安装依赖并启动：
  ```bash
   npm install
   npm start
  ```
3. 浏览器打开 `http://localhost:3000`。首屏为刷流；内容池若不足 10 条会在启动时自动填充到 30 条。

## API（V1.2）

- **保留**：`POST /api/generate`（seed / relation_op）、`POST /api/log-action`、`GET /health`
- **新增**：
  - `GET /api/feed?cursor=&limit=`：刷流列表，返回 `{ items, next_cursor }`
  - `POST /api/customize`：自定义生成，body `{ input, ref? }`，返回 `{ text }`

## 入口说明

- **/**：刷流页（GET /api/feed，无限滑动，卡片底部「试试生成你的版本」→ 跳 customize.html?ref=）
- **/customize.html**：输入 1–3 句 → 调用 /api/customize → 展示结果、复制
- **/seed.html**：关系原型单条 + 换一换/代一代 → 进画布（隐藏入口）
- **/canvas.html**：画布（需从 seed 页「代一代」进入，使用 itclicks-v1.2-session）

重构前准备与规格见 **refactor-prep.md**。