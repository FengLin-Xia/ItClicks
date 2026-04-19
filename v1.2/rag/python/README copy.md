# RAG 风格锚点库

按 `RAG_V0.1.md` 建的风格 RAG：检索锚点 → 抽特征包 → 注入生成 prompt（不直接贴原句）。

## 脚本

| 脚本 | 作用 |
|------|------|
| `build_rag.py` | 从项目 `weibo/clean_chunks_merged.jsonl` 建 Anchor 库 + embedding + FAISS，输出到本目录 |
| `retrieve_rag.py` | 按 query / tension / form 检索锚点，带多样性约束 |
| `extract_features.py` | 把锚点列表归纳成风格特征包（规则版） |
| `generate.py` | 检索 → 特征包 → 组 prompt（不调大模型） |

## 使用

在项目根目录或本目录执行均可；**建库后**锚点与索引在本目录（`anchors.jsonl`、`anchors.faiss`、`anchors_ids.json`）。

```bash
# 1. 建库（默认读 ../weibo/clean_chunks_merged.jsonl，写到当前目录）
cd rag
python build_rag.py

# 2. 检索
python retrieve_rag.py --query "想看那种欲言又止的告白" -K 5

# 3. 一条龙：检索 → 特征包 → prompt
python generate.py --query "想看那种欲言又止的告白" -K 5 --out prompt.txt
```

从项目根目录跑时指定 RAG 目录：

```bash
python rag/build_rag.py -i weibo/clean_chunks_merged.jsonl -o rag
python rag/retrieve_rag.py --rag-dir rag --query "欲言又止" -K 5
python rag/generate.py --rag-dir rag --query "欲言又止" -K 5
```

## 依赖

见项目根目录 `requirements.txt`（sentence-transformers、faiss-cpu 等）。
