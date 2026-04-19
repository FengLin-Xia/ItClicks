# ItClicks（这也能代）项目迭代总结

---

## 一、项目整体迭代脉络

这是一个以"代入感"为核心假设的 AI 短文本生成产品，面向同人/代餐圈层用户。每个版本都是一次产品方向的收紧或转向。


| 版本   | 时间          | 产品形态             | 核心假设                 |
| ---- | ----------- | ---------------- | -------------------- |
| v0   | 初始          | 单页 Web，无后端       | 一段克制文本能否点亮用户自己的故事    |
| v1.0 | 2025-02     | Web Demo（起始页+画布） | 引线文本 → 用户主动写作，AI 软介入 |
| v1.1 | 2025-02-13~ | 关系驱动写作 IDE       | 从剧情生成转为关系结构操作        |
| v1.2 | 2026-03~    | 刷流+定制表达          | 刷流唤起情绪 → "差一点"引导定制   |


**核心转变轨迹**：验证代入感（v0）→ 写作协作工具（v1.0/1.1）→ 轻内容 Feed + 表达出口（v1.2）。v1.1 的关系可视化画布是一个方向岔路，v1.2 将其收敛为刷流入口，砍掉主流程中的画布，保留了生成引擎作为后台能力。

---

## 二、生成控制（Generation Control）各版本详述

生成控制的演化是这个项目技术积累最深的地方，从"只有禁止规则"走向"五维锁定协议"。

---

### v0：纯规则约束，无结构化控制

**控制方式**：系统 Prompt 写死一套 9 条"禁止"规则，没有结构化输出，没有 Critic，没有重试。

**规则核心**：

- 输出 50–120 字，2–4 句
- 至少 3 个模糊指代（他/她/那件事/最近）
- 禁止具体背景设定（地名/职业/世界观）
- 禁止因果解释（因为/所以/终于/后来）
- 禁止完整故事或明确结局
- 结尾必须"悬住"——停在差一点发生的位置
- 语气自然，不要文学腔，用动作/边界/选择表达张力

**控制逻辑类型**：全负向约束（禁止做什么），无正向参数。

**问题**：输出质量不稳定，无任何拦截机制，全靠运气是否符合"代得动"标准。文档里明确写"接受输出偶尔不代，接受文本质量不稳定"。

---

### v1.0：引入 Critic，首次双调用 + 重试

**控制方式**：Writer + Critic 双调用，最多 1 次重试。

**Writer Prompt 结构**（结构化升级）：

- 按 mode 拼装 User Prompt：mode=seed / mode=assist（op=continue / op=rewrite）
- 继续一段取局部上下文（around_cursor 或 tail 300–600 字），不传全文
- rewrite 输出固定为 `1) ... 2) ... 3) ...` 格式便于前端选择

**Critic 设计（首次出现）**：

```json
{
  "pass": true/false,
  "problems": ["..."],
  "confidence": 0-1,
  "fix_hint": "一句话指出最重要的修改方向"
}
```

拦截目标：端着/文学腔、解释/总结/因果、前史暗示、结局感、设定绑定、信息太空（只有形容词没有关系动作）。

**重试策略**：fail → 把 fix_hint 附加给 Writer 重新生成一次 → 若仍 fail，返回最后版本，在 meta 标记 `quality=low`（便于后续观察）。

**意义**：第一次有了质量闸门。Critic 的设计逻辑是"守住负向底线"，不是正向生成控制。

**接口设计**（POST `/api/generate`）：

```json
{
  "mode": "seed" | "assist",
  "op": "continue" | "rewrite",
  "hint": "（可空）",
  "context": { "selected", "around_cursor", "tail" },
  "state": { "tone": "restrained" | "intense" }
}
```

---

### v1.1 基础版：关系状态结构化输出，首次正向控制维度

**控制方式**：在 Writer + Critic 基础上，Critic 开始承担"关系状态识别"职责，输出结构成为生成产物的一部分。

**统一输出 Schema（首次强制结构化）**：

```json
{
  "text": "生成文本",
  "relation_state": {
    "polarity": -2 | -1 | 0 | 1 | 2,
    "initiative": "A" | "B" | "balanced",
    "tags": ["标签1", "标签2"]
  }
}
```

**三种操作（正向生成参数，首次出现）**：

- `deepen`（压一层）：强化当前关系极性，提高张力，不引入新剧情
- `perspective`（换视角）：切换表达立场，polarity 基本保持
- `reveal`（暴露一点）：透露隐藏态度，polarity 轻微上升或下降

每种操作有对应规则（polarity ≥ 1 则更极端，≤ 0 则加重冷/疏离等），Critic 检查规则符合度。

**极性计算规范**（首次出现数值型控制）：

```
极端表达（绝不/一定/早就/根本） → +2
明确对峙/偏爱 → +1
中性状态 → 0
冷淡/疏离 → -1
决裂感 → -2
```

**多轨道 Seed 生成系统（2025-02-13 加入）**：

