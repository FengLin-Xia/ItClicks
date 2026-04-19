# It Clicks V1.1

## 项目结构

```
v1.1/
├── frontend/           # 前端代码
│   ├── index.html     # 起始页（关系原型生成）
│   └── canvas.html    # 画布页（关系操作）
├── backend/           # 后端代码
│   ├── server.js      # Node.js 服务器
│   ├── package.json
│   └── .env           # 环境变量（API 密钥）
├── nginx.conf         # Nginx 配置
├── docker-compose.yml # Docker 编排
├── prdv1.1.md       # 产品需求文档
└── prompt_spec_v1.1.md # Prompt 规范文档
```

## 部署到 Lighthouse

```bash
docker-compose up -d
```

## 核心功能

- **起始页**：关系原型生成（seed）
  - 自动生成关系原型文本
  - 关系状态可视化（极性、主动权、标签）
  - 换一换 / 代一代

- **画布页**：关系驱动写作
  - 关系状态可视化（顶部）
  - 全屏自由画布
  - 三个核心操作：
    - ⚡ 压一层（deepen）：强化当前关系极性
    - ↔ 换视角（perspective）：从另一方立场表达
    - 👁 暴露一点（reveal）：暗示隐藏态度
  - 建议卡片：可插入或放弃

## API

### POST /api/generate

Request:
```json
{
  "mode": "seed" | "relation_op",
  "op": "deepen" | "perspective" | "reveal",
  "state": {
    "polarity": -2 | -1 | 0 | 1 | 2,
    "initiative": "A" | "B" | "balanced",
    "tags": ["偏爱", "对峙"]
  },
  "context": {
    "tail": "最近200-400字文本"
  }
}
```

Response:
```json
{
  "text": "生成文本",
  "relation_state": {
    "polarity": 1,
    "initiative": "A",
    "tags": ["偏爱", "试探"]
  },
  "meta": {
    "retry": 0,
    "critic": {
      "pass": true,
      "issues": [],
      "fix_hint": ""
    },
    "confidence": 0.85
  }
}
```

## 关系状态可视化

### 极性（Polarity）
- 范围：-2（冷）到 +2（极端）
- UI：横向滑块，实时显示当前值

### 主动权（Initiative）
- 枚举：A 主导 / 平衡 / B 主导
- UI：左右偏移图标，显示当前主导方

### 标签（Tags）
- 库：偏爱、对峙、不对等、试探、口是心非、强撑、明知故犯、默契、控制、失衡、退让、看穿
- UI：Tag Chip 形式，最多 2 个

## 与 V1.0 的区别

| 特性 | V1.0 | V1.1 |
|------|--------|--------|
| 生成模式 | seed / assist | seed / relation_op |
| 操作类型 | continue / rewrite | deepen / perspective / reveal |
| 状态模型 | tone（克制/浓烈） | polarity / initiative / tags |
| 可视化 | 无 | 关系状态可视化 |
| Prompt | Writer 单阶段 | Writer + Critic 双阶段 |
| 返回格式 | 纯文本 | 文本 + relation_state |
| 上下文策略 | around_cursor / tail | 只传 tail（200-400字） |
