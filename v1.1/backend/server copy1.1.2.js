require('dotenv').config();
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.DEEPSEEK_API_KEY;
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

// 限流配置（内存限流）
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 30;

function rateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!rateLimit.has(ip)) {
        rateLimit.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }

    const data = rateLimit.get(ip);

    if (now > data.resetTime) {
        data.count = 1;
        data.resetTime = now + RATE_LIMIT_WINDOW;
        return next();
    }

    if (data.count >= RATE_LIMIT_MAX) {
        return res.status(429).json({ error: '请求过于频繁，请稍后再试' });
    }

    data.count++;
    next();
}

// SQLite 数据库初始化
const db = new sqlite3.Database('./logs/generation_logs.db', (err) => {
    if (err) {
        console.error('数据库连接失败:', err);
    } else {
        console.log('数据库连接成功');
        initDatabase();
    }
});

function initDatabase() {
    db.exec(`CREATE TABLE IF NOT EXISTS generation_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        mode TEXT NOT NULL,
        op TEXT,
        context_tail TEXT,
        input_state TEXT,
        writer_raw TEXT,
        writer_parsed TEXT,
        critic_pass INTEGER,
        critic_issues TEXT,
        critic_hint TEXT,
        retry_count INTEGER DEFAULT 0,
        final_text TEXT,
        final_state TEXT,
        user_action TEXT,
        response_time_ms INTEGER
    )`);
}

// Session 状态管理（内存）
const sessionState = {
    lastSeedExpression: null,
    lastSeedRelation: null,
    lastDetailAnchor: null,
    lastPolarities: [],
    seedHistory: []  // 保存最近几条 seed，用于相似度检查
};

// Expression 模式定义（表达层）
const EXPRESSION_MODES = {
    daily_real: {
        name: 'daily_real',
        baseWeight: 0.4
    },
    concept: {
        name: 'concept',
        baseWeight: 0.35
    },
    declaration: {
        name: 'declaration',
        baseWeight: 0.25
    }
};

// Relation 模式定义（关系结构层）
const RELATION_MODES = {
    steady: {
        name: 'steady',
        baseWeight: 0.25
    },
    relation: {
        name: 'relation',
        baseWeight: 0.2
    },
    daily_tension: {
        name: 'daily_tension',
        baseWeight: 0.2
    },
    semantic_gap: {
        name: 'semantic_gap',
        baseWeight: 0.15
    },
    boundary: {
        name: 'boundary',
        baseWeight: 0.1
    },
    persona_contrast: {
        name: 'persona_contrast',
        baseWeight: 0.1
    }
};

app.use(express.json({ limit: '10kb' }));
app.use(express.static(__dirname + '/../frontend'));

app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Expression Prompts - 表达层
const EXPRESSION_PROMPTS = {
    concept: `你是"高概念表达生成器"。

气质：压缩、对位、干净、克制

规则：
1. 输出 2–3 句。
2. 不写背景。
3. 不解释原因。
4. 不推进剧情。
5. 不堆砌形容词。
6. 允许语义对位或并置。
7. 不强制细节（除非 detail_anchor=true）。

重点：高压缩、去背景、不抒情`,

    daily_real: `你是"真实生活片段生成器"。

气质：具体、自然、有身体、不戏剧化

规则：
1. 输出 2–3 句。
2. 禁止抽象情绪词堆叠。
3. 必须有至少一个具体动作或物件（若 detail_anchor=true）。
4. 不解释。
5. 不夸张。
6. 不象征化。

重点：具体动作、身体感、日常化`,

    declaration: `你是"情绪化宣言生成器"。

气质：直接、态度清晰、有冲击、少细节

规则：
1. 至少一句为明确态度表达。
2. 不写背景。
3. 不写因果。
4. 不抒情化。
5. 细节非必须（除非 detail_anchor=true）。

重点：态度直接、不抒情、有冲击力`
};

