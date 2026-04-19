11. Seed 多轨生成系统（V1.1 完整版）


---

11.1 设计目标

为避免单一 Prompt 风格塌陷，引入多轨生成系统。
Seed 不由单一规则驱动，而由不同“关系生成轨道”构成。

目标：

保持自然分布

避免连续相同风格

避免“刻意狠”

保持可投射性



---

12. SeedMode 枚举

type SeedMode =
  | "relation"        // 关系结构型
  | "semantic_gap"    // 语义断层型
  | "boundary"        // 边界逼近型
  | "daily_tension";  // 日常张力型


---

13. 基础权重

{
  "relation": 0.35,
  "semantic_gap": 0.30,
  "boundary": 0.20,
  "daily_tension": 0.15
}


---

14. Session 多样性控制（策略 B）

14.1 Session State

{
  "last_mode": "relation",
  "last_polarities": [1, 2, 1]
}

仅需存：

最近 1 次 mode

最近 3 次 polarity


无需数据库。


---

14.2 权重调整规则

规则 1：禁止连续相同 mode

若抽到 mode == last_mode：

weight[mode] *= 0.3
重新采样一次


---

规则 2：语义断层防连发

若 last_mode == "semantic_gap"：

weight["semantic_gap"] *= 0.5


---

规则 3：极性过高降温

若最近 3 次 polarity >= 1：

weight["semantic_gap"] *= 0.5
weight["boundary"] *= 0.5
weight["daily_tension"] *= 1.2


---

规则 4：极性过低升温（可选）

若最近 3 次 polarity <= 0：

weight["semantic_gap"] *= 1.2
weight["boundary"] *= 1.2


---

15. 各轨道 System Prompt 规范


---

15.1 relation（关系结构型）

角色

你是“关系结构生成器”。

目标

生成清晰可投射的双人关系状态。

规则

1. 输出 2–3 句。


2. 双方立场清晰。


3. 不出现具体设定。


4. 不解释原因。


5. 不推进剧情。


6. 表达高压缩、干净。


7. 不刻意制造断层。



重点

强调：

对峙

偏爱

不对等

默契

口是心非



---

15.2 semantic_gap（语义断层型）

角色

你是“语义断层生成器”。

目标

制造强弱语义并置的关系片段。

必须满足

1. 至少包含一次“强烈行为/态度 + 日常细节”并置。


2. 不解释。


3. 不补背景。


4. 不文学化。


5. 不推进剧情。



断层形式举例（结构，不是具体内容）

危险行为 + 温和动作

决绝态度 + 生活细节

极端选择 + 平静语气


禁止

刻意煽情

抽象词堆叠

夸张比喻



---

15.3 boundary（边界逼近型）

角色

你是“关系边界推进器”。

目标

让关系逼近不可退让边界。

规则

1. 必须暗示风险或代价。


2. 不写具体事件。


3. 不解释后果。


4. 不下结论。


5. 不极端跳跃。



表达方式

预判

赌

强撑

已知后果



---

15.4 daily_tension（日常张力型）

角色

你是“日常张力生成器”。

目标

用日常动作制造关系张力。

规则

1. 小动作优先。


2. 轻冲突。


3. 不极端。


4. 不解释。


5. 不戏剧化。




---

16. 统一输出格式

所有轨道必须返回：

{
  "text": "生成文本",
  "relation_state": {
    "polarity": -2 | -1 | 0 | 1 | 2,
    "initiative": "A" | "B" | "balanced",
    "tags": ["标签1", "标签2"]
  }
}


---

17. Critic 强化规则

Critic 必须额外检查：

是否过度文学化

是否出现解释

是否与上一条过于相似

是否缺乏关系结构


输出：

{
  "pass": true,
  "issues": [],
  "style_flags": {
    "too_poetic": false,
    "too_explained": false,
    "too_similar_to_last": false
  }
}

若 too_similar_to_last=true：

触发一次重采样（最多 1 次）



---

18. 调用流程（Seed）

1. 读取 sessionState
2. 调整权重
3. 抽取 SeedMode
4. 调用对应 System Prompt
5. 调用 Critic
6. 若失败 → 重试一次
7. 更新 sessionState
8. 返回结果


---

19. 为什么这是“数据集逻辑”

因为你模拟的是：

风格分布

极性分布

结构类型分布


而不是：

强制某种句式


这就是“生成调度层”。


---

20. 重要边界

不要：

让 semantic_gap 成为默认风格

让 boundary 连续出现

让所有文本都高极性


目标不是“句句爆”。

目标是：

> 在一个 Session 中自然出现几条记忆点。
