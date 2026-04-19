Prompt Spec V1.1.2

Expression × Relation × Detail Anchor 装配式生成系统

1. 设计哲学

本系统采用三维生成结构：

1️⃣ Expression Layer —— 决定“怎么说”
2️⃣ Relation Layer —— 决定“说什么”
3️⃣ Detail Anchor —— 决定是否通过物理细节泄露情绪

目标：

保持自然度

避免句式套路

避免反差过度

保持可投射性

控制“干”与“设计感”

2. 生成结构总流程

expression = pickExpression() relation = pickRelation() detail_anchor = random(50%) composePrompt(expression, relation, detail_anchor) generate critic return 

3. Expression Layer（表达层）

Expression 只控制语言形态，不控制关系结构。

3.1 concept（高概念短句）

气质

压缩

对位

干净

克制

规则

输出 2–3 句

不写背景

不解释原因

不推进剧情

不堆砌形容词

允许语义对位或并置

不强制细节（除非 detail_anchor=true）

3.2 daily_real（真实生活片段）

气质

具体

自然

有身体

不戏剧化

规则

输出 2–3 句

禁止抽象情绪词堆叠

必须有至少一个具体动作或物件（若 detail_anchor=true）

不解释

不夸张

不象征化

3.3 declaration（情绪化宣言）

气质

直接

态度清晰

有冲击

少细节

规则

至少一句为明确态度表达

不写背景

不写因果

不抒情化

细节非必须（除非 detail_anchor=true）

4. Relation Layer（关系结构层）

Relation 决定关系骨架，不决定表达形式。

4.1 steady（稳定型）

不反差

不断层

不极端

关系立场明确

单向或双向稳定结构

4.2 relation（常规关系对位）

双方立场清晰

可对峙或偏爱

不解释

4.3 semantic_gap（语义断层）

强烈行为或态度

与平静语气或日常内容并置

不解释

不夸张

4.4 boundary（边界逼近）

暗示不可退让

有风险或代价

不升级剧情

不下结论

4.5 daily_tension（日常张力）

小动作

微妙对抗

轻压迫

4.6 persona_contrast（人设反差）

性格反差通过行为呈现

禁止标签式表达

不写“他是圣人”这类直述

5. Detail Anchor（细节锚点机制）

5.1 概念

Detail Anchor 决定是否通过“具体物理细节”承载情绪。

默认概率：50%

5.2 当 detail_anchor = true 时

必须：

包含至少一个具体可感知的细节 

动作

物件

数量

重复

顺序错位

轻微失误

必须满足：

细节不解释情绪

不象征化

不明显服务情绪

例如结构类型：

过度：盘子里已经有五个

重复：又打开

多余：还问她要不要

轻微失误：削断

5.3 当 detail_anchor = false 时

不强制细节

可以纯关系表达

不得因此变抽象化

6. 权重建议

Expression

daily_real: 0.4

concept: 0.35

declaration: 0.25

Relation

steady: 0.25

relation: 0.2

daily_tension: 0.2

semantic_gap: 0.15

boundary: 0.1

persona_contrast: 0.1

Detail Anchor

true: 0.5

false: 0.5

7. 组合约束

不允许 declaration + boundary + semantic_gap 同时出现

若上一条为 semantic_gap 且 detail_anchor=true，则下一条降低 semantic_gap 权重

不允许连续两条 expression 相同

8. 输出格式

统一返回：

{ "text": "生成文本", "meta": { "expression": "concept | daily_real | declaration", "relation": "steady | relation | semantic_gap | boundary | daily_tension | persona_contrast", "detail_anchor": true, "relation_state": { "polarity": -2 | -1 | 0 | 1 | 2, "initiative": "A | B | balanced" } } } 

9. 总体目标

系统目标不是：

每条都狠

每条都反差

每条都断层

而是：

自然分布

偶尔出现记忆点

多数文本可投射

少数文本成为爽点

10. 设计核心总结

Expression 决定语气
Relation 决定结构
Detail Anchor 决定身体感

三者组合形成：

自然度 × 爽点 × 可读性