// Relation Prompts - 关系结构层
const RELATION_PROMPTS = {
    steady: `你是"稳定关系生成器"。

规则：
1. 不反差。
2. 不断层。
3. 不极端。
4. 关系立场明确。
5. 单向或双向稳定结构。

重点：稳定、不冲突、不极端`,

    relation: `你是"常规关系生成器"。

规则：
1. 双方立场清晰。
2. 可对峙或偏爱。
3. 不解释。

重点：对峙、偏爱、不对等、默契、口是心非`,

    semantic_gap: `你是"语义断层生成器"。

规则：
1. 强烈行为或态度。
2. 与平静语气或日常内容并置。
3. 不解释。
4. 不夸张。

重点：危险行为 + 温和动作、决绝态度 + 生活细节`,

    boundary: `你是"边界逼近生成器"。

规则：
1. 暗示不可退让。
2. 有风险或代价。
3. 不升级剧情。
4. 不下结论。

重点：预判、赌、强撑、已知后果`,

    daily_tension: `你是"日常张力生成器"。

规则：
1. 小动作。
2. 微妙对抗。
3. 轻压迫。

重点：日常动作、轻冲突、不极端`,

    persona_contrast: `你是"人设反差生成器"。

规则：
1. 性格反差通过行为呈现。
2. 禁止标签式表达。
3. 不写"他是圣人"这类直述。

重点：行为反差、不直述、通过动作呈现`
};

// Relation Op Prompts
const DEEPEN_SYSTEM = `你是"关系强化器"。

基于当前文本和关系状态：
- 提高张力强度
- 加强互动细节
- 不改变关系类型
- 不写新剧情
- 不解释原因

【输入】
context: 最近文本
state: { polarity, initiative, tags }

【规则】
1. 若 polarity ≥ 1 → 更极端。
2. 若 polarity ≤ 0 → 加重冷或疏离。
3. initiative 保持或轻微偏移。
4. tags 不要完全改变。

生成 1-2 句，40-100 字。

必须输出 JSON 格式：
{
  "text": "生成的文本",
  "relation_state": {
    "polarity": -2 | -1 | 0 | 1 | 2,
    "initiative": "A" | "B" | "balanced",
    "tags": ["标签1", "标签2"]
  }
}`;

const PERSPECTIVE_SYSTEM = `你是"关系视角转换器"。

任务：从另一方立场表达当前关系。
- 不改变关系事实。
- 不推进剧情。
- 只改变表达视角。

【规则】
1. initiative 可能改变。
2. polarity 基本保持。
3. tags 保持一致。

生成 1-2 句，40-100 字。

必须输出 JSON 格式：
{
  "text": "生成的文本",
  "relation_state": {
    "polarity": -2 | -1 | 0 | 1 | 2,
    "initiative": "A" | "B" | "balanced",
    "tags": ["标签1", "标签2"]
  }
}`;

const REVEAL_SYSTEM = `你是"关系微揭示器"。

任务：暗示未说出口的态度。
- 不解释原因。
- 不引入新事件。
- 不改变关系结构。

【规则】
1. polarity 轻微上升或下降。
2. initiative 不剧烈变化。
3. tags 可新增一个相关标签。

生成 1-2 句，40-100 字。

必须输出 JSON 格式：
{
  "text": "生成的文本",
  "relation_state": {
    "polarity": -2 | -1 | 0 | 1 | 2,
    "initiative": "A" | "B" | "balanced",
    "tags": ["标签1", "标签2"]
  }
}`;

// Critic Prompt
const CRITIC_SYSTEM = `你是"关系生成评估器（critic）"。

判断文本是否符合"关系驱动生成"标准，并拦截常见失败。

【检查项】
1. 是否出现解释（因为/所以/其实/原来/终于/后来）
2. 是否出现具体设定（地名/职业/组织/世界观）
3. 是否推进剧情（新事件/时间跳跃/结局）
4. 是否文学腔过重（命运/洪流/空气沉默等宏大抽象词）
5. 是否返回完整 JSON 格式
6. 是否过度文学化
7. 是否与上一条过于相似
8. 是否缺乏关系结构

请按标准输出 JSON，不要输出任何额外内容：
{
  "pass": true/false,
  "issues": ["问题描述..."],
  "fix_hint": "一句话指出最重要的修改方向",
  "style_flags": {
    "too_poetic": false,
    "too_explained": false,
    "too_similar_to_last": false
  }
}`;

