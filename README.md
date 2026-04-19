# It Clicks（这也能代）

**中文** · AI 情绪结构短文本产品，面向代餐 / 同人圈层；当前主力版本为 **v1.2**（刷流 Feed + 自定义生成）。  
**English** · An AI-powered short-form emotional text product for fandom / “stand-in” communities; the **v1.2** line is the current focus (feed browsing + custom generation).

### 一句话简介

- **中文**：面向同人 / 代餐圈层的 AI 短文本产品；**v1.2** 为「刷流 + 定制」双轨，生成控制从纯禁止规则演进到 **五维 Schema 协议**（关系 / 形式 / 强度 / 钩子 / 气质），后端 **Node + SQLite**，模型 **DeepSeek**。
- **English**: AI short-form emotional text for fandom / stand-in communities. **v1.2** combines a **feed** with **custom generation**, evolving generation control from negative rules to a **five-dimensional schema protocol** (relation, form, intensity, hook, tone). Stack: **Node**, **SQLite**, **DeepSeek**.

---

## 中文

### 简介

It Clicks 迭代重心已从早期「关系驱动写作 IDE」（v1.1）收敛为 **轻内容刷流 + 表达出口**（v1.2）：用户在信息流中获得情绪共鸣，再通过 1–3 句输入生成「差一点」风格的定制短句。技术栈为 **Node.js（Express）+ 静态前端 + SQLite**，大模型调用 **DeepSeek API**。

更完整的版本脉络与生成控制演进见仓库内 [`technical_iteration_summary.md`](technical_iteration_summary.md)。

### 生成控制（摘要）

项目里「生成控制」的演化是从 **「告诉模型不要做什么」** → **「要产出什么关系状态」** → **「按一份协议严格执行」**。各代差异很大，当前 **v1.2** 同时存在两套管线：

| 场景 | 控制思路 | 实现要点 |
|------|----------|----------|
| **刷流（feed pool）** | 沿用 **v1.1.3 二维系统**：张力模式 × 表达形式（如 `core_action` / `contrast` / `suspended` 与 `high_concept` / `daily_scene` / `emotional_line`） | 预生成内容写入 SQLite，供 `/api/feed` 消费 |
| **定制（`/api/customize`）** | **Prompt Schema v1.0 五维锁定**：关系逻辑（10 类张力类型）、表达形式、强度、钩子机制、风格气质（含 `tone` 连续维度） | **Plan → Write** 双阶段思路；用户输入经 **`extract_schema.js`（规则抽取）** → **`schema_engine.js`（Schema → Prompt）** → Writer；可选 **RAG** 仅锚定气质与结构模板，禁止拼贴情节 |

其它代际速览：**v0** 纯系统禁止规则；**v1.0** 引入 Writer + **Critic** 与一次重试；**v1.1** 强制结构化 `relation_state` 与关系操作（`deepen` / `perspective` / `reveal`）等。详见 [`technical_iteration_summary.md`](technical_iteration_summary.md) 第二节。

**已知缺口（与生成质量相关）**：定制层 **Critic**（语感 / 张力 / 长度闸门）尚未落地；**结构抽取**仍为关键词规则版，复杂输入映射五维可能不准；刷流与定制两套控制字段不完全对齐，后续分析需统一口径。细节见该文档第三、四节。

### 仓库结构（摘要）

| 路径 | 说明 |
|------|------|
| [`v1.2/`](v1.2/) | **当前推荐**：前端静态页、`backend/server.js`、RAG 语料与脚本、`Dockerfile` |
| `v1.1/`、`v1.0/` | 历史版本，保留对照 |
| 根目录 | 质量标准、迭代总结等文档 |

v1.2 目录说明与路由入口见 [`v1.2/README.md`](v1.2/README.md)。

### 本地运行（v1.2）

1. **环境变量**  
   在 `v1.2/backend/` 下将 [`.env.example`](v1.2/backend/.env.example) 复制为 `.env`，填写 `DEEPSEEK_API_KEY`（必填）；可选 `PORT`（默认 `3000`）、`ADMIN_TOKEN`（管理接口保护，见 `server.js`）。

2. **安装与启动**

   ```bash
   cd v1.2/backend
   npm install
   npm start
   ```

3. **访问**  
   浏览器打开 `http://localhost:<PORT>`（默认 3000）。首屏为刷流；内容池不足时启动流程会尝试补齐。

> **安全**：请勿将真实 `.env` 提交到 Git；仓库根目录 [`.gitignore`](.gitignore) 已忽略常见密钥与环境文件。

### 部署提示

- **简单方案**：服务器直接运行 Node，保证 `v1.2/backend/logs` 可写（SQLite 与运行日志）。环境变量同上。  
- **容器**：`v1.2` 下提供 `Dockerfile`（构建上下文一般在 `v1.2/` 目录）。生产级 compose / nginx 可参考 [`v1.2/deploy-check.md`](v1.2/deploy-check.md) 中的说明与缺口。

### API（v1.2 摘要）

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/health` | 健康检查 |
| `GET` | `/api/feed` | 刷流列表（`cursor`、`limit`） |
| `POST` | `/api/customize` | 自定义生成（`input`，可选 `ref` 等） |
| `POST` | `/api/generate` | 保留：seed / relation 等生成 |
| `POST` | `/api/log-action` | 埋点 |

详细行为与页面路由见 [`v1.2/README.md`](v1.2/README.md)。

---

## English

### Overview

It Clicks evolved from an earlier “relationship-driven writing IDE” (v1.1) toward a **lightweight feed plus a small expression outlet** (v1.2): users browse an emotional feed, then optionally submit 1–3 short lines to generate customized “almost-there” style text. The stack is **Node.js (Express) + static frontend + SQLite**, with **DeepSeek** as the LLM backend.

For version history and generation-control evolution, see [`technical_iteration_summary.md`](technical_iteration_summary.md).

### Generation control (summary)

Internally, control evolved from **“tell the model what not to do”** → **“target a relationship state”** → **“follow a locked protocol.”** In **v1.2** two pipelines coexist:

| Scenario | Control model | Implementation notes |
|----------|----------------|----------------------|
| **Feed pool** | **v1.1.3 two-axis** system: tension mode × expression form (e.g. `core_action` / `contrast` / `suspended` × `high_concept` / `daily_scene` / `emotional_line`) | Pre-generated rows in SQLite for `/api/feed` |
| **Customization (`/api/customize`)** | **Prompt Schema v1.0** — five dimensions: relation logic (10 tension families), form, intensity, hook, stylistic tone | **Plan → Write**; input passes **`extract_schema.js` (rule-based extraction)** → **`schema_engine.js` (schema → prompt)** → Writer; optional **RAG** styles tone/form only, no plot pasting |

Quick lineage: **v0** — negative rules only; **v1.0** — Writer + **Critic** + one retry; **v1.1** — structured `relation_state` and relation ops (`deepen` / `perspective` / `reveal`). See Section 2 of [`technical_iteration_summary.md`](technical_iteration_summary.md).

**Known gaps**: customize-path **Critic** (voice / tension / length gate) not shipped yet; **schema extraction** is still keyword rules, so messy inputs may map poorly to five dimensions; feed vs customize telemetry fields are not fully aligned for analysis. Sections 3–4 of the same doc spell this out.

### Repository layout (short)

| Path | Notes |
|------|--------|
| [`v1.2/`](v1.2/) | **Recommended**: static frontend, `backend/server.js`, RAG assets/scripts, `Dockerfile` |
| `v1.1/`, `v1.0/` | Older snapshots for reference |
| Repo root | Quality standards, iteration notes, etc. |

Entry points and routes for v1.2 are documented in [`v1.2/README.md`](v1.2/README.md).

### Local run (v1.2)

1. **Environment**  
   Under `v1.2/backend/`, copy [`.env.example`](v1.2/backend/.env.example) to `.env` and set `DEEPSEEK_API_KEY` (required). Optional: `PORT` (default `3000`), `ADMIN_TOKEN` (admin route protection—see `server.js`).

2. **Install and start**

   ```bash
   cd v1.2/backend
   npm install
   npm start
   ```

3. **Open**  
   Visit `http://localhost:<PORT>` (default 3000). The home view is the feed; the pool may be topped up on startup if needed.

> **Security**: Do not commit real `.env` files. The root [`.gitignore`](.gitignore) ignores common secret and env filenames.

### Deployment notes

- **Simple path**: run Node on the server and ensure `v1.2/backend/logs` is writable (SQLite and runtime logs). Same env vars as above.  
- **Containers**: a `Dockerfile` lives under `v1.2/` (build from that directory). For production compose / nginx gaps and suggestions, see [`v1.2/deploy-check.md`](v1.2/deploy-check.md).

### API (v1.2 summary)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `GET` | `/api/feed` | Feed items (`cursor`, `limit`) |
| `POST` | `/api/customize` | Custom generation (`input`, optional `ref`, etc.) |
| `POST` | `/api/generate` | Legacy: seed / relation flows |
| `POST` | `/api/log-action` | Analytics / logging |

See [`v1.2/README.md`](v1.2/README.md) for full routing and behavior.