- 4 种 Seed 轨道：relation / semantic_gap / boundary / daily_tension
- 基础权重：35% / 30% / 20% / 15%
- **动态权重调整**（第一次引入会话级分布控制）：
  - 禁止连续相同 mode（权重 × 0.3）
  - semantic_gap 防连发（连续出现时 × 0.5）
  - 极性过高时降温（最近 3 次 polarity ≥ 1 → 降温激烈模式，升温 daily_tension）
  - 极性过低时升温（最近 3 次 polarity ≤ 0 → 升温激烈模式）
- Session 状态管理：内存存储最近 1 次 mode、最近 3 次 polarity、最近 3 条 seed 文本

**Critic 强化**：额外检查"是否过度文学化"、"是否与上一条过于相似"、"是否缺乏关系结构"，输出含 style_flags。

**意义**：第一次有了正向控制参数（不只是禁止做什么，而是明确要产出什么状态）；会话级分布调控首次出现。代价是 Critic 承担了双重职责（质量过滤 + 状态识别），语义有些混乱。

---

### v1.1.2：三维装配式系统（文档已设计，代码未实现）

**控制方式**：Expression Layer × Relation Layer × Detail Anchor，三个独立维度组合生成。

**三维结构**：

1. **Expression Layer（表达层）**：控制"怎么说"
  - concept（高概念短句）：气质压缩、克制
  - daily_real（真实生活片段）：具体、自然、有身体感
  - declaration（情绪化宣言）：直接、有冲击
  - 权重：daily_real 40% / concept 35% / declaration 25%
2. **Relation Layer（关系结构层）**：控制"说什么"，从 4 种扩展为 6 种
  - 新增 persona_contrast（人设反差）
  - 权重：steady 25% / relation 20% / daily_tension 20% / semantic_gap 15% / boundary 10% / persona_contrast 10%
3. **Detail Anchor（细节锚点）**：控制"是否用物理细节泄露情绪"
  - true（默认 50%）：必须含至少一个可感知细节（动作/物件/轻微失误），不解释情绪，不象征化
  - false：不强制细节，可纯关系表达

**组合约束**：

- 禁止 declaration + boundary + semantic_gap 同时出现
- 若上一条为 semantic_gap + detail_anchor=true，下一条降低 semantic_gap 权重
- 不允许连续两条 expression 相同

**设计目标从"代入感"升级为"自然度 × 爽点 × 可读性"的平衡分布**，"不是每条都狠，而是自然分布，偶尔出现记忆点"。

**状态**：仅作为文档存在，未实现到代码，当时部署版本仍是 v1.1 Prompt。

---

### v1.1.3：简化为二维系统（已实现部署）

**背景**：v1.1.2 三维组合过于复杂，调整为更聚焦的二维。

**控制方式**：Tension Mode（张力模式）× Expression Form（表达形式），固定权重，移除会话级动态调整。

**Tension Mode（核心驱动）**：

- `core_action`（40%）：行为必须直接改变两人关系状态，不得是外部社会行为，必须是一次具体片段
- `contrast`（30%）：第二句必须轻微违背第一句的自然推论（说不见→却等 / 赶走→门没锁 / 删掉→密码没改）
- `suspended`（30%）：第二句不解释不反转，只增加新的物理或情绪维度（灯没关 / 笔帽没合 / 手机还在充电）

**Expression Form（表达外壳）**：

- `high_concept`：可用概念角色，但必须落在具体行为上
- `daily_scene`：优先日常空间，不强制生活化
- `emotional_line`：可含一句对话，不可长段抒情
- 三种等概率

**输出格式精简**（关键变化）：

```json
{
  "text": "生成文本",
  "meta": {
    "tension_mode": "core_action|contrast|suspended",
    "expression_form": "high_concept|daily_scene|emotional_line"
  }
}
```

**重大变化：移除 relation_state**——不再返回 polarity/initiative/tags，生成侧不再承担关系状态识别职责。这意味着放弃了画布可视化的数据基础。

**全局禁止规则（新增）**：

- 禁止"会/总是/一向/向来"等概括性描述
- 禁止外部职业或社会宏大设定
- 禁止解释行为动机
- 禁止总结关系状态
- 不超过三句

**Session 状态管理简化**：从 lastSeedMode/lastSeedRelation/lastDetailAnchor 变为 lastSeedMode + lastSeedForm，移除复杂组合约束。

---

### v1.2：五维 Schema v1.0（官方锁定协议）

**背景**：v1.2 产品形态转向"刷流+定制"，生成控制也从"每次交互控制"转为"生成空间的协议式锁定"。

**Prompt Schema v1.0 五维控制**（文档标注："这是生成阶段唯一合法控制协议，以后不再随意加维度"）：


