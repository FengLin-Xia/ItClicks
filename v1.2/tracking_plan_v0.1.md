埋点说明（Tracking Plan v0.1）

技术栈：Front: HTML/Vanilla JS + Back: Node.js（无登录）

1. 身份体系（无登录）

1.1 ID 定义

device_id：首次访问生成 UUID，存 localStorage，长期稳定（清缓存会丢）

session_id：每次进入站点生成；30min 无操作重置（MVP 可用“页面加载即新 session”简化）

user_id：MVP 直接等于 device_id（为未来登录留接口）

request_id：一次“生成/检索/导出”等关键链路的 trace id（每次 submit 生成一次）

1.2 必填公共字段（所有事件）
字段	类型	必填	说明
event	string	✅	事件名
ts	number	✅	Unix ms
user_id	string	✅	= device_id
device_id	string	✅	localStorage
session_id	string	✅	localStorage/内存
page	string	✅	feed/customize/result
app_version	string	✅	前端写死或从 meta 读
platform	string	✅	web
request_id	string	⭕	生成链路必填
properties	object	✅	事件自定义字段
2. 事件列表、触发时机、字段、去重规则

约定：

客户端事件记录 intent/attempt

服务端事件记录 result（success/fail）（关键路径必须有）

A. 页面与会话
A1 session_start

触发：页面首次可交互（DOMContentLoaded 后）

properties：referrer, entry_url

log_action：SESSION_START

A2 view_page

触发：进入页面并完成首屏渲染（feed/customize/result）

properties：page, url

log_action：PAGE_VIEW

B. Feed 刷流曝光与深度
B1 view_feed

触发：feed 列表数据加载完成并渲染

properties：feed_mode（random/no_reco）, initial_count

log_action：FEED_VIEW

B2 view_seed

触发：seed 卡片满足曝光阈值（建议：在视口内 ≥600ms 且可见面积≥60%）

properties（建议最小集合）：

seed_id

position（从1开始）

seed_origin（published_700/submission_top20_821/submission_all_4000/llm_generated）

tension_type（可空）

is_customized（bool）

is_rag（bool）

去重：同 session_id + seed_id 只记一次

log_action：FEED_IMPRESSION

B3 scroll_depth

触发：滚动深度到达阈值：10/25/50/75/90

properties：depth_percent, max_position_seen

去重：同 session 每个档位只记一次

log_action：FEED_SCROLL

C. 定制与生成链路（关键）
C1 click_customize

触发：点击“定制/换头/生成我的”

properties：entry（feed_top/seed_card/result）

log_action：CTA_CLICK

C2 submit_customize

触发：点击“生成”按钮（发起请求前）

必须生成：新的 request_id

properties（建议）：

relationship_type（枚举）

desired_tension_type（枚举/可空）

has_roles（bool，不建议上传具体姓名）

input_length（字符数）

log_action：CUSTOMIZE_SUBMIT

C3 generate_seed_attempt

触发：前端已发起 /generate 请求（fetch 发出）

properties：request_id, is_rag

log_action：GEN_ATTEMPT

C4（服务端）generate_seed_result

触发：Node 生成接口完成（成功/失败都记）

properties：

request_id

status（success/fail）

latency_ms

error_code（失败必填）

is_rag

rag_profile（如 v1_mixA20_B30_C50）

ref_pack_size（引用条数）

seed_id（成功时生成结果id）

log_action：GEN_RESULT

C5 click_regenerate

触发：结果页点击“再来一条”

properties：prev_request_id, prev_seed_id

log_action：REGENERATE_CLICK

D. 互动与转化
D1 collect_seed

触发：收藏 toggle（本地收藏也照样埋）

properties：seed_id, collect_state（on/off）

log_action：CONTENT_COLLECT_TOGGLE

D2 copy_seed

触发：复制成功（navigator.clipboard.writeText resolved）

properties：seed_id, copy_len

log_action：CONTENT_COPY

D3 export_image_attempt