// 可用标签库
const ALLOWED_TAGS = [
    '偏爱', '对峙', '不对等', '试探', '口是心非',
    '强撑', '明知故犯', '默契', '控制', '失衡', '退让', '看穿'
];

// 选择 Expression 模式
function selectExpression() {
    let weights = {
        daily_real: EXPRESSION_MODES.daily_real.baseWeight,
        concept: EXPRESSION_MODES.concept.baseWeight,
        declaration: EXPRESSION_MODES.declaration.baseWeight
    };

    // 规则：禁止连续相同 expression
    if (sessionState.lastSeedExpression) {
        weights[sessionState.lastSeedExpression] *= 0.3;
    }

    // 归一化权重
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    const normalizedWeights = {};
    for (const [mode, weight] of Object.entries(weights)) {
        normalizedWeights[mode] = weight / totalWeight;
    }

    // 加权随机选择
    const random = Math.random();
    let cumulativeWeight = 0;
    let selectedMode = 'daily_real'; // 默认

    for (const [mode, weight] of Object.entries(normalizedWeights)) {
        cumulativeWeight += weight;
        if (random <= cumulativeWeight) {
            selectedMode = mode;
            break;
        }
    }

    return selectedMode;
}

// 选择 Relation 模式
function selectRelation() {
    let weights = {
        steady: RELATION_MODES.steady.baseWeight,
        relation: RELATION_MODES.relation.baseWeight,
        daily_tension: RELATION_MODES.daily_tension.baseWeight,
        semantic_gap: RELATION_MODES.semantic_gap.baseWeight,
        boundary: RELATION_MODES.boundary.baseWeight,
        persona_contrast: RELATION_MODES.persona_contrast.baseWeight
    };

    // 规则 1：禁止连续相同 relation
    if (sessionState.lastSeedRelation) {
        weights[sessionState.lastSeedRelation] *= 0.3;
    }

    // 规则 2：若上一条为 semantic_gap 且 detail_anchor=true，降低 semantic_gap 权重
    if (sessionState.lastSeedRelation === 'semantic_gap' && sessionState.lastDetailAnchor) {
        weights['semantic_gap'] *= 0.5;
    }

    // 规则 3：极性过高降温
    const recentHighPolarities = sessionState.lastPolarities.filter(p => p >= 1).length;
    if (recentHighPolarities >= 3) {
        weights['semantic_gap'] *= 0.5;
        weights['boundary'] *= 0.5;
        weights['daily_tension'] *= 1.2;
    }

    // 规则 4：极性过低升温
    const recentLowPolarities = sessionState.lastPolarities.filter(p => p <= 0).length;
    if (recentLowPolarities >= 3) {
        weights['semantic_gap'] *= 1.2;
        weights['boundary'] *= 1.2;
    }

    // 归一化权重
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    const normalizedWeights = {};
    for (const [mode, weight] of Object.entries(weights)) {
        normalizedWeights[mode] = weight / totalWeight;
    }

    // 加权随机选择
    const random = Math.random();
    let cumulativeWeight = 0;
    let selectedMode = 'relation'; // 默认

    for (const [mode, weight] of Object.entries(normalizedWeights)) {
        cumulativeWeight += weight;
        if (random <= cumulativeWeight) {
            selectedMode = mode;
            break;
        }
    }

    return selectedMode;
}

// 选择 Detail Anchor
function selectDetailAnchor() {
    return Math.random() < 0.5; // 50% 概率
}

// 组合约束检查
function checkCombinationConstraints(expression, relation, detailAnchor) {
    // 不允许 declaration + boundary + semantic_gap 同时出现
    if (expression === 'declaration' && relation === 'boundary' && detailAnchor) {
        console.log('组合约束: declaration + boundary + detail_anchor=true 被拒绝');
        return false;
    }
    if (expression === 'declaration' && relation === 'semantic_gap' && detailAnchor) {
        console.log('组合约束: declaration + semantic_gap + detail_anchor=true 被拒绝');
        return false;
    }
    return true;
}

// 更新 session 状态
function updateSessionState(expression, relation, detailAnchor, polarity, text) {
    sessionState.lastSeedExpression = expression;
    sessionState.lastSeedRelation = relation;
    sessionState.lastDetailAnchor = detailAnchor;
    sessionState.lastPolarities.push(polarity);
    if (sessionState.lastPolarities.length > 3) {
        sessionState.lastPolarities.shift();
    }
    sessionState.seedHistory.push(text);
    if (sessionState.seedHistory.length > 3) {
        sessionState.seedHistory.shift();
    }
}

app.post('/api/generate', rateLimiter, async (req, res) => {
    const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    const startTime = Date.now();
    
    try {
        const { mode, op, state = {}, context = {} } = req.body;

        // 输入验证
        if (!mode || (mode !== 'seed' && mode !== 'relation_op')) {
            return res.status(400).json({ error: '无效的 mode 参数' });
        }

        if (mode === 'relation_op' && !['deepen', 'perspective', 'reveal'].includes(op)) {
            return res.status(400).json({ error: '无效的 op 参数' });
        }

        const contextText = context.tail || '';
        if (contextText.length > 400) {
            return res.status(400).json({ error: '上下文过长，最多 400 字' });
        }

        // 验证标签（只警告，不拒绝）
        if (state.tags) {
            const invalidTags = state.tags.filter(t => !ALLOWED_TAGS.includes(t));
            if (invalidTags.length > 0) {
                console.log('警告: 包含非标准标签:', invalidTags.join(', '));
            }
        }

        let userPrompt = '';
        let systemPrompt = '';
        let selectedExpression = null;
        let selectedRelation = null;
        let selectedDetailAnchor = null;

        if (mode === 'seed') {
            // 组合选择：Expression × Relation × Detail Anchor
            let attempts = 0;
            const maxAttempts = 10;

            do {
                selectedExpression = selectExpression();
                selectedRelation = selectRelation();
                selectedDetailAnchor = selectDetailAnchor();
                attempts++;

                if (checkCombinationConstraints(selectedExpression, selectedRelation, selectedDetailAnchor)) {
                    break;
                }
            } while (attempts < maxAttempts);

            // 组装 System Prompt
            const expressionPrompt = EXPRESSION_PROMPTS[selectedExpression];
            const relationPrompt = RELATION_PROMPTS[selectedRelation];
            const detailAnchorInstruction = selectedDetailAnchor
                ? `【Detail Anchor = true】\n必须包含至少一个具体可感知的细节（动作/物件/数量/重复/顺序错位/轻微失误）。\n细节不解释情绪、不象征化、不明显服务情绪。`
                : `【Detail Anchor = false】\n不强制细节，可以纯关系表达，不得因此变抽象化。`;

            systemPrompt = `你是"装配式关系生成器"（V1.1.2）。

【Expression Layer - ${selectedExpression}】
${expressionPrompt}

【Relation Layer - ${selectedRelation}】
${relationPrompt}

${detailAnchorInstruction}

【总体规则】
1. 不生成剧情。
2. 不解释因果。
3. 不绑定设定。
4. 不追求文学腔。
5. 只操作"关系状态"。

必须输出 JSON 格式：
{
  "text": "生成的文本",
  "meta": {
    "expression": "${selectedExpression}",
    "relation": "${selectedRelation}",
    "detail_anchor": ${selectedDetailAnchor},
    "relation_state": {
      "polarity": -2 | -1 | 0 | 1 | 2,
      "initiative": "A" | "B" | "balanced"
    }
  }
}

禁止输出任何解释性文字。`;

            userPrompt = '生成一个新的关系原型。不引用历史文本。';
            console.log(`选择的组合: Expression=${selectedExpression}, Relation=${selectedRelation}, DetailAnchor=${selectedDetailAnchor}`);
        } else if (mode === 'relation_op') {
            const { tail } = context;
            const stateStr = JSON.stringify(state, null, 2);

            if (op === 'deepen') {
                systemPrompt = DEEPEN_SYSTEM;
                userPrompt = `【上下文】\n${tail || '（无）'}\n\n【当前状态】\n${stateStr}`;
            } else if (op === 'perspective') {
                systemPrompt = PERSPECTIVE_SYSTEM;
                userPrompt = `【上下文】\n${tail || '（无）'}\n\n【当前状态】\n${stateStr}`;
            } else if (op === 'reveal') {
                systemPrompt = REVEAL_SYSTEM;
                userPrompt = `【上下文】\n${tail || '（无）'}\n\n【当前状态】\n${stateStr}`;
            }
        }

        if (!userPrompt) {
            return res.status(400).json({ error: '无效的请求参数' });
        }

        // Writer 调用
        let result = await callWriter(systemPrompt, userPrompt);
        
        // Critic 调用（验证 JSON 格式和质量）
        let criticResult = null;
        try {
            criticResult = await callCritic(result.text);
        } catch (e) {
            console.error('Critic 调用失败，跳过:', e);
            // Critic 失败时，尝试解析 JSON
            result = parseJSONResult(result.text);
        }

        // 如果 Critic 返回 pass=false，重试一次
        let retryCount = 0;
        if (criticResult && !criticResult.pass && retryCount === 0) {
            retryCount++;
            console.log('Critic 未通过，重试...');
            if (criticResult.fix_hint) {
                userPrompt += '\n\n【修改建议】\n' + criticResult.fix_hint;
            }
            result = await callWriter(systemPrompt, userPrompt);
            try {
                criticResult = await callCritic(result.text);
            } catch (e) {
                console.error('重试后 Critic 失败:', e);
            }
        }

        // 解析 JSON 结果
        const parsedResult = parseJSONResult(result.text);

        const responseTime = Date.now() - startTime;

        console.log({
            timestamp: new Date().toISOString(),
            mode,
            op,
            expression: selectedExpression,
            relation: selectedRelation,
            detail_anchor: selectedDetailAnchor,
            contextLength: contextText.length,
            outputLength: parsedResult.text?.length || 0,
            retry: retryCount,
            critic: criticResult
        });

        // 更新会话状态（仅 seed 模式）
        if (mode === 'seed' && parsedResult.meta?.relation_state) {
            updateSessionState(
                parsedResult.meta.expression || selectedExpression,
                parsedResult.meta.relation || selectedRelation,
                parsedResult.meta.detail_anchor !== undefined ? parsedResult.meta.detail_anchor : selectedDetailAnchor,
                parsedResult.meta.relation_state.polarity || 0,
                parsedResult.text
            );
        }

        // 记录到数据库
        logGeneration(requestId, mode, op, contextText, state, result.text,
            JSON.stringify(parsedResult), criticResult, retryCount, parsedResult, responseTime);

        // 构建返回格式
        const responseData = {
            text: parsedResult.text || result.text,
            meta: {
                retry: retryCount,
                critic: criticResult || { pass: true, issues: [], fix_hint: '' },
                confidence: criticResult ? 0.85 : 0.75
            }
        };

        // 如果是 seed 模式，返回完整的 meta 信息
        if (mode === 'seed') {
            responseData.meta = {
                ...responseData.meta,
                expression: parsedResult.meta?.expression || selectedExpression,
                relation: parsedResult.meta?.relation || selectedRelation,
                detail_anchor: parsedResult.meta?.detail_anchor !== undefined ? parsedResult.meta.detail_anchor : selectedDetailAnchor,
                relation_state: parsedResult.meta?.relation_state || { polarity: 0, initiative: 'balanced' }
            };
        } else {
            // relation_op 模式保持原有格式
            responseData.relation_state = parsedResult.relation_state;
        }

        res.json(responseData);

    } catch (error) {
        const responseTime = Date.now() - startTime;
        console.error('生成错误:', error);
        res.status(500).json({ error: '生成失败，请稍后重试' });
    }
});

