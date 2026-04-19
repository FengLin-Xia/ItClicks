你这句“怎么做 RAG 库”，我按你现在的目标（风格矫正 + 结构模板对齐，不做内容拼贴）给你一套可落地的做法。

下面是Seed Engine 风格 RAG 库的标准建法：你照着做，后面换语料/换标签都不崩。

1）先明确：你这个 RAG 库检索的不是“内容”，而是“风格锚点”

你要的 RAG 不是“把相似句子塞进 prompt 让它抄”，而是：

检索到同类文本作为 锚点

从锚点里提取 可参数化的风格特征

把“特征”喂给生成 prompt（而不是原句）

一句话：RAG 只输出特征，不输出原句。

2）RAG 库里每条数据要长什么样（最关键）

你需要把每个 chunk 存成带 metadata 的 document。最小字段：

{
  "id": "A_000123",
  "text": "原文（用于embedding）",
  "source": "account_A",
  "engagement_score": 1234,
  "labels": {
    "tension_primary": "位阶张力",
    "tension_secondary": "情感留白",
    "confidence": 0.82
  },
  "style": {
    "form": "dialogue",
    "intensity": "medium",
    "hook": "contrast",
    "tone_base": "east_asian_subtle"
  }
}

你现在已经有 tension/confidence/engagement 了。
form/intensity/hook/tone 先不用全量标，后面可以逐步补（先自动估计也行）。

3）库怎么建：分两层库（强烈建议）
A. Style Anchor库（小而精）

只放“高互动 + 高置信度 + 去重后”的样本，比如每类 50–200 条。

用途：生成时检索锚点，抽风格特征。

B. Analysis库（全量）

放全量语料，用于统计、挖新模式、找边界案例。

生成阶段 99% 用 Anchor库，省钱、省漂移、避免策略坍塌。

4）embedding 用什么、怎么切块
切块（你已经做得差不多）

每条 1–3 句为宜（你代餐文本天然短，别再切碎）

过滤空文本、广告、纯表情

去重（尤其是转载/重复模板）

embedding

你三家里谁做 embedding 更顺手就先用谁。关键是：

同一个库全用同一个 embedding 模型

以后换模型要重建 index（别混用）

5）索引用什么（本地推荐）

最省事：FAISS（本地向量检索）
或者你也可以用 Chroma（更“RAG 产品化”一点）

我建议你第一版用 FAISS：简单、快、可控。

6）检索策略：别只靠向量相似度

你这个任务里，“同张力 + 同形式”比纯相似度重要。

所以检索要这样做：

metadata 过滤（硬条件）

tension_primary = 目标 primary

form = 目标 form（如果你控制了 form）

engagement_score ≥ 某阈值（保证锚点质量）

向量召回（软条件）

在过滤后的集合里做 topK 相似度检索

多样性约束（防坍塌）

同一个 source 不超过 2 条

相似度太高的只留一条（避免同模板）

7）RAG 返回什么？返回“风格特征包”，不是原句

每次检索 topK（比如 K=5）后，你做一个“特征提取器”总结：

输出类似：

{
  "anchor_features": {
    "avg_len": "35-55字",
    "punctuation": "短句+顿号/省略",
    "dialogue_turns": 2,
    "ending": "留白收尾",
    "hook_position": "第一句",
    "lexical_tone": "克制、少形容词、多动词"
  }
}

然后在生成 prompt 里写：

“按以下风格特征写”

而不是贴 5 条原文

这一步是你生成“更吸引人”最关键的矫正器。

8）你现在立刻该做的 RAG 库最小版本（MVP）

按你现在状态，我建议 MVP 这样：

Step A：从已标注样本里建 Anchor库

规则：

confidence ≥ 0.75

engagement_score 取 top30%（或你觉得优质阈值）

每个 tension_primary 最多 200 条（避免单类爆炸）

去重（相同 text 去掉）

Step B：为 Anchor库做 embedding + 建 FAISS index

保存三样东西：

anchors.jsonl（原文+metadata）

anchors.faiss（向量索引）

anchors_ids.json（向量行号→doc_id 映射）

Step C：写一个 retrieve_anchors() 接口

输入：schema 五维参数
输出：anchor_features（特征包）+ anchor_ids（用于追溯）

9）你要不要我给你“可直接跑的完整代码”？

你之前偏好“给我能运行的整套”，那我可以直接给你一个 v0.1：

build_rag.py：从 jsonl 构建 Anchor库 + embedding + FAISS

retrieve_rag.py：按 primary/form/tone 检索 + 多样性约束

extract_features.py：把锚点变成 feature pack

generate.py：Plan→Write 生成，自动注入 feature pack

你只需要告诉我两件事（不需要你想很久，按当前最顺手的填）：

你准备用哪家做 embedding（openai / deepseek / minimax 选一个先跑通）

你的 jsonl 里互动字段现在到底是：engagement_score 还是 likes/reposts/comments 都有？

你回一句“embedding 用 X，互动字段是 Y”，我就把整套 v0.1 代码一次性贴给你。

---

**代码位置**：v0.1 脚本已放在项目下的 `rag/` 目录（build_rag.py、retrieve_rag.py、extract_features.py、generate.py），详见 `rag/README.md`。