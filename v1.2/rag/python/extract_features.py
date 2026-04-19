#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把检索到的锚点列表归纳成「风格特征包」dict，供生成 prompt 使用。
当前为规则版（不调大模型）；后续可改为 LLM 总结。

用法:
  python extract_features.py --anchors-json '[...]'   # 或由 retrieve_rag 管道传入
  或在代码中: from extract_features import extract_anchor_features; extract_anchor_features(anchor_docs)
"""
import argparse
import json
import re
from pathlib import Path


def _avg_len(texts):
    if not texts:
        return "0字"
    lens = [len(t.strip()) for t in texts if t and isinstance(t, str)]
    if not lens:
        return "0字"
    avg = sum(lens) / len(lens)
    return f"{int(avg)}字"


def _punctuation_style(texts):
    """粗判：短句+顿号/省略 等。"""
    if not texts:
        return "未知"
    full = " ".join(t.strip() for t in texts if t)
    has_dun = "、" in full
    has_ellipsis = "…" in full or "..." in full or "。。" in full
    short_sent = sum(1 for t in texts if t and 0 < len(t.strip()) < 30) > len(texts) / 2
    parts = []
    if short_sent:
        parts.append("短句")
    if has_dun:
        parts.append("顿号")
    if has_ellipsis:
        parts.append("省略")
    return "+".join(parts) if parts else "常规"


def _dialogue_turns(texts):
    """粗略统计对话轮数（引号内算一轮）。"""
    if not texts:
        return 0
    total = 0
    for t in texts:
        if not t:
            continue
        total += len(re.findall(r"[「『\"'].*?[」』\"]", t)) + len(re.findall(r"[“'].*?["']", t))
    return min(5, total)  # 上限 5


def _ending_style(texts):
    """结尾风格：留白/问句/感叹等。"""
    if not texts:
        return "未知"
    endings = []
    for t in texts:
        t = (t or "").strip()
        if not t:
            continue
        last = t[-1] if t else ""
        if last in "….":
            endings.append("留白")
        elif last in "？?":
            endings.append("问句")
        elif last in "！!":
            endings.append("感叹")
        elif last in "。":
            endings.append("句号收尾")
    if not endings:
        return "未知"
    from collections import Counter
    most = Counter(endings).most_common(1)[0][0]
    return most


def _hook_position(texts):
    """hook 是否在第一句（首句是否短、是否问句/对比）。"""
    if not texts:
        return "未知"
    first_lines = []
    for t in texts:
        t = (t or "").strip()
        if t:
            first_sent = re.split(r"[。！？…]", t)[0].strip()
            if first_sent:
                first_lines.append(first_sent)
    if not first_lines:
        return "未知"
    avg_first_len = sum(len(s) for s in first_lines) / len(first_lines)
    if avg_first_len <= 15:
        return "首句短/像 hook"
    return "第一句"


def _lexical_tone(texts):
    """粗判：克制、少形容词、多动词等（启发式）。"""
    if not texts:
        return "未知"
    full = " ".join(t.strip() for t in texts if t)
    adj_count = len(re.findall(r"很|特别|非常|真的|好|太|那种|这种", full))
    verb_ish = len(re.findall(r"看|想|觉得|说|做|是|有|让|被", full))
    n = len(full)
    if n < 10:
        return "未知"
    if adj_count / n * 100 < 2 and verb_ish / n * 100 > 3:
        return "克制、少形容词、多动词"
    if adj_count / n * 100 > 5:
        return "形容词较多"
    return "中性"


def extract_anchor_features(anchor_docs):
    """
    输入: list[dict] 锚点文档（至少含 "text"）
    输出: dict 风格特征包，格式见 RAG_V0.1.md
    """
    texts = [d.get("text") or "" for d in anchor_docs]
    return {
        "anchor_features": {
            "avg_len": _avg_len(texts),
            "punctuation": _punctuation_style(texts),
            "dialogue_turns": _dialogue_turns(texts),
            "ending": _ending_style(texts),
            "hook_position": _hook_position(texts),
            "lexical_tone": _lexical_tone(texts),
        }
    }


def main():
    parser = argparse.ArgumentParser(description="Extract style feature pack from anchor docs")
    parser.add_argument("--anchors-json", type=str, default=None,
                        help="JSON 数组字符串，每项为锚点 doc（含 text）")
    parser.add_argument("--anchors-file", type=str, default=None,
                        help="或从文件读 anchors（每行一个 JSON doc）")
    args = parser.parse_args()

    if args.anchors_file:
        docs = []
        with open(args.anchors_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    docs.append(json.loads(line))
    elif args.anchors_json:
        docs = json.loads(args.anchors_json)
    else:
        print("请提供 --anchors-json 或 --anchors-file")
        return 1

    pack = extract_anchor_features(docs)
    print(json.dumps(pack, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