// 数据库记录函数
function logGeneration(requestId, mode, op, contextTail, state, writerRaw, writerParsed,
    criticResult, retryCount, finalResult, responseTime) {
    const stmt = db.prepare(`
        INSERT INTO generation_logs
        (request_id, mode, op, context_tail, input_state, writer_raw, writer_parsed,
         critic_pass, critic_issues, critic_hint, retry_count, final_text, final_state, response_time_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
        requestId,
        mode,
        op || null,
        contextTail,
        JSON.stringify(state),
        writerRaw,
        writerParsed,
        criticResult ? (criticResult.pass ? 1 : 0) : null,
        criticResult ? JSON.stringify(criticResult.issues || []) : null,
        criticResult ? criticResult.fix_hint : null,
        retryCount,
        finalResult.text || '',
        JSON.stringify(finalResult.relation_state),
        responseTime
    );
}

// 记录用户操作
app.post('/api/log-action', (req, res) => {
    const { request_id, action } = req.body;
    if (!request_id || !action) {
        return res.status(400).json({ error: '缺少参数' });
    }

    db.run(`UPDATE generation_logs SET user_action = ? WHERE request_id = ?`,
        [action, request_id],
        (err) => {
            if (err) {
                console.error('更新用户操作失败:', err);
                return res.status(500).json({ error: '更新失败' });
            }
            res.json({ success: true });
        }
    );
});

async function callWriter(systemPrompt, userPrompt) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000); // 60秒超时

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                max_tokens: 200,
                temperature: 0.8
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`DeepSeek API 错误: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        return { text: data.choices[0].message.content.trim() };
    } catch (error) {
        clearTimeout(timeout);
        throw error;
    }
}

