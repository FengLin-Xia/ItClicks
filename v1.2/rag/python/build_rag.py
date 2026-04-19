#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
从 jsonl 构建 Anchor 库 + embedding + FAISS 索引。
- 筛选：engagement 取 top30%，可选 confidence≥0.75、按 tension_primary 每类最多 200 条
- 按 text 去重
- 输出：本目录下 anchors.jsonl、anchors.faiss、anchors_ids.json

用法:
  python build_rag.py -i ../weibo/clean_chunks_merged.jsonl -o .
  python build_rag.py   # 默认读上级 weibo/clean_chunks_merged.jsonl，写到当前目录
"""
import argparse
import json
import re
from pathlib import Path

import numpy as np

_RAG_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _RAG_DIR.parent

EMBEDDING_MODEL = "all-MiniLM-L6-v2"
MIN_CHARS = 10
ENGAGEMENT_TOP_PCT = 30   # 取 top 30%
MAX_PER_TENSION = 200     # 每 tension_primary 最多条数
CONFIDENCE_MIN = 0.75    # 若有 confidence 字段则过滤


def normalize_text(s):
    if not s:
        return ""
    return re.sub(r"\s+", " ", str(s).strip())


def load_jsonl(path):
    path = Path(path)
    rows = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return rows


def build_engagement_score(r):
    if "engagement_score" in r:
        return float(r.get("engagement_score") or 0)
    a = float(r.get("attitudes_count") or 0)
    c = float(r.get("comments_count") or 0)
    rep = float(r.get("reposts_count") or 0)
    return a + 2 * rep + 1.5 * c


def to_anchor_doc(r):
    """将一条 jsonl 转为 RAG 文档 schema（含可选 labels/style）。"""
    doc_id = r.get("chunk_id") or r.get("id") or ""
    text = (r.get("text") or "").strip()
    source = r.get("source") or "unknown"
    engagement = build_engagement_score(r)
    labels = r.get("labels") or {}
    if "tension_primary" not in labels and r.get("tension_primary"):
        labels["tension_primary"] = r["tension_primary"]
    if "confidence" not in labels and r.get("confidence") is not None:
        labels["confidence"] = float(r["confidence"])
    style = r.get("style") or {}
    if "form" not in style and r.get("has_dialogue") is not None:
        style["form"] = "dialogue" if r.get("has_dialogue") else "narrative"
    return {
        "id": doc_id,
        "text": text,
        "source": source,
        "engagement_score": engagement,
        "labels": labels,
        "style": style,
    }


def main():
    default_input = str(_PROJECT_ROOT / "weibo" / "clean_chunks_merged.jsonl")
    default_output = str(_RAG_DIR)

    parser = argparse.ArgumentParser(description="Build RAG Anchor library + FAISS index")
    parser.add_argument("-i", "--input", type=str, default=default_input,
                        help="Input jsonl path")
    parser.add_argument("-o", "--output-dir", type=str, default=default_output,
                        help="Output directory for anchors.jsonl, anchors.faiss, anchors_ids.json")
    parser.add_argument("--top-pct", type=float, default=ENGAGEMENT_TOP_PCT,
                        help="Engagement top percentile (default 30)")
    parser.add_argument("--max-per-tension", type=int, default=MAX_PER_TENSION,
                        help="Max anchors per tension_primary (default 200)")
    parser.add_argument("--min-chars", type=int, default=MIN_CHARS,
                        help="Min text length (default 10)")
    args = parser.parse_args()

    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    rows = load_jsonl(args.input)
    print(f"[1/5] 读取 {len(rows)} 条")

    # 转 doc + 过滤短文本
    docs = [to_anchor_doc(r) for r in rows]
    docs = [d for d in docs if d["text"] and len(d["text"]) >= args.min_chars]
    print(f"[2/5] 过滤后 {len(docs)} 条（≥{args.min_chars}字）")

    # engagement top N%
    scores = [d["engagement_score"] for d in docs]
    threshold = np.percentile(scores, 100 - args.top_pct)
    docs = [d for d in docs if d["engagement_score"] >= threshold]
    print(f"[3/5] engagement top {args.top_pct}%: 阈值={threshold:.0f}, 剩余 {len(docs)} 条")

    # 可选：有 confidence 字段时才过滤
    docs = [d for d in docs if (d.get("labels") or {}).get("confidence") is None
            or (d.get("labels") or {}).get("confidence") >= CONFIDENCE_MIN]
    if any((d.get("labels") or {}).get("confidence") is not None for d in docs):
        print(f"       confidence≥{CONFIDENCE_MIN} 或未标: {len(docs)} 条")

    # 按 tension_primary 截断
    tension_counts = {}
    kept = []
    for d in docs:
        primary = (d.get("labels") or {}).get("tension_primary") or "_default"
        tension_counts[primary] = tension_counts.get(primary, 0) + 1
        if tension_counts[primary] <= args.max_per_tension:
            kept.append(d)
    docs = kept
    print(f"[4/5] 每类最多 {args.max_per_tension} 条: {len(docs)} 条")

    # 按 text 去重（保留首次）
    seen = set()
    unique = []
    for d in docs:
        key = normalize_text(d["text"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(d)
    docs = unique
    print(f"       按 text 去重: {len(docs)} 条")

    # 写 anchors.jsonl
    anchors_path = out_dir / "anchors.jsonl"
    with open(anchors_path, "w", encoding="utf-8") as f:
        for d in docs:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")
    print(f"       已写 {anchors_path}")

    # Embedding + FAISS
    try:
        from sentence_transformers import SentenceTransformer
        import faiss
    except ImportError as e:
        print(f"[ERROR] 缺少依赖: {e}. 请 pip install sentence-transformers faiss-cpu")
        return 1

    print(f"[5/5] 加载 embedding 模型: {EMBEDDING_MODEL}")
    model = SentenceTransformer(EMBEDDING_MODEL)
    texts = [d["text"] for d in docs]
    emb = model.encode(texts, show_progress_bar=True)
    emb = np.asarray(emb, dtype=np.float32)
    # L2 归一化，便于用内积做余弦相似
    faiss.normalize_L2(emb)

    dim = emb.shape[1]
    index = faiss.IndexFlatIP(dim)
    index.add(emb)

    faiss_path = out_dir / "anchors.faiss"
    faiss.write_index(index, str(faiss_path))
    print(f"       已写 {faiss_path}")

    ids_map = [d["id"] for d in docs]
    ids_path = out_dir / "anchors_ids.json"
    with open(ids_path, "w", encoding="utf-8") as f:
        json.dump(ids_map, f, ensure_ascii=False, indent=0)
    print(f"       已写 {ids_path}")

    print(f"\n完成. Anchor 库共 {len(docs)} 条.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