触发：点击导出按钮（开始渲染前）

properties：seed_id, template_id

log_action：EXPORT_ATTEMPT

D4 export_image

触发：导出成功（canvas 转 blob/下载完成后）

properties：seed_id, template_id, image_size, latency_ms

log_action：EXPORT_SUCCESS

D5 share_seed

触发：触发分享动作（Web 常拿不到 success，就记 attempt）

properties：seed_id, channel（link/other）

log_action：SHARE_ATTEMPT

1. log-action / 日志对应关系（统一枚举）

event	log_action
session_start	SESSION_START
view_page	PAGE_VIEW
view_feed	FEED_VIEW
view_seed	FEED_IMPRESSION
scroll_depth	FEED_SCROLL
click_customize	CTA_CLICK
submit_customize	CUSTOMIZE_SUBMIT
generate_seed_attempt	GEN_ATTEMPT
generate_seed_result	GEN_RESULT
click_regenerate	REGENERATE_CLICK
collect_seed	CONTENT_COLLECT_TOGGLE
copy_seed	CONTENT_COPY
export_image_attempt	EXPORT_ATTEMPT
export_image	EXPORT_SUCCESS
share_seed	SHARE_ATTEMPT
4. 上报接口与落库约定（Node）
4.1 HTTP 接口

POST /track

Body：

{
  "event": "view_seed",
  "ts": 1710000000000,
  "user_id": "xxx",
  "device_id": "xxx",
  "session_id": "xxx",
  "page": "feed",
  "app_version": "0.1.0",
  "platform": "web",
  "request_id": "optional",
  "properties": { "seed_id": "s1", "position": 3 }
}
4.2 服务端补充字段（Node 自动加）

ip（可选，注意合规）

ua

received_at

4.3 最小表结构（Postgres/MySQL/SQLite 都行）

events

id uuid

event text

ts bigint

user_id text

device_id text

session_id text

page text

request_id text null

properties json

ua text null

ip text null

received_at bigint

1. 去重与幂等（必须实现的两条）

view_seed 去重：前端内存 Set 维护 seenSeedsInSession
key = ${session_id}:${seed_id}

generate_seed_result 幂等：服务端以 request_id 做唯一键

同 request_id 重复写入：更新为最新状态 or 忽略（看你重试策略）

1. 前端最小实现模板（纯 HTML/JS 可直接用）

你可以把这段当作 analytics.js

// analytics.js
(function () {
  const APP_VERSION = "0.1.0";
  const PLATFORM = "web";

  function uuid() {
    // 浏览器支持 crypto.randomUUID 就用它
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    // fallback
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getOrCreate(key, creator) {
    let v = localStorage.getItem(key);
    if (!v) {
      v = creator();
      localStorage.setItem(key, v);
    }
    return v;
  }

  const device_id = getOrCreate("device_id", uuid);

  // MVP：每次页面加载一个 session；想做 30min 续期再升级
  const session_id = getOrCreate("session_id", uuid);

  function basePayload(event, properties = {}, request_id = null) {
    return {
      event,
      ts: Date.now(),
      user_id: device_id,
      device_id,
      session_id,
      page: window.**PAGE** || "unknown",
      app_version: APP_VERSION,
      platform: PLATFORM,
      request_id,
      properties
    };
  }

  async function track(event, properties = {}, request_id = null) {
    const payload = basePayload(event, properties, request_id);
    // 失败不阻塞主流程：fire and forget
    try {
      await fetch("/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true
      });
    } catch (e) {}
  }

  // 暴露到全局
  window.Analytics = {
    track,
    uuid,
    device_id,
    session_id
  };
})();
7. 你现在立刻能用的“埋点验收清单”

打开页面：session_start、view_page

进入 feed：view_feed

看 3 条：至少 3 次 view_seed

滚动到 50%：scroll_depth depth=50

点定制并生成：click_customize → submit_customize → generate_seed_attempt →（服务端）generate_seed_result success

收藏/复制/导出：对应事件都能在库里查到

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