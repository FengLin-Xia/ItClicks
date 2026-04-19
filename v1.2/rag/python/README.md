# RAG 的 Python 侧（构建 + 检索）

本目录放**用 Python 处理好的**那套代码，和 `corpus/` 里的数据一起构成完整 RAG 库。

## 为什么要放进来

1. **可复现**：语料（`anchors.jsonl`）更新后要重新建索引，有脚本才能一键产出新的 `anchors.faiss` + `anchors_ids.json`。
2. **检索入口**：FAISS 通常用 Python 读；Node 后端可通过「子进程调 Python」或「本地小 HTTP 服务」做检索，入口代码放这里，和构建脚本同一处维护。
3. **上线前测试**：`scripts/verify.js` 或你自己写的测试可以调同一套 Python 检索，保证和线上一致。

## 建议放哪些文件

| 文件 | 用途 |
|------|------|
| `build_index.py`（或你现在的脚本名） | 读 `corpus/anchors.jsonl`，做 embedding，写出 `corpus/anchors.faiss` 和 `corpus/anchors_ids.json` |
| `retrieve.py` 或小服务 | 加载 FAISS + ids，按 query 返回若干条 id 或文本；供 Node 子进程调用或本地 HTTP 调用 |
| `requirements.txt` | 依赖（如 `faiss-cpu`、embedding 库等），方便 `pip install -r requirements.txt` |

当前 corpus 里已有三件成品：`anchors.jsonl`、`anchors.faiss`、`anchors_ids.json`，把生成它们的脚本（以及检索脚本，若有）拷到本目录即可。

## 构建索引（语料更新后）

```bash
# 在 v1.2/rag 或 v1.2/rag/python 下
pip install -r python/requirements.txt
python python/build_index.py
```

输出仍写到 `corpus/anchors.faiss` 和 `corpus/anchors_ids.json`，与现有约定一致。

## 后端如何调 Python 检索

- **子进程**：Node 里 `child_process.spawn('python', ['python/retrieve.py', '--query', ...])`，读 stdout 的 JSON。
- **本地 HTTP**：用 FastAPI/Flask 起一个只绑 127.0.0.1 的 `/retrieve`，Node 用 `axios.get('http://127.0.0.1:端口/retrieve?...)')`。部署时一起起这个 Python 服务即可。

上线前用 `npm run test:rag` 或 `node rag/scripts/verify.js` 时，可改为调这段 Python 检索逻辑，确保和线上一致。
