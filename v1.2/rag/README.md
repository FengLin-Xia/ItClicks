# RAG 库（v1.2）

Seed Engine 生成阶段用 RAG 做**风格锚点提取**，仅服务 `tone.base_style` 与 `form` 结构模板。  
约定见 [Prompt_Schema_v1.0.md](../Prompt_Schema_v1.0.md) 中「RAG 使用规则」。

## 目录说明

| 目录/文件 | 用途 |
|-----------|------|
| `corpus/` | 语料与索引：`anchors.jsonl`、`anchors_ids.json`、`anchors_vectors.json`（向量，与 ids 同序）；可选 `anchors.faiss`（Python 用） |
| `index/` | 预留；若索引不放在 corpus 可放此处（大文件可在 .gitignore 忽略） |
| `python/` | **Python 构建与检索代码**：建索引脚本、检索入口、`requirements.txt`（见 [python/README.md](python/README.md)） |
| `client.js` | **Node 检索入口**：读上述三份文件，按 query 向量做余弦相似度，返回 top-k（不包含 query 的 embedding，需后端自接） |
| `scripts/verify.js` | 上线前自测：检查语料与索引、用 Node client 跑一次检索 |

## 后端如何引用

在 `backend/server.js` 或相关路由里按需引用（示例）：

```js
const rag = require('../rag/client');
// 先得到 query 向量（同维，例如调你的 embedding API）
const queryVector = await getEmbedding(userInput);  // 你实现
const hits = rag.retrieve(queryVector, 5, { filterForm: 'dialogue' });
// hits => [{ id, text, style, score }, ...]
```

Node 直接读 `anchors_ids.json` + `anchors.jsonl` + `anchors_vectors.json`，无需起 Python。query 的向量需在后端用同一套 embedding 模型/API 得到（与建库时一致）。

## 上线前测试

任选一种方式运行：

```bash
# 方式一：在 v1.2 目录下
node rag/scripts/verify.js

# 方式二：已经 cd 到 rag 目录时
node scripts/verify.js
```

或在 `backend/package.json` 里加脚本后，在 backend 目录执行 `npm run test:rag`：

```json
"scripts": {
  "test:rag": "node ../rag/scripts/verify.js"
}
```

验证通过后再部署。
