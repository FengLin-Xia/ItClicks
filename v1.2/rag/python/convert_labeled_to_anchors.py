#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
将 seed_engine_v1.0.labeled.jsonl 转换为标准 anchor 格式，输出 right_anchors.jsonl。

labeled 文件特殊字段说明：
  - id / chunk_id 不在顶层，在 _raw.chunk_id
  - 顶层 engagement_score 为 0.0（错误），真实值在 _raw.engagement_score
  - labels 是列表 [{type, confidence}, ...]，需转为 dict {tension_primary, confidence}
  - primary_label / label_confidence 在顶层
  - has_dialogue 在 _raw.has_dialogue → 映射为 style.form

用法（在 v1.2/rag/python/ 下）：
  python convert_labeled_to_anchors.py
  python convert_labeled_to_anchors.py --input ../corpus/seed_engine_v1.0.labeled.jsonl --output ../corpus/right_anchors.jsonl
  python convert_labeled_to_anchors.py --exclude-other   # 过滤掉 primary_label="其他"
  python convert_labeled_to_anchors.py --min-confidence 0.75
"""
import argparse
import json
from pathlib import Path

_RAG_DIR = Path(__file__).resolve().parent.parent
_DEFAULT_INPUT = _RAG_DIR / "corpus" / "seed_engine_v1.0.labeled.jsonl"
_DEFAULT_OUTPUT = _RAG_DIR / "corpus" / "right_anchors.jsonl"


def convert_row(r: dict) -> dict | None:
    """将一条 labeled 记录转换为标准 anchor doc。返回 None 表示跳过。"""
    raw = r.get("_raw") or {}

    # id：优先 _raw.chunk_id，否则 _raw.source_weibo_id + "_0"
    doc_id = raw.get("chunk_id") or raw.get("source_weibo_id") or r.get("id") or ""

    text = (r.get("text") or raw.get("text") or "").strip()
    if not text:
        return None

    source = raw.get("source") or r.get("source") or "代餐墙"

    # engagement：顶层 0.0 是错的，用 _raw.engagement_score
    engagement = float(raw.get("engagement_score") or r.get("engagement_score") or 0)

    # labels：从 primary_label + label_confidence 构造 dict
    primary = r.get("primary_label") or ""
    confidence = float(r.get("label_confidence") or 0)

    # 也从列表版 labels 里补 secondary（置信度次高的非 primary 类型）
    labels_list = r.get("labels") or []
    secondary = None
    if isinstance(labels_list, list):
        others = [
            item for item in labels_list
            if isinstance(item, dict)
            and item.get("type") != primary
            and item.get("type") not in ("其他", "")
        ]
        if others:
            best = max(others, key=lambda x: float(x.get("confidence") or 0))
            if float(best.get("confidence") or 0) >= 0.6:
                secondary = best["type"]

    labels = {}
    if primary:
        labels["tension_primary"] = primary
    if secondary:
        labels["tension_secondary"] = secondary
    if confidence:
        labels["confidence"] = confidence

    # style.form：_raw.has_dialogue → dialogue / narrative
    has_dialogue = raw.get("has_dialogue")
    form = "dialogue" if has_dialogue else "narrative"
    style = {"form": form}

    return {
        "id": doc_id,
        "text": text,
        "source": source,
        "engagement_score": engagement,
        "labels": labels,
        "style": style,
    }


def main():
    parser = argparse.ArgumentParser(description="Convert labeled jsonl to right_anchors.jsonl")
    parser.add_argument("--input", "-i", type=str, default=str(_DEFAULT_INPUT),
                        help="Input labeled jsonl path")
    parser.add_argument("--output", "-o", type=str, default=str(_DEFAULT_OUTPUT),
                        help="Output anchors jsonl path")
    parser.add_argument("--exclude-other", action="store_true",
                        help="过滤掉 primary_label='其他' 的条目")
    parser.add_argument("--min-confidence", type=float, default=0.0,
                        help="最低 label_confidence 阈值（默认不过滤）")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    rows = []
    with open(input_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    rows.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    print(f"[1/4] 读取 {len(rows)} 条")

    # 转换
    docs = []
    for r in rows:
        doc = convert_row(r)
        if doc:
            docs.append(doc)
    print(f"[2/4] 转换后 {len(docs)} 条")

    # 可选过滤
    before = len(docs)
    if args.exclude_other:
        docs = [d for d in docs if (d.get("labels") or {}).get("tension_primary") not in ("其他", "", None)]
        print(f"       排除 primary='其他': {before} → {len(docs)} 条")

    if args.min_confidence > 0:
        before = len(docs)
        docs = [d for d in docs if (d.get("labels") or {}).get("confidence", 1.0) >= args.min_confidence]
        print(f"       confidence≥{args.min_confidence}: {before} → {len(docs)} 条")

    # 统计
    from collections import Counter
    primary_dist = Counter((d.get("labels") or {}).get("tension_primary") or "无标签" for d in docs)
    form_dist = Counter((d.get("style") or {}).get("form") or "unknown" for d in docs)
    print(f"[3/4] primary_label 分布: {dict(primary_dist.most_common())}")
    print(f"       form 分布: {dict(form_dist.most_common())}")

    # 写出
    with open(output_path, "w", encoding="utf-8") as f:
        for d in docs:
            f.write(json.dumps(d, ensure_ascii=False) + "\n")
    print(f"[4/4] 已写入 {output_path}（{len(docs)} 条）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