| 维度       | 字段                                        | 说明                                                                          |
| -------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| 1. 关系逻辑层 | `relation.primary` + `relation.secondary` | 控制"爱怎么成立"，10 类张力类型                                                          |
| 2. 表达形式层 | `form`                                    | single / dialogue / micro_scene / lyrical_blank                             |
| 3. 表达强度层 | `intensity`                               | low / medium / high                                                         |
| 4. 钩子机制层 | `hook`                                    | contrast / time_cut / behavioral_paradox / direct_confession                |
| 5. 风格气质层 | `tone`                                    | base_style + coldness_level + restraint_level + concreteness_level（连续值 0–1） |


**10 类张力类型（首次作为独立维度系统化）**：
不能爱 / 矛盾拉扯 / 反差 / 位阶张力 / 占有欲/吃醋 / 遗弃/等待 / 时间终止 / 伤害纠缠 / 行为悖论 / 情感留白——每类均有定义、核心感受、代表结构、生成提示四项。

**生成流程升级：Plan → Write 双阶段**（首次有内部规划步骤）：

- Plan 阶段（不可见）：模型内部先生成关系结构草图、钩子句位置、情绪峰值位置
- Write 阶段：严格按五维参数写，不允许偏离 tone，不得增加未授权张力

**RAG 使用规则（正式写进协议）**：

- 只允许对 `tone.base_style` 和 `form` 结构模板做风格锚点提取
- 禁止复制句子、拼贴内容、注入具体情节
- A/B 测试：Variant A（有 RAG）vs Variant B（无 RAG，作为 baseline）

**禁止组合（首次显式列出）**：

- 不得新增第六维
- 不得混淆 hook 与 relation
- 不得同时使用 high intensity + lyrical_blank（冲突）
- 不得连续两次使用同一 hook（避免风格坍塌）

**两个生成场景并存**：

- **刷流层（feed pool）**：仍沿用 v1.1.3 的二维系统（tension_mode × expression_form），通过预生成脚本批量写入数据库，meta 记录 tension_type/form/intensity/hook 等字段
- **定制层（/api/customize）**：走五维 Schema pipeline，流程为：用户输入 → extract_schema.js（规则抽取）→ schema_engine.js（Schema → Prompt）→ Writer（+ 可选 RAG）→ 输出 80–120 字

**规则抽取（extract_schema.js）**：纯关键词规则匹配，无 LLM 调用，输出 cp / situation / requested_style / schema（五维），是当前"结构抽取"的 MVP 实现。

**Critic 在 v1.2 的状态**：按 0301-PRD-GAP.md，定制层 Critic（代餐语感 + 张力 + 长度校验）**尚未实现**，是已知缺口之一。

---

## 三、生成控制演化横向对比


| 版本     | 控制类型   | 主要维度数                                | 有无 Critic      | 重试机制 | 会话级控制          | 正向 vs 负向  |
| ------ | ------ | ------------------------------------ | -------------- | ---- | -------------- | --------- |
| v0     | 规则约束   | 0（纯禁止）                               | ❌              | ❌    | ❌              | 全负向       |
| v1.0   | 质量闸门   | 1（tone 简单枚举）                         | ✅（pass/fail）   | 1次   | ❌              | 主负向       |
| v1.1   | 关系状态驱动 | 3（polarity/initiative/tags）          | ✅（状态识别）        | 1次   | ✅（极性动态权重）      | 负向+正向混合   |
| v1.1.2 | 三维装配   | 3（Expression×Relation×Anchor）        | ✅              | 1次   | ✅（组合约束）        | 正向为主（未实现） |
| v1.1.3 | 二维生成   | 2（TensionMode×Form）                  | ✅（style_flags） | 1次   | 弱（仅防连续）        | 正向为主      |
| v1.2   | 五维协议锁定 | 5（relation/form/intensity/hook/tone） | ✅（定制层未做）       | 待补   | ✅（禁止组合+RAG AB） | 全正向协议     |


**核心演化逻辑**：从"告诉 LLM 不要做什么"→"告诉 LLM 要做什么状态"→"给 LLM 一份协议要严格执行"。v1.2 的 Schema v1.0 是这条路的当前终点，也是目前最系统化的一次——**五维独立、协议锁定、RAG 只服务气质、Plan→Write 双阶段、禁止添加第六维**。

---

## 四、当前 v1.2 已知缺口（生成控制相关）

1. **定制层 Critic 未实现**：自定义生成后无"代餐语感+张力+长度"校验，输出质量没有闸门
2. **结构抽取仍为规则版**：`extract_schema.js` 是关键词匹配，复杂或模糊的用户输入无法准确映射到五维 Schema
3. **两套控制系统并存**：刷流用二维（v1.1.3），定制用五维（v1.2），分布数据不统一，后续对比分析需要对齐字段
4. **RAG 锚点库尚未充分建设**：Variant A（有 RAG）的质量收益依赖语料质量，目前锚点库体量未知
5. **Tracking 与控制参数未打通**：埋点里 `view_seed` 的 tension_type/is_rag 字段当前 feed_pool 表里没有存储（tracking_plan_conflicts.md 已记录），无法直接做"哪种 Schema 组合更容易触发定制"的分析

