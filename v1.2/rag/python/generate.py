#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Plan → Write 生成流程：先检索锚点 → 抽特征包 → 注入生成 prompt。
本脚本只做到「组好 prompt + 特征包」；实际调用大模型需你接入 API（见项目根目录 API.md 等）。

用法（在 rag/ 目录下）:
  python generate.py --query "想看那种欲言又止的告白" -K 5
  python generate.py --query "家0和家1的暧昧" --form dialogue --out prompt.txt
"""
import argparse
import json
from pathlib import Path

from retrieve_rag import retrieve_anchors, _default_rag_dir
from extract_features import extract_anchor_features


def build_prompt(feature_pack, task_description=None, extra_instructions=None):
    """
    根据 RAG 特征包组生成用的 prompt 文本。
    """
    lines = [
        "请按以下风格特征写一段代餐向短文案，不要照抄任何已有句子。",
        "",
        "【风格特征】",
        json.dumps(feature_pack.get("anchor_features") or {}, ensure_ascii=False, indent=2),
        "",
    ]
    if task_description:
        lines.append("【写作要求】")
        lines.append(task_description)
        lines.append("")
    if extra_instructions:
        lines.append("【补充说明】")
        lines.append(extra_instructions)
    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Retrieve anchors → extract features → build prompt")
    parser.add_argument("--rag-dir", type=str, default=str(_default_rag_dir()), help="RAG 目录")
    parser.add_argument("--query", "-q", type=str, default="", help="查询/意图描述，用于向量检索")
    parser.add_argument("--tension-primary", type=str, default=None)
    parser.add_argument("--form", type=str, default=None, choices=["dialogue", "narrative"])
    parser.add_argument("--engagement-min", type=float, default=None)
    parser.add_argument("-K", "--top-k", type=int, default=5)
    parser.add_argument("--task", type=str, default=None, help="写作要求/任务描述")
    parser.add_argument("--out", "-o", type=str, default=None, help="将 prompt 写入该文件")
    args = parser.parse_args()

    # 1) 检索锚点
    anchor_docs, anchor_ids = retrieve_anchors(
        args.rag_dir,
        query_text=args.query or None,
        tension_primary=args.tension_primary,
        form=args.form,
        engagement_min=args.engagement_min,
        top_k=args.top_k,
    )
    if not anchor_docs:
        print("未检索到锚点，请检查 RAG 库或放宽条件。")
        return 1
    print(f"检索到 {len(anchor_docs)} 条锚点: {anchor_ids}")

    # 2) 抽特征包
    feature_pack = extract_anchor_features(anchor_docs)
    print("\n【特征包】")
    print(json.dumps(feature_pack, ensure_ascii=False, indent=2))

    # 3) 组 prompt
    prompt_text = build_prompt(
        feature_pack,
        task_description=args.task,
        extra_instructions=None,
    )
    print("\n【生成用 Prompt】")
    print(prompt_text)

    if args.out:
        Path(args.out).write_text(prompt_text, encoding="utf-8")
        print(f"\n已写入 {args.out}")

    print("\n（实际调用大模型时，将上述 prompt 作为 system/user 内容传入即可；anchor_ids 用于追溯。）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