async function callCritic(text) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30秒超时

    try {
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: [
                    { role: 'system', content: CRITIC_SYSTEM },
                    { role: 'user', content: `请评估下面文本：\n\n【文本】\n<<<TEXT>>>\n${text}\n<<<TEXT>>>` }
                ],
                max_tokens: 150,
                temperature: 0.3
            }),
            signal: controller.signal
        });

        clearTimeout(timeout);

        if (!response.ok) {
            throw new Error(`Critic API 错误: ${response.status}`);
        }

        const data = await response.json();
        const content = data.choices[0].message.content.trim();

        // 解析 Critic JSON
        const match = content.match(/\{[\s\S]*\}/);
        if (!match) {
            throw new Error('Critic 返回格式错误');
        }

        return JSON.parse(match[0]);
    } catch (error) {
        clearTimeout(timeout);
        throw error;
    }
}

function parseJSONResult(text) {
    try {
        // 尝试提取 JSON
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
            const parsed = JSON.parse(match[0]);

            // 兼容新旧格式
            // 旧格式: { text, relation_state }
            // 新格式 (V1.1.2): { text, meta: { expression, relation, detail_anchor, relation_state } }
            if (parsed.meta && parsed.meta.relation_state) {
                // 新格式，直接返回
                return parsed;
            } else if (parsed.relation_state) {
                // 旧格式，转换为新格式
                return {
                    text: parsed.text,
                    meta: {
                        expression: 'daily_real', // 默认值
                        relation: 'relation', // 默认值
                        detail_anchor: false, // 默认值
                        relation_state: parsed.relation_state
                    }
                };
            } else if (parsed.text) {
                // 只有 text 字段
                return {
                    text: parsed.text,
                    meta: {
                        expression: 'daily_real',
                        relation: 'relation',
                        detail_anchor: false,
                        relation_state: { polarity: 0, initiative: 'balanced' }
                    }
                };
            }

            return parsed;
        }
        return { text, meta: { expression: 'daily_real', relation: 'relation', detail_anchor: false, relation_state: null } };
    } catch (e) {
        console.error('JSON 解析失败:', e);
        return { text, meta: { expression: 'daily_real', relation: 'relation', detail_anchor: false, relation_state: null } };
    }
}

app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.1.2', timestamp: new Date().toISOString() });
});

// 设置请求超时
app.use((req, res, next) => {
    res.setTimeout(120000, () => {
        console.log('请求超时');
        res.status(504).json({ error: '请求超时，请稍后重试' });
    });
    next();
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`It Clicks V1.1.2 Server running on port ${PORT}`);
    console.log(`API endpoint: http://localhost:${PORT}/api/generate`);
    console.log(`Expression × Relation × Detail Anchor装配式生成系统已启用`);
});
