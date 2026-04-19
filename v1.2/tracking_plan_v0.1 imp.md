Tracking Plan v0.1-impl（对齐当前实现）
0. 基本边界：两条线，别再混

A. 生成业务日志（已有）：generation_logs（每次生成一行）

负责：请求/响应、状态机、critic、final_text、user_action、耗时

B. 行为埋点事件流（新增）：events（每个行为一行，append-only）

负责：会话、曝光、滚动、点击、复制、导出、提交、attempt/success

/api/log-action 继续只做：更新 generation_logs.user_action
/track 专门做：插入一条事件

1. 接口与存储（v0.1-impl 选择）

1.1 新增接口（✅必须）

POST /track
Body（统一事件格式）：

{
  "event": "view_seed",
  "ts": 1710000000000,
  "user_id": "anon_xxx",
  "device_id": "dev_xxx",
  "session_id": "sess_xxx",
  "page": "feed",
  "app_version": "1.2.0",
  "platform": "web",
  "request_id": "optional",
  "properties": { "seed_id": "123", "position": 3 }
}
1.2 新增表（✅必须）

events（SQLite 版，最小字段）

id INTEGER PK AUTOINCREMENT

event TEXT NOT NULL

ts INTEGER NOT NULL （客户端时间 ms）

user_id TEXT NOT NULL （MVP = device_id）

device_id TEXT NOT NULL

session_id TEXT NOT NULL

page TEXT NOT NULL

app_version TEXT NOT NULL

platform TEXT NOT NULL

request_id TEXT NULL

properties TEXT NOT NULL （JSON 字符串）

ua TEXT NULL

ip TEXT NULL

received_at DATETIME DEFAULT CURRENT_TIMESTAMP

1. 身份与 session 口径（无登录）

2.1 ID 规则（✅实施口径）

device_id：localStorage 持久化（长期）

session_id：每次页面 load 新生成（只在内存；不写 localStorage）

user_id：MVP 直接等于 device_id

request_id：由后端生成并返回（你现有表已经以 request_id 为核心）

这能保证：

用户行为可按 device 统计回访（近似留存）

生成链路完全以 request_id 对齐 generation_logs

1. 事件清单（按“已实现 / 部分实现 / 暂不实现”分组）

✅ 已实现（v0.1 必做、立刻可落）

这些事件不依赖你没做的功能（收藏、分享等），且字段现在就能给。

session_start

触发：DOMContentLoaded 后

properties：referrer, entry_url

request_id：无

view_page

触发：页面首屏完成渲染

properties：url

page：feed（index） / customize（customize 页面）

request_id：无

view_seed

触发：feed 卡片曝光（IntersectionObserver：≥600ms 且可见≥60%）

properties（v0.1-impl 最小）：

seed_id（= feed_pool.id）

position

可选 properties（若暂无则不传）：

seed_origin（当前无）

tension_type（当前无）

is_customized（feed 里一般 false）

is_rag（当前无）

去重：同 session_id + seed_id 只记一次

scroll_depth

触发：滚动深度到 10/25/50/75/90

properties：depth_percent, max_position_seen

去重：同 session 每档一次

submit_customize

触发：用户点击“生成”（发请求前）

properties（v0.1-impl）：

input_length（自由输入长度）

mode（固定为 relation_op 或你实际表单模式）

op（若 UI 有：deepen/perspective/reveal；没有就不传）

request_id：不填（因为此时还没拿到后端 request_id）

copy_seed

触发：复制成功

properties：request_id（若结果来自生成）、或 seed_id（若复制 feed 文本），copy_len

request_id：能拿到就填（强烈建议结果页复制带 request_id）

export_image

触发：导出成功（canvas toBlob + download）

properties：request_id 或 seed_id, template_id（可选）, latency_ms（可选）

🟡 部分实现（建议 v0.1 做“最小对齐”）

核心是：让生成链路在 events 里也可追溯，但不强迫你重构 UI。

generate_seed_attempt

触发：前端发起 POST /api/customize

request_id：前端没有就先不填

properties：

endpoint: /api/customize

mode（seed/relation_op）

op（如有）

has_context_tail（bool）

generate_seed_result（服务端事件，v0.1-impl 强烈建议做）

触发：Node 端 /api/customize 完成（成功/失败都写）

request_id：✅必填（后端自己生成）

properties：

status: success/fail

response_time_ms（你表里已有）

retry_count（你表里已有）

critic_pass（你表里已有）

mode, op

seed_id：v0.1 可直接等于 request_id（除非你另建内容表）

error_code（失败必填，自己定义枚举）

这一步的关键收益：你能直接用 events 做“提交→成功率→耗时→导出/复制”的漏斗。

❌ 暂不实现（v0.1 明确不做，避免假埋点）

collect_seed（你现在没有收藏功能）

click_regenerate（你现在没有“再来一条”）

share_seed（你现在没有明确分享入口；导出可作为传播代理）

1. 与 generation_logs 的字段映射（v0.1-impl 核心对齐）

4.1 /api/customize 写入 generation_logs（你现有表）

建议在服务端统一为每次生成写入这些字段：

generation_logs 字段	来源
request_id	后端生成 uuid
mode	请求入参
op	请求入参（relation_op 时）
context_tail	请求入参（可空）
input_state	请求入参（JSON字符串，可空）
writer_raw / writer_parsed	模型输出与解析结果
critic_pass / critic_issues / critic_hint	critic 结果
retry_count	重试次数
final_text	最终文本
final_state	最终状态 JSON
response_time_ms	服务端测量
4.2 同步写 events（服务端补一条结果事件）

当 /api/customize 写完 generation_logs 后，同时 insert 一条 events：

event = generate_seed_result

request_id = generation_logs.request_id

properties 从 generation_logs 拿关键字段（见上节）

1. /api/log-action 的定位（不改语义，只补充追踪）

你当前接口：POST /api/log-action { request_id, action }
它更新：generation_logs.user_action

v0.1-impl 建议：保持 UPDATE 不变，但额外做一件小事：

在处理成功后，同时写一条事件到 events：

event = user_action

request_id 必填

properties：action（采纳/放弃/…）

这样你可以分析：

生成成功 → 用户采纳率

不同 op/mode → 采纳率
而不污染 /api/log-action 的职责。

1. page 取值约定（解决“result 没 URL”）

feed 页：page="feed"

customize 输入态：page="customize"

customize 生成完成展示结果后：前端将 page="result"（只是字段变，不需要新 URL）

1. v0.1-impl 最小交付清单（你们照着做就不会返工）

必做（P0）

新增 events 表

新增 POST /track（insert-only）

前端：device_id（localStorage）、session_id（每 load 新生成）、track()

前端埋点：session_start/view_page/view_seed/scroll_depth/submit_customize/copy_seed/export_image

强烈建议（P1）

/api/customize：后端生成 request_id，写 generation_logs，并写 generate_seed_result 到 events，同时响应返回 request_id

/api/log-action：更新 generation_logs.user_action 后，追加写 user_action 事件到 events

1. 你现在这张 generation_logs 表，v0.1-impl 如何“发挥最大价值”

你已经有很多好字段（critic、final_state、response_time_ms），v0.1-impl 里不用额外建复杂模型就能产出几条关键分析：

生成成功率：generate_seed_result.status

性能：response_time_ms p50/p95

质量代理：critic_pass、critic_issues 分布

用户认可：user_action（采纳/放弃）比例

漏斗闭环：submit_customize（events）→ generate_seed_result.success（events）→ export/copy/user_action（events）