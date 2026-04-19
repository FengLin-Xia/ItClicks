# Tracking Plan v0.1 与当前 v1.2 构建的冲突说明

对照 `tracking_plan_v0.1.md` 与当前后端/前端实现，以下为不一致或缺失处，需在落实现划时二选一：改实现，或改方案。

---

## 一、接口与存储


| Tracking Plan 要求                                                                                                     | 当前构建 | 冲突说明                                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **POST /track**，Body：event, ts, user_id, device_id, session_id, page, app_version, platform, request_id?, properties | 无此接口 | 当前只有 **POST /api/log-action**，Body 仅 `{ request_id, action }`，且用于 **UPDATE generation_logs.user_action**，不是“写入一条事件”。要实现 plan 需：**新增 POST /track**，或扩展 log-action 的入参与语义（见下）。 |
| 新表 **events**（id, event, ts, user_id, device_id, session_id, page, request_id, properties, ua, ip, received_at）      | 无此表  | 当前只有 **generation_logs**（记录每次 /api/generate 的请求与结果），没有“通用事件表”。要实现 plan 需：**新建 events 表**，或在现有库中增加等价结构。                                                                       |


**结论**：要么新增 `/track` + `events` 表并按 plan 写入；要么沿用 `/api/log-action` 并约定“action = plan 里的 log_action 枚举、其余字段挤在 request_id/别表”，则需在 plan 里明确“MVP 用 log-action 时的字段映射与缺失约定”。

---

## 二、生成链路（定制 → 生成）


| Tracking Plan 描述                                                          | 当前构建                                                  | 冲突说明                                                                                                                                                                |
| ------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C3 **generate_seed_attempt**：前端已发起 **/generate** 请求                       | 自定义生成走 **POST /api/customize**，不走 /api/generate       | 定制链路在 plan 里被写成“发 /generate”，实际是 **/api/customize**。要么 plan 改为“发 /customize 时记 GEN_ATTEMPT”，要么后端把 customize 也视为一种 generate 并统一记 request_id。                         |
| C4 **generate_seed_result**：Node **生成接口**完成时记 status/latency_ms/seed_id 等 | /api/customize 不返回 **request_id**、**seed_id**，也不写任何事件 | 当前 customize 只返回 `{ text }`，没有 request_id/seed_id；且没有“生成完成时写一条 GEN_RESULT”的逻辑。要实现 C4 需：customize 内部生成 request_id、成功/失败时写 events（或 log-action），并在响应里可选返回 request_id。 |
| **request_id**：一次生成链路的 trace id，每次 submit 生成一次                            | 前端未生成 request_id；/api/customize 未返回 request_id        | 若要做“一次定制生成一条结果事件”，需在前端 submit 时生成 request_id 并随请求带上（或后端生成并返回），且服务端在完成时用同一 request_id 写 GEN_RESULT。                                                                  |


**结论**：生成相关事件（GEN_ATTEMPT / GEN_RESULT）目前与 /api/customize 无绑定，需在接口与后端逻辑上对齐（request_id 生成与回写、结果事件写入）。

---

## 三、Feed 与卡片数据


| Tracking Plan 要求（如 view_seed 的 properties）                              | 当前构建                                          | 冲突说明                                                                                               |
| ----------------------------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| **seed_id**                                                             | feed 项有 **id**（即 feed_pool.id）                | 可等价：seed_id = 当前 item.id，无冲突。                                                                      |
| **seed_origin**（published_700 / submission_top20_821 / llm_generated 等） | feed_pool 仅 **id, text, created_at**，无来源/类型字段 | **无法按 plan 填 seed_origin**。要么扩展 feed_pool 表与接口返回（如加 origin/tension_type），要么 plan 里 MVP 约定“无则空/默认”。 |
| **tension_type**、**is_customized**、**is_rag**                           | 同上，表中无这些字段                                    | 同上，当前数据无法提供，需扩展表或 plan 放宽。                                                                         |


**结论**：view_seed 等依赖的“种子元数据”当前不全，要么改表与 GET /api/feed 返回，要么在 plan 里标明“MVP 不报或报空”。

---

## 四、前端能力与事件


| Tracking Plan 事件                                                                                      | 当前页面/能力                            | 冲突说明                                                                               |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| **D1 collect_seed**（收藏 toggle）                                                                        | 无收藏功能、无收藏按钮                        | **无对应交互**。要么加“收藏”并埋点，要么 plan 里 MVP 不要求 collect_seed。                               |
| **C5 click_regenerate**（结果页“再来一条”）                                                                    | 自定义结果页只有“复制文案”“导出图片”，**无“再来一条”按钮** | 要么在结果页加“再来一条”并埋 C5，要么 plan 里 MVP 不要求或改为“同一页再次点击生成”等替代口径。                           |
| **C2 submit_customize** 的 properties：relationship_type, desired_tension_type, has_roles, input_length | 表单只有**一段自由输入**，无类型/张力/角色选择         | 目前只能上报 **input_length**（及 ref 是否存在等），其余字段 plan 需标“可选/暂无”。                          |
| **D5 share_seed**（channel: link/other）                                                                | 有“导出图片”，无独立“分享”入口                  | 可将“导出图片”视为 share attempt（channel=other 或 export）并在 plan 里约定，否则需明确“分享”与“导出”是否算同一事件。 |


**结论**：部分事件在现有 UI 上无对应操作（收藏、再来一条），需补交互或改 plan 的 MVP 范围；部分 properties 当前只能部分填充（submit_customize、view_seed）。

---

## 五、log-action 与 plan 的“log_action”枚举


| 说明                                                                                | 冲突点                                                                                                                                                                              |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan 中每个 event 对应一个 **log_action** 枚举（如 SESSION_START、CTA_CLICK、EXPORT_SUCCESS 等） | 当前 **/api/log-action** 的 `action` 为自由字符串，且语义是“更新某次生成的 user_action”（原为采纳/放弃等），**没有**与 plan 的 event/log_action 一一对应，也没有写入 events 表。                                                |
| 若 MVP 不新增 /track 和 events 表，而是复用 log-action                                       | 需约定：log-action 的 body 扩展为可传 event/ts/device_id/session_id/page/properties 等，或至少 action 使用 plan 的 log_action 枚举；并约定“写到哪里”（例如仍只更新 generation_logs 的某列，或同时写 events 表）。否则“统一枚举”无法落地。 |


**结论**：要么实现 /track + events，按 plan 的 event/log_action 写入；要么在 plan 里单独写一节“MVP 用 log-action 时的约定”，明确 body 形态与枚举与落库方式。

---

## 六、其他

- **session_id**：Plan 文档写“每次进入站点生成”或“30min 无操作重置”，但 6 节前端模板里用 `getOrCreate("session_id", uuid)`，导致 **session 持久化**，与“每次进入即新 session”不符。实现时若按“每次加载新 session”，需改为每次 load 生成新 session_id，而非 getOrCreate。
- **page**：Plan 取值为 feed/customize/result。当前页有 index（=feed）、customize（=customize）；“result”可理解为 customize 页生成完成后的状态，无独立 URL，需约定前端如何设置 page=result（例如生成成功后置为 result）。

---

## 七、汇总：要落地 plan 需要做的选择

1. **接口与表**：上 **POST /track + events 表**，还是扩展 **/api/log-action** 并约定 body/枚举与落库？
2. **生成链路**：**/api/customize** 是否生成并返回 **request_id**，并在完成时写 **generate_seed_result**（或等价的 GEN_RESULT）？
3. **Feed 元数据**：是否扩展 **feed_pool** 与 **GET /api/feed**，提供 seed_origin/tension_type 等，还是 MVP 不报/报空？
4. **前端**：是否增加**收藏**、**再来一条**，并对应埋点；以及 **submit_customize** / **view_seed** 的 properties 是否接受“部分字段暂无”。
5. **session_id**：实现是否按“每次进入新 session”改前端，与 plan 文档一致。

以上冲突在开发埋点前对齐即可避免返工。