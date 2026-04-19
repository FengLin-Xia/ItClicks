# 0302 Checklist（生成侧 + Schema，对齐 V1.2）

> 关注点：在不大改前端的前提下，把 Layer 2（自定义生成）升级为「Prompt A 抽取 + Prompt B 按 Schema 生成」的统一引擎，并逐步把 Schema / RAG 纳入生成与分析。

---

## 一、Layer 2：双 Prompt 流程

### 1. Prompt A：意图理解 / 结构抽取

- [x] **定义抽取结果 Schema（v0.1）**
  - `cp`: `{ name_a, name_b }`（可选，用于 tone / RAG，不强制出现在文本中）
  - `situation`: 一句话场景摘要
  - `requested_style`: 用户原句轻度摘要（例如“想要很克制的告白”）
  - `schema`: 完全对齐 `Prompt_Schema_v1.0` 的五维：
    - `relation.primary` / `relation.secondary`
    - `form`
    - `intensity`
    - `hook`
    - `tone`（base_style + 冷度/克制度/具象度）
- [x] **设计 Prompt A 输出协议**
  - 只允许输出一个 JSON 对象（如上结构），禁止多余解释。
  - 约定 fallback：抽不到就用默认组合（如 `relation.primary=情感留白`, `form=micro_scene`, `intensity=medium`, `hook=contrast`）。
- [x] **实现 v0.1 规则版抽取（先不用模型）**
  - 通过简单关键词 / 模式，把用户输入 roughly 映射到 `relation.primary`（等 = 遗弃/等待，不能在一起 = 不能爱 等）。
  - 其余维度先按默认 + 少量 heuristic 设置。
  - 输出对象由 Node 端拼 JSON，给后续 Prompt B 使用，并写入 `generation_logs.schema_json`。
  - 实现于 `backend/extract_schema.js`。

### 2. Prompt B：Schema 写手（统一生成引擎）

- [x] **抽取 preseed 的「Schema → Prompt」逻辑为公共模块**
  - 从 `backend/scripts/preseed_schema_v1.js` 提炼：
    - `buildSystemPromptFromSchema(schema, ragSnippets?)`
    - `buildUserPromptForCustomize(situation)`（80–120 字）
  - 放到 `backend/schema_engine.js`，供 preseed 与 `/api/customize` 共用。
- [x] **让 `/api/customize` 走 Schema Pipeline**
  - 新流程：
    1. 用户 input（+ 可选 ref）
    2. 规则抽取 `extractSchemaFromInput()` → `schema + situation`
    3. （可选）按 `schema.tone.base_style` 抽若干 anchors 做 RAG 片段
    4. `buildSystemPromptFromSchema(schema, anchors)` + `buildUserPromptForCustomize(situation)`
    5. `callWriter` → 文本（parseJSONResult 取 text）
  - 保持 PRD 的生成约束：80–120 字、不直白、高张力。
- [x] **在日志中记录 Schema**
  - 在 `generation_logs` 为 customize 增加 `schema_json` 字段（或等效存储）。
  - `events` 的 `generate_seed_result` properties 中带上主维度（relation_primary / form / intensity / hook），便于后续按 Schema 做分析。

---

## 二、Layer 1：Feed 与 Schema 的轻量对齐

- [x] **扩展 `feed_pool` 结构（可放 v1.2.1 做）**
  - 字段建议：`relation_primary` / `relation_secondary` / `form` / `intensity` / `hook` / `tone_json` / `variant`。
  - 已加列（CREATE + 老库 ALTER）；preseed 插入时同步写上述 Schema 字段；`/api/feed` 仍只查 id/text/created_at，未改。
- [x] **预留「结构均匀分布」的能力**
  - 先不改 `/api/feed` 查询逻辑，只保证表里有 Schema 字段。
  - 后续需要时再按 Schema 做采样策略（如不同 primary 均匀分布）。

---

## 三、RAG：按 Schema 轻接入（可选）

- [x] **复用 preseed 里的 RAG 规范**
  - 只针对 `tone.base_style` / `form` 选 anchors，生成一个 RAG block（语感示例，禁止抄句/抄情节）。server 读 `v1.2/rag/corpus/anchors.jsonl`，与 preseed 同源。
- [x] **给 `/api/customize` 增加「有/无 RAG」开关**
  - 请求体 `use_rag: true` 时注入 3 条 sample 的 anchors；否则不注入。逻辑正确，效果调优可后续做。

---

## 四、埋点 & 分析对 Schema 的透视（与现有 tracking 对齐）

- [x] **在 `generate_seed_result` 事件中透出 Schema 主维度**
  - 在当前 `insertEventServer('generate_seed_result', ...)` 的 properties 中补上：
    - `relation_primary`
    - `form`
    - `intensity`
    - `hook`
  - 值从本次请求的 `extracted.schema` 写入（customize）；预生成场景后续从 feed_pool schema 字段读取。
- [x] **确认分析口径**
  - 用 events 表即可支持：
    - **漏斗**：submit_customize（前端）→ generate_seed_result（status=success/fail）→ user_action（copy_seed / export_image 等）；
    - **分层**：generate_seed_result.properties 含 relation_primary / form / intensity / hook，可按维度做分布与转化分析。
  - 详见下方「分析口径说明」。

---

## 五、执行顺序建议（接下来几周）

1. **定义并实现 Prompt A 的输出 Schema（先规则版）**  
2. **抽 preseed 的 Schema Prompt 引擎为公共模块，并让 `/api/customize` 走 Schema Pipeline**  
3. **在 generation_logs / events 里写入并透出 Schema（schema_json + generate_seed_result properties）**  
4. （有余力再做）调优 Prompt A（从规则版升级成模型抽取版）、按 Schema 做 feed 均匀分布。

---

## 分析口径说明（events 表）

- **漏斗**：同一 session 内 `submit_customize` → `generate_seed_result`（status=success）→ `user_action`（action=copy_seed / export_image 等），用 `request_id` 关联 generation_logs 与 events。
- **分层**：`generate_seed_result` 的 properties 含 `relation_primary`、`form`、`intensity`、`hook`，可做各维度下的成功率、人均次数、后续 copy/export 率等。
- **数据来源**：customize 请求的 schema 来自当次 `extractSchemaFromInput`；预生成 seed 若需透出 Schema，可从 feed_pool 的 schema 列关联（当前 /api/feed 未返回 schema，可按需扩展）。  