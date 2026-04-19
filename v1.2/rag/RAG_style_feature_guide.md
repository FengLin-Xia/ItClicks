# RAG 风格特征包指南 v0.1

> 本文档说明 Seed Engine 中 RAG 的**定位、数据结构、特征包格式**，并提供基于当前语料（`anchors.jsonl`）的示例，供生成接入与语料扩充参考。

---

## 一、RAG 的定位（重要前提）

**这个 RAG 库检索的不是"内容"，而是"风格锚点"。**

| 项 | 说明 |
|----|------|
| 目标 | 让生成文本在语气、节奏、句长、留白方式上对齐"代餐圈"语感 |
| 不做什么 | 不复制原句、不拼贴情节、不注入具体设定 |
| 在 Prompt 中的位置 | System Prompt 末尾的 `ragBlock`，标注"禁止抄写原句，仅参考语气和结构" |
| 服务的 Schema 维度 | 仅 `tone.base_style` 与 `form` 结构模板 |

---

## 二、锚点数据结构（anchors.jsonl）

每条锚点的字段：

```json
{
  "id": "5264780916687134_0",
  "text": "臣子悄悄在君主耳边说"今夜在您寝宫见"，君主心猿意马心神荡漾兴高采烈等到晚上来到寝宫被臣子劈头盖脸谏了三个时辰句子没重复。",
  "source": "代餐墙",
  "engagement_score": 12674.0,
  "labels": {
    "tension_primary": "位阶张力",
    "tension_secondary": "行为悖论",
    "confidence": 0.88
  },
  "style": {
    "form": "narrative",
    "intensity": "medium",
    "hook": "contrast",
    "tone_base": "east_asian_subtle"
  }
}
```

**当前库状态**：`labels` 字段大部分为空（`{}`），`style.form` 大多为 `"narrative"`，少量为 `"dialogue"`。tension 标注与强度/hook 字段尚未批量补充，是已知缺口。

---

## 三、特征提取逻辑（extract_features.py）

检索到 top-K 锚点后，通过规则方法归纳为一个**风格特征包**，包含 6 个维度：

| 维度 | 字段 | 取值示例 | 含义 |
|------|------|----------|------|
| 平均字数 | `avg_len` | `"42字"` | 锚点文本的平均长度 |
| 标点风格 | `punctuation` | `"短句+省略"` | 短句/顿号/省略号组合 |
| 对话轮数 | `dialogue_turns` | `2` | 引号内对话轮次（上限5） |
| 结尾风格 | `ending` | `"留白"` / `"问句"` / `"感叹"` / `"句号收尾"` | 最后一个标点类型 |
| 钩子位置 | `hook_position` | `"首句短/像hook"` / `"第一句"` | 首句平均长度是否像钩子句 |
| 词汇语气 | `lexical_tone` | `"克制、少形容词、多动词"` / `"形容词较多"` / `"中性"` | 形容词/动词密度粗判 |

---

## 四、特征包示例（按张力类型）

以下示例基于当前语料中高互动条目（engagement ≥ 3000）归纳，`labels` 为人工标注建议值（非当前库实际标注）。

---

### 4.1 行为悖论 × contrast hook × dialogue form

**代表锚点**：
```
"家1：只是在追求家0  家0：有没有懂行的道士来处理一下"
（engagement: 3640）

"家1和家0吵了一架后直接大半夜离开，家0也特别凶的吼他说自己不爱他。
家1半途发现忘带东西回去拿，却看见家0抱着手机一遍遍听着家1很久前的录音 '我永远爱你'"
（engagement: 2961）
```

**归纳特征包**：
```json
{
  "anchor_features": {
    "avg_len": "38字",
    "punctuation": "短句",
    "dialogue_turns": 2,
    "ending": "句号收尾",
    "hook_position": "首句短/像hook",
    "lexical_tone": "克制、少形容词、多动词"
  }
}
```

**生成提示方向**：行为层矛盾要落在具体动作上（说×却做○），不解释心理，结尾留反差空间。

---

### 4.2 位阶张力 × contrast hook × narrative form

**代表锚点**：
```
"臣子悄悄在君主耳边说'今夜在您寝宫见'，君主心猿意马心神荡漾兴高采烈等到晚上来到寝宫被臣子劈头盖脸谏了三个时辰句子没重复。"
（engagement: 12674）

"宠臣在和别人争论的时候使用'我王……''陛下有言……'这种开头和'你知道我老公是谁吗'有什么区别。"
（engagement: 3203）
```

**归纳特征包**：
```json
{
  "anchor_features": {
    "avg_len": "55字",
    "punctuation": "短句+顿号",
    "dialogue_turns": 1,
    "ending": "句号收尾",
    "hook_position": "第一句",
    "lexical_tone": "中性"
  }
}
```

**生成提示方向**：位阶差通过称谓/行为暗示，不明说权力关系，反差出现在第二句。

---

### 4.3 占有欲/吃醋 × contrast hook × narrative form

**代表锚点**：
```
"我宣布吃醋梗就是很爽的.....一个叽里咕噜讲着今天发生的趣事，说完另一方突然开口问：'他是谁？'"
（engagement: 2527）

"我到现在还是觉得接吻不闭眼的人非常吓人，太有侵略感了掌控欲太强了太自信了配得感太高了，而正好家1就是这种人"
（engagement: 2562）
```

**归纳特征包**：
```json
{
  "anchor_features": {
    "avg_len": "40字",
    "punctuation": "短句+省略",
    "dialogue_turns": 1,
    "ending": "问句",
    "hook_position": "首句短/像hook",
    "lexical_tone": "形容词较多"
  }
}
```

**生成提示方向**：占有行为用细节暴露（一个动作/一句话），不用"嫉妒""占有"等直白标签词。

---

### 4.4 反差（角色/情绪反转）× behavioral_paradox hook × narrative form

**代表锚点**：
```
"轻浮系的角色被真心烫到时笑容消失的那瞬间才是最爽的"
（engagement: 2418）

"我的攻是那种生气了把我的受压在身下，所有人包括我的受都以为将会出现🔞，结果我的攻只是委屈地埋在受的胸前嘟囔"
（engagement: 2748）

"家攻最帅的时候是生气到整个脸都冷下来的时候。"
（engagement: 2277）
```

**归纳特征包**：
```json
{
  "anchor_features": {
    "avg_len": "32字",
    "punctuation": "短句",
    "dialogue_turns": 0,
    "ending": "句号收尾",
    "hook_position": "首句短/像hook",
    "lexical_tone": "克制、少形容词、多动词"
  }
}
```

**生成提示方向**：外在行为与内在情绪反向，"破防"不用直接说出，通过行为瞬间承载。

---

### 4.5 情感留白（日常酸涩）× time_cut / contrast hook × narrative form

**代表锚点**：
```
"还泪真的是个很动人的概念，一个人老是为你哭，原来是上辈子受过你的恩惠，这一生要用眼泪还给你。你后来终于明白了这件事，可那个人已经还完了，走了，不再见了。"
（engagement: 2145）

"家产属于是：两人突然官宣了身边人会惊讶的问'原来之前没在谈吗?'的类型"
（engagement: 5157）
```

**归纳特征包**：
```json
{
  "anchor_features": {
    "avg_len": "52字",
    "punctuation": "短句+省略",
    "dialogue_turns": 0,
    "ending": "留白",
    "hook_position": "第一句",
    "lexical_tone": "中性"
  }
}
```

**生成提示方向**：不宣告情绪，用"已经""可""走了"等时间性词承载"太晚了"的感觉，结尾悬住。

---

### 4.6 矛盾拉扯 × behavioral_paradox hook × dialogue form

**代表锚点**：
```
"恋爱是能分手的，结婚是能离婚的，但如果共同策划过谋杀那一辈子都会是共犯了"
（engagement: 2208）

"家1把人吃干抹净就开始哭着道歉，搞的家0身心俱疲还得耐着性子哄他"
（engagement: 7782）
```

**归纳特征包**：
```json
{
  "anchor_features": {
    "avg_len": "35字",
    "punctuation": "短句",
    "dialogue_turns": 0,
    "ending": "句号收尾",
    "hook_position": "首句短/像hook",
    "lexical_tone": "克制、少形容词、多动词"
  }
}
```

**生成提示方向**：靠近与毁灭并存，句子结构用递进或转折暗示撕裂感，不用"痛苦""纠结"等解释词。

---

## 五、特征包如何注入 Prompt

`ragBlock` 在 `buildSystemPromptFromSchema()` 中拼接，注入到 System Prompt 末尾：

```
【RAG 语感锚点（禁止抄写原句，仅参考语气和结构）】
示例片段：
1. {snippet1}
2. {snippet2}
3. {snippet3}

只允许你：粗略学习语气、节奏、句长和留白；对齐圈层语感。
禁止你：复制句子片段、复制情节或设定、用它们补全剧情。
```

当前接入方式（v1.2 实现）：从 `anchors.jsonl` **随机抽取** 若干条作为 snippet，不做 tension/form 过滤（因 `labels` 尚未批量标注）。

**理想方式**（待补标注后实现）：
```
retrieve_anchors(
  tension_primary = schema.relation.primary,
  form = schema.form,
  engagement_min = 2000,
  top_k = 5
)
→ extract_anchor_features(anchor_docs)
→ 将特征包 + top-3 snippet 注入 ragBlock
```

---

## 六、当前语料概况与缺口

| 项 | 现状 |
|----|------|
| 语料来源 | 代餐墙（微博向）高互动代餐/同人内容 |
| 数据量 | 当前 `anchors.jsonl` 约 1155 条（含 0302 批次） |
| engagement 分布 | 多数 2000–5000，极高互动（>10000）约占 5% |
| form 分布 | 约 95% `narrative`，5% `dialogue`；`single`/`lyrical_blank` 缺失 |
| tension 标注 | `labels` 大多为 `{}`，**未批量标注** |
| intensity/hook 标注 | `style` 字段大多只有 `form`，**未标注** |
| 0302-1-无tension 批次 | 与主库相同来源，作为无 tension 标注的对照版本 |

**优先补充方向**：
1. 为高互动条目（engagement ≥ 3000）补 `labels.tension_primary`，即可解锁按张力类型过滤检索
2. 补充 `form=dialogue` 的样本（当前比例过低，dialogue 生成时语感参考弱）
3. 补充 `form=single`（钩子单句）和 `form=lyrical_blank`（留白抒情）样本，这两类在代餐墙中有，但当前未单独标出

---

## 七、高互动代表样本索引

以下为 engagement ≥ 10000 的样本，可优先用于手动标注：

| id | engagement | 张力类型建议 | form | 摘要（前50字） |
|----|-----------|-------------|------|---------------|
| 5262319732654274_0 | 40202 | 反差 | narrative | 比起超雄1我更喜欢看超雄0，生活稍有不顺就连扇老公十个耳光 |
| 5253153169868461_0 | 37562 | 行为悖论 | narrative | 实则对方喝下吐真剂后，你问的每个问题都变得思虑再三的慎重 |
| 5260749213270404_0 | 8660 | 反差 | narrative | 突然想到0被做的迷迷糊糊突然伸手撩开1的刘海看他的眼睛，喃喃着夸好漂亮… |
| 5264780916687134_0 | 12674 | 位阶张力+行为悖论 | narrative | 臣子悄悄在君主耳边说"今夜在您寝宫见"… |
| 5250239717442164_0 | 10854 | 行为悖论 | dialogue | 家0:（在嘴里塞了两块超级酸的橘子）（绷住）（找家1索吻）… |
| 5246298430112112_0 | 14379 | 矛盾拉扯+反差 | narrative | 骨科，，， 弟突发不适进了医院，医生找人签字… |
| 5266592402768418_0 | 7604 | 反差 | narrative | 别嬷我家1了,他只是在cos0,很遗憾cos0=1 |
| 5257563123483290_0 | 7782 | 矛盾拉扯 | narrative | 家1把人吃干抹净就开始哭着道歉，搞的家0身心俱疲还得耐着性子哄他 |

---

## 八、理想设计流程

本节描述 RAG 风格特征系统在**数据完整、标注齐全**状态下的完整运转路径，分为三个阶段：语料建设、检索注入、生成反馈。

---

### 阶段一：语料建设（离线）

```
原始文本（代餐墙 / 其他圈层来源）
    │
    ▼
① 清洗与去重
    - 过滤过短（< 20 字）、重复、无叙事价值的条目
    - 保留 engagement 分值（互动量作为质量代理指标）
    │
    ▼
② 人工 / 半自动标注
    - labels.tension_primary     ← 核心张力类型（位阶张力 / 行为悖论 / 矛盾拉扯 / 反差 / 情感留白 …）
    - labels.tension_secondary   ← 次级张力（可选）
    - style.form                 ← narrative / dialogue / single / lyrical_blank
    - style.intensity            ← low / medium / high
    - style.hook                 ← contrast / time_cut / behavioral_paradox / statement …
    │
    ▼
③ 向量化
    - 将每条 anchor 的 text 用 embedding 模型编码为稠密向量
    - 写入 anchors_vectors.json（与 anchors_ids.json 对齐）
    │
    ▼
④ 入库
    - 最终落地：anchors.jsonl（结构化元数据） + 向量索引（用于语义检索）
```

**当前缺口**：步骤②（tension / intensity / hook 标注）大部分未完成，导致步骤③只能全量向量化，无法按张力过滤。

---

### 阶段二：检索与特征提取（在线，每次生成请求）

```
用户 Schema（由前端收集）
    │  schema.relation.primary  → 张力类型
    │  schema.form              → 叙事形式
    │  schema.tone.base_style   → 语气基调
    │
    ▼
① 过滤检索（Filter → Semantic Re-rank）
    retrieve_anchors(
        tension_primary  = schema.relation.primary,
        form             = schema.form,
        engagement_min   = 2000,
        top_k            = 5
    )
    - 先按 labels.tension_primary + style.form 硬过滤
    - 再对候选集做语义相似度排序，取 top-5
    │
    ▼
② 特征提取
    extract_anchor_features(anchor_docs)
    - 计算 6 维特征包：avg_len / punctuation / dialogue_turns /
      ending / hook_position / lexical_tone
    │
    ▼
③ 构建 ragBlock
    {
      "feature_summary": { ...6 维特征包... },
      "snippets": [ top-3 原文片段 ]    ← 供模型感受语感，禁止直接复制
    }
```

**降级策略**：当 tension 标注缺失时，退回到仅按 `engagement ≥ 2000` + `form` 过滤的随机抽样（即 v1.2 当前实现）。

---

### 阶段三：Prompt 构建与生成

```
System Prompt
    │
    ├── [角色设定 + Schema 核心字段]
    │
    └── [ragBlock 注入，拼接在末尾]
         ┌──────────────────────────────────────────────────┐
         │ 【RAG 语感锚点（禁止抄写原句，仅参考语气和结构）】    │
         │ 特征摘要：                                         │
         │   avg_len=38字 / 短句 / dialogue_turns=2 /        │
         │   ending=留白 / hook=首句短 / lexical_tone=克制    │
         │ 示例片段：                                         │
         │   1. {snippet1}                                   │
         │   2. {snippet2}                                   │
         │   3. {snippet3}                                   │
         │                                                   │
         │ 只允许：粗略学习语气、节奏、句长和留白                │
         │ 禁止：复制句子片段、情节、设定                        │
         └──────────────────────────────────────────────────┘
    │
    ▼
LLM 生成
    │
    ▼
① 质量评估（可选，离线 batch）
    - 生成文本与 top-5 锚点的语义相似度
    - 形容词/动词密度是否对齐特征包
    - 是否存在原句抄写（字面相似度检测）
    │
    ▼
② 反馈回语料库（长期）
    - 高互动生成内容可沉淀为新锚点候选
    - 经人工审核后补充进 anchors.jsonl，形成数据飞轮
```

---

### 全流程总览

```
[语料建设 · 离线]
    原始文本
      → 清洗去重
      → 人工标注（tension / form / hook / intensity）
      → embedding 向量化
      → 入库（anchors.jsonl + 向量索引）

[生成请求 · 在线]
    用户 Schema
      → Filter（tension + form）+ Semantic Re-rank → top-5 锚点
      → 6 维特征提取 → 特征包
      → ragBlock 拼装（特征包 + top-3 snippet）
      → System Prompt 注入
      → LLM 生成

[质量闭环 · 长期]
    生成内容质量评估
      → 高质量内容沉淀为锚点候选
      → 人工审核 → 入库
      → 语料库持续生长（数据飞轮）
```

**当前 v1.2 所处位置**：已完成向量化入库与随机抽样注入 ragBlock；tension 过滤检索和特征包精准注入尚未实现，语料标注是解锁下一步的关键瓶颈。
