# V1.2 上线前检查（截至当前）

## 一、功能闭环情况

| PRD/清单项 | 状态 | 说明 |
|------------|------|------|
| Layer 1 刷流 | ✅ | feed_pool、随机+exclude、竖向 scroll-snap 单卡、卡片导出 |
| Layer 2 自定义 | ✅ | 1–3 句输入、Schema Pipeline（规则抽取+写手）、80–120 字、可选 RAG |
| 可分享/导出卡片图 | ✅ | 刷流页 + 自定义页均接 card-export.js |
| 埋点与指标 | ✅ | session_start/view_page/view_seed/scroll_depth/submit_customize/generate_seed_result/copy_seed/export_image/user_action，events 表 + generate_seed_result 带 Schema 维度 |
| 结构抽取 | ✅ | extract_schema.js 规则版 |
| RAG 语感 | ✅ | /api/customize 支持 use_rag，读 rag/corpus/anchors.jsonl |
| 自定义 Critic | ⚠️ 未做 | 可选；当前仅靠 Prompt 约束，无后端校验重试 |

结论：**核心功能已闭环，只剩部署与环境即可上线。**

---

## 二、部署现状

| 项 | 状态 | 说明 |
|----|------|------|
| 本地运行 | ✅ | `cd v1.2/backend && npm install && npm start`，前端由 server 挂载 `../frontend` |
| Docker/nginx | ❌ 未做 | v1.2 下暂无 docker-compose.yml、nginx.conf |

若要上生产，建议二选一：

- **方案 A（简单）**：服务器上直接跑 Node，对外 3000（或反向代理到 80/443）。需保证 `backend/logs` 可写（SQLite + 日志），环境变量见下。
- **方案 B（与 v1.1 同构）**：在 v1.2 下补一份 docker-compose.yml + nginx.conf，前端由 nginx 提供，/api/ 与 /track 反代到 backend。

---

## 三、环境与依赖

- **必须**：`DEEPSEEK_API_KEY`（backend/.env 或环境变量）。
- **可选**：`PORT`（默认 3000）。
- **数据**：SQLite 使用 `backend/logs/generation_logs.db`，启动时自动建表；需保证 `backend/logs` 存在且可写。
- **RAG**：可选；若使用 use_rag，需保证 `v1.2/rag/corpus/anchors.jsonl` 存在（与 backend 同机或挂载）。

---

## 四、建议动作

1. **上线前**：在服务器配置好 `DEEPSEEK_API_KEY` 与 `PORT`（若不用 3000），确认 `logs` 目录可写。
2. **需要容器化时**：在 v1.2 下新增 docker-compose.yml + nginx.conf（可参考 v1.1），并增加对 `/track` 的反代（与 `/api/` 一致）。
3. **文档**：0301-PRD-GAP.md 写于早期，当前多项已实现（结构抽取、RAG、导出、埋点），可择机更新避免误导。

**总结：功能侧已就绪，现在主要差「部署方式」；不要求 Docker 的话，直接 Node 起服务即可上线。**
