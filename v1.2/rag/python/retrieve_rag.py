#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
按 primary/form/engagement 过滤 + 向量相似度检索 + 多样性约束。
接口：retrieve_anchors(...) -> (anchor_docs, anchor_ids)

用法（在 rag/ 目录下）:
  python retrieve_rag.py --query "想看那种欲言又止的告白" -K 5
"""
import argparse
import json
from pathlib import Path

import numpy as np

_RAG_DIR = Path(__file__).resolve().parent

EMBEDDING_MODEL = "all-MiniLM-L6-v2"


def _default_rag_dir():
    """默认 RAG 目录 = 本脚本所在目录（anchors.* 所在位置）。"""
    return _RAG_DIR


def load_rag(rag_dir):
    """加载 anchors 元数据、FAISS 索引、id 映射。"""
    rag_dir = Path(rag_dir)
    anchors_path = rag_dir / "anchors.jsonl"
    faiss_path = rag_dir / "anchors.faiss"
    ids_path = rag_dir / "anchors_ids.json"

    docs = []
    with open(anchors_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                docs.append(json.loads(line))

    import faiss
    index = faiss.read_index(str(faiss_path))

    with open(ids_path, "r", encoding="utf-8") as f:
        id_list = json.load(f)

    return docs, index, id_list


def retrieve_anchors(
    rag_dir,
    query_text=None,
    tension_primary=None,
    form=None,
    engagement_min=None,
    top_k=5,
    max_per_source=2,
    similarity_threshold=0.0,
    embedder=None,
):
    """
    检索锚点。
    - 先按 metadata 过滤（tension_primary / form / engagement_min）
    - 若提供 query_text：在过滤后的子集上做向量检索（需传入 embedder 或内部加载）
    - 否则：在过滤后的子集里按 engagement 排序取 top_k
    - 多样性：同一 source 最多 max_per_source 条；相似度过高的只留一条

    返回 (list[dict] 锚点文档, list[str] anchor_ids)
    """
    rag_dir = Path(rag_dir)
    docs, index, id_list = load_rag(rag_dir)
    n = len(docs)
    if n == 0:
        return [], []

    # 构建 index 行号 -> doc
    idx_to_doc = {i: docs[i] for i in range(n)}

    # 1) metadata 过滤：只保留符合条件的行号
    mask = list(range(n))
    if tension_primary is not None:
        mask = [i for i in mask if (idx_to_doc[i].get("labels") or {}).get("tension_primary") == tension_primary]
    if form is not None:
        mask = [i for i in mask if (idx_to_doc[i].get("style") or {}).get("form") == form]
    if engagement_min is not None:
        mask = [i for i in mask if (idx_to_doc[i].get("engagement_score") or 0) >= engagement_min]

    if not mask:
        return [], []

    # 2) 向量召回 or 按 engagement 排序
    if query_text and query_text.strip():
        if embedder is None:
            from sentence_transformers import SentenceTransformer
            embedder = SentenceTransformer(EMBEDDING_MODEL)
        q_emb = embedder.encode([query_text.strip()])
        q_emb = np.asarray(q_emb, dtype=np.float32)
        import faiss
        faiss.normalize_L2(q_emb)
        # 只对 mask 里的行做检索：用 index 子集或先取向量再建临时 index
        dim = index.d
        sub_index = faiss.IndexFlatIP(dim)
        vectors = np.vstack([index.reconstruct(i) for i in mask])
        sub_index.add(vectors)
        scores, indices = sub_index.search(q_emb, min(top_k * 3, len(mask)))  # 多取一些再做多样性
        # indices 是 sub_index 内的下标，对应 mask[indices[0][j]]
        order = [mask[int(idx)] for idx in indices[0] if 0 <= int(idx) < len(mask)]
        scores_first = scores[0].tolist()
    else:
        # 无 query：按 engagement 排序取前 top_k*2 再做多样性
        ordered = sorted(mask, key=lambda i: idx_to_doc[i].get("engagement_score") or 0, reverse=True)
        order = ordered[: top_k * 3]
        scores_first = None

    # 3) 多样性：同 source 最多 max_per_source；若有权重则相似度过高的只留一条
    seen_source = {}
    seen_ids = set()
    chosen = []
    for idx in order:
        doc = idx_to_doc[idx]
        doc_id = doc.get("id") or ""
        if doc_id in seen_ids:
            continue
        src = doc.get("source") or "unknown"
        if seen_source.get(src, 0) >= max_per_source:
            continue
        chosen.append((idx, doc))
        seen_source[src] = seen_source.get(src, 0) + 1
        seen_ids.add(doc_id)
        if len(chosen) >= top_k:
            break

    anchor_docs = [doc for _, doc in chosen]
    anchor_ids = [doc.get("id") or "" for doc in anchor_docs]
    return anchor_docs, anchor_ids


def main():
    parser = argparse.ArgumentParser(description="Retrieve anchors from RAG")
    parser.add_argument("--rag-dir", type=str, default=str(_default_rag_dir()), help="RAG 目录（含 anchors.*）")
    parser.add_argument("--query", "-q", type=str, default="", help="查询文本（用于向量检索）")
    parser.add_argument("--tension-primary", type=str, default=None, help="过滤 tension_primary")
    parser.add_argument("--form", type=str, default=None, choices=["dialogue", "narrative"], help="过滤 form")
    parser.add_argument("--engagement-min", type=float, default=None, help="engagement 下限")
    parser.add_argument("-K", "--top-k", type=int, default=5, help="返回条数")
    parser.add_argument("--max-per-source", type=int, default=2, help="同一 source 最多几条")
    args = parser.parse_args()

    docs, ids = retrieve_anchors(
        args.rag_dir,
        query_text=args.query or None,
        tension_primary=args.tension_primary,
        form=args.form,
        engagement_min=args.engagement_min,
        top_k=args.top_k,
        max_per_source=args.max_per_source,
    )
    print(f"检索到 {len(docs)} 条:")
    for i, (d, aid) in enumerate(zip(docs, ids), 1):
        text = (d.get("text") or "")[:80]
        if len(d.get("text") or "") > 80:
            text += "…"
        print(f"  {i}. [{aid}] {text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
