require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { buildSystemPromptFromSchema, buildUserPromptForCustomize } = require('./schema_engine.js');
const { extractSchemaFromInput } = require('./extract_schema.js');
const app = express();

// RAG 语感锚点（与 preseed 同源，仅 /api/customize 可选使用）
const RAG_ANCHORS_PATH = path.join(__dirname, '..', 'rag', 'corpus', 'anchors.jsonl');
let cachedRagAnchors = [];
function loadRagAnchors() {
    if (cachedRagAnchors.length) return cachedRagAnchors;
    if (!fs.existsSync(RAG_ANCHORS_PATH)) return [];
    try {
        const lines = fs.readFileSync(RAG_ANCHORS_PATH, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
        for (const line of lines) {
            try {
                const obj = JSON.parse(line);
                if (obj && obj.text) cachedRagAnchors.push(obj);
            } catch { /* ignore */ }
        }
    } catch (e) { console.warn('RAG anchors load failed:', e.message); }
    return cachedRagAnchors;
}
function sampleRagSnippets(n) {
    const anchors = loadRagAnchors();
    if (!anchors.length) return [];
    const out = [];
    for (let i = 0; i < n; i++) {
        const t = (anchors[Math.floor(Math.random() * anchors.length)].text || '').trim();
        out.push(t.length > 60 ? t.slice(0, 60) + '…' : t);
    }
    return out;
}
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.DEEPSEEK_API_KEY;
const API_URL = 'https://api.deepseek.com/v1/chat/completions';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

function requireAdmin(req, res, next) {
    if (!ADMIN_TOKEN) {
        // 未配置 ADMIN_TOKEN 时不做保护（仅用于开发/自用）
        return next();
    }
    const token = req.headers['x-admin-token'] || req.query.token;
    if (token === ADMIN_TOKEN) return next();
    return res.status(401).json({ error: '未授权' });
}

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
        response_time_ms INTEGER,
        schema_json TEXT
    )`);

    // V1.2 刷流内容池（含 Schema 字段，供后续均匀分布等）
    db.exec(`CREATE TABLE IF NOT EXISTS feed_pool (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        relation_primary TEXT,
        relation_secondary TEXT,
        form TEXT,
        intensity TEXT,
        hook TEXT,
        tone_json TEXT,
        variant TEXT
    )`);

    // V1.2 埋点事件流（append-only）
    db.exec(`CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event TEXT NOT NULL,
        ts INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        page TEXT NOT NULL,
        app_version TEXT NOT NULL,
        platform TEXT NOT NULL,
        request_id TEXT,
        properties TEXT NOT NULL,
        ua TEXT,
        ip TEXT,
        received_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // V1.2 Schema：为 customize 增加 schema_json（忽略已存在）
    db.run('ALTER TABLE generation_logs ADD COLUMN schema_json TEXT', (err) => {
        if (err && !/duplicate column/i.test(err.message)) console.error('schema_json migration:', err);
    });
    // V1.2 feed_pool Schema 列（老库补列）
    ['relation_primary', 'relation_secondary', 'form', 'intensity', 'hook', 'tone_json', 'variant'].forEach((col) => {
        db.run(`ALTER TABLE feed_pool ADD COLUMN ${col} TEXT`, (err) => {
            if (err && !/duplicate column/i.test(err.message)) console.error(`feed_pool ${col} migration:`, err);
        });
    });

    db.get('SELECT COUNT(*) as c FROM feed_pool', (err, row) => {
        if (err) return console.error('feed_pool count error:', err);
        const count = row ? row.c : 0;
        if (count < 10) {
            console.log(`Feed pool has ${count} items, filling to 30...`);
            fillFeedPool(30).then(() => console.log('Feed pool filled.')).catch(e => console.error('Feed pool fill error:', e));
        }
    });
}

// Session 状态管理（内存）
const sessionState = {
    lastSeedMode: null,
    lastSeedForm: null,
    lastPolarities: [],
    seedHistory: []  // 保存最近几条 seed，用于相似度检查
};

// Tension Mode（张力模式）- 核心驱动
const TENSION_MODES = {
    core_action: {
        name: 'core_action',
        baseWeight: 0.4,
        description: '关系爆点'
    },
    contrast: {
        name: 'contrast',
        baseWeight: 0.3,
        description: '预期差'
    },
    suspended: {
        name: 'suspended',
        baseWeight: 0.3,
        description: '悬住型'
    }
};

// Expression Form（表达形式）- 外壳
const EXPRESSION_FORMS = {
    high_concept: {
        name: 'high_concept',
        description: '高概念句'
    },
    daily_scene: {
        name: 'daily_scene',
        description: '生活片段'
    },
    emotional_line: {
        name: 'emotional_line',
        description: '情绪宣言'
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

// ---------- V1.2 埋点：POST /track（insert-only） ----------
app.post('/track', (req, res) => {
    const b = req.body || {};
    const event = b.event;
    const ts = b.ts;
    const user_id = b.user_id;
    const device_id = b.device_id;
    const session_id = b.session_id;
    const page = b.page;
    const app_version = b.app_version;
    const platform = b.platform;
    const request_id = b.request_id || null;
    const properties = typeof b.properties === 'object' ? JSON.stringify(b.properties) : (b.properties || '{}');

    if (!event || ts == null || !user_id || !device_id || !session_id || !page || !app_version || !platform) {
        return res.status(400).json({ error: '缺少必填字段' });
    }

    const ua = req.get('user-agent') || null;
    const ip = req.ip || req.connection?.remoteAddress || null;

    db.run(
        `INSERT INTO events (event, ts, user_id, device_id, session_id, page, app_version, platform, request_id, properties, ua, ip)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [event, ts, user_id, device_id, session_id, page, app_version, platform, request_id, properties, ua, ip],
        (err) => {
            if (err) {
                console.error('track insert error:', err);
                return res.status(500).json({ error: '写入失败' });
            }
            res.status(204).send();
        }
    );
});

// V1.1.3 全局禁止规则
const GLOBAL_RULES = `
【全局禁止规则】
1. 禁止人物概括性描述（会、总是、一向、向来等）
2. 禁止外部职业或社会宏大设定
3. 禁止解释行为动机
4. 禁止总结关系状态
5. 不超过三句

【必须遵守】
- 文本必须围绕两人关系
- 必须发生于一次具体片段
- 不解释、不写人物设定
- 不输出分析或说明
`;

// Tension Mode Prompts - 张力模式规则
const TENSION_MODE_RULES = {
    core_action: `
【core_action 模式（关系爆点）】

定义：行为必须直接改变两人关系状态。

规则：
- 行为必须直接作用于对方
- 不得是外部社会行为（如谈判、合同、公司等）
- 必须是一次具体发生的片段

示例气质（不是模板）：
- 在她面前宣布某个不可回退的决定
- 把象征关系的物件处理掉
- 在对方最不该出现的时候出现`,

    contrast: `
【contrast 模式（预期差）】

定义：第二句必须轻微违背第一句的自然推论。

规则：
- 不允许夸张反转
- 违背必须发生在两人关系内部
- 不可进入外部世界

例如：
- 说不见 → 却等
- 赶走 → 门没锁
- 删掉 → 密码没改`,

    suspended: `
【suspended 模式（悬住型）】

定义：第二句不解释、不反转，只增加新的物理或情绪维度。

规则：
- 可以增加环境
- 可以增加物理状态
- 可以增加未完成动作
- 不做总结

例如：
- 灯没关
- 笔帽没合
- 手机还在充电`
};

// Expression Form Prompts - 表达形式规则
const EXPRESSION_FORM_RULES = {
    high_concept: `
【high_concept 表达形式】

- 可以使用概念角色（如正义/反派）
- 但必须落在具体行为上
- 不可写设定说明`,

    daily_scene: `
【daily_scene 表达形式】

- 优先使用日常空间
- 但不强制生活化`,

    emotional_line: `
【emotional_line 表达形式】

- 可含一句对话
- 不可使用长段抒情`
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

// 可用标签库（relation_op 校验用）
const ALLOWED_TAGS = [
    '偏爱', '对峙', '不对等', '试探', '口是心非',
    '强撑', '明知故犯', '默契', '控制', '失衡', '退让', '看穿'
];

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

// 选择 Tension Mode（核心驱动）
function selectTensionMode() {
    // V1.1.3 使用固定权重，不需要调整
    const weights = {
        core_action: TENSION_MODES.core_action.baseWeight,
        contrast: TENSION_MODES.contrast.baseWeight,
        suspended: TENSION_MODES.suspended.baseWeight
    };

    // 归一化权重
    const totalWeight = Object.values(weights).reduce((sum, w) => sum + w, 0);
    const normalizedWeights = {};
    for (const [mode, weight] of Object.entries(weights)) {
        normalizedWeights[mode] = weight / totalWeight;
    }

    // 加权随机选择
    const random = Math.random();
    let cumulativeWeight = 0;
    let selectedMode = 'core_action'; // 默认

    for (const [mode, weight] of Object.entries(normalizedWeights)) {
        cumulativeWeight += weight;
        if (random <= cumulativeWeight) {
            selectedMode = mode;
            break;
        }
    }

    return selectedMode;
}

// 选择 Expression Form（表达形式）
function selectExpressionForm() {
    // 等概率选择三种表达形式
    const forms = ['high_concept', 'daily_scene', 'emotional_line'];
    return forms[Math.floor(Math.random() * forms.length)];
}

// 更新 session 状态
function updateSessionState(mode, form, polarity, text) {
    sessionState.lastSeedMode = mode;
    sessionState.lastSeedForm = form;
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
        let selectedMode = null;
        let selectedForm = null;

        if (mode === 'seed') {
            // V1.1.3: Tension Mode × Expression Form
            selectedMode = selectTensionMode();
            selectedForm = selectExpressionForm();

            // 组装 System Prompt
            const tensionRule = TENSION_MODE_RULES[selectedMode];
            const formRule = EXPRESSION_FORM_RULES[selectedForm];

            systemPrompt = `你正在生成一段两人关系的短文本片段。

张力模式：${selectedMode}
表达形式：${selectedForm}

${tensionRule}

${formRule}

${GLOBAL_RULES}

必须输出 JSON 格式：
{
  "text": "生成的文本",
  "meta": {
    "tension_mode": "${selectedMode}",
    "expression_form": "${selectedForm}"
  }
}

禁止输出任何解释性文字。`;

            userPrompt = '生成一个新的关系片段。不引用历史文本。';
            console.log(`V1.1.3 生成: TensionMode=${selectedMode}, Form=${selectedForm}`);
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
            tension_mode: selectedMode,
            expression_form: selectedForm,
            contextLength: contextText.length,
            outputLength: parsedResult.text?.length || 0,
            retry: retryCount,
            critic: criticResult
        });

        // 更新会话状态（仅 seed 模式）
        if (mode === 'seed') {
            updateSessionState(
                selectedMode,
                selectedForm,
                0, // V1.1.3 不再强制返回 polarity
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
                tension_mode: parsedResult.meta?.tension_mode || selectedMode,
                expression_form: parsedResult.meta?.expression_form || selectedForm
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

// 自定义生成写入 generation_logs（mode=customize），含 schema_json
function logCustomizeGeneration(requestId, userInput, refText, writerRaw, finalText, responseTimeMs, schemaJson) {
    db.run(
        `INSERT INTO generation_logs
         (request_id, mode, op, context_tail, input_state, writer_raw, writer_parsed,
          critic_pass, critic_issues, critic_hint, retry_count, final_text, final_state, response_time_ms, schema_json)
         VALUES (?, 'customize', NULL, ?, ?, ?, ?, NULL, NULL, NULL, 0, ?, NULL, ?, ?)`,
        [requestId, refText || '', JSON.stringify({ input: userInput }), writerRaw || '', finalText || '', responseTimeMs, schemaJson || null],
        (err) => { if (err) console.error('logCustomizeGeneration error:', err); }
    );
}

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

// 服务端写入 events（无客户端身份时用占位）
function insertEventServer(event, request_id, properties) {
    const ts = Date.now();
    const propsStr = typeof properties === 'object' ? JSON.stringify(properties) : (properties || '{}');
    db.run(
        `INSERT INTO events (event, ts, user_id, device_id, session_id, page, app_version, platform, request_id, properties)
         VALUES (?, ?, 'server', 'server', '', 'customize', '1.2.0', 'web', ?, ?)`,
        [event, ts, request_id || null, propsStr],
        (err) => { if (err) console.error('insertEventServer error:', err); }
    );
}

// 记录用户操作（并追加写一条 user_action 事件到 events）
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
            insertEventServer('user_action', request_id, { action: action });
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

            // 兼容多种格式
            // V1.1.3 新格式: { text, meta: { tension_mode, expression_form } }
            // V1.1.2 格式: { text, meta: { expression, relation, detail_anchor, relation_state } }
            // 旧格式: { text, relation_state }

            if (parsed.meta && parsed.meta.tension_mode) {
                // V1.1.3 新格式，直接返回
                return parsed;
            } else if (parsed.meta && parsed.meta.relation_state) {
                // V1.1.2 格式，转换
                return {
                    text: parsed.text,
                    meta: {
                        tension_mode: 'core_action', // 默认值
                        expression_form: 'daily_scene' // 默认值
                    }
                };
            } else if (parsed.relation_state) {
                // 旧格式，转换
                return {
                    text: parsed.text,
                    meta: {
                        tension_mode: 'core_action',
                        expression_form: 'daily_scene'
                    }
                };
            } else if (parsed.text) {
                // 只有 text 字段
                return {
                    text: parsed.text,
                    meta: {
                        tension_mode: 'core_action',
                        expression_form: 'daily_scene'
                    }
                };
            }

            return parsed;
        }
        return { text, meta: { tension_mode: 'core_action', expression_form: 'daily_scene' } };
    } catch (e) {
        console.error('JSON 解析失败:', e);
        return { text, meta: { tension_mode: 'core_action', expression_form: 'daily_scene' } };
    }
}

// ---------- V1.2 刷流内容池 ----------
async function generateOneSeed() {
    const selectedMode = selectTensionMode();
    const selectedForm = selectExpressionForm();
    const tensionRule = TENSION_MODE_RULES[selectedMode];
    const formRule = EXPRESSION_FORM_RULES[selectedForm];
    const systemPrompt = `你正在生成一段两人关系的短文本片段。

张力模式：${selectedMode}
表达形式：${selectedForm}

${tensionRule}

${formRule}

${GLOBAL_RULES}

必须输出 JSON 格式：
{
  "text": "生成的文本",
  "meta": {
    "tension_mode": "${selectedMode}",
    "expression_form": "${selectedForm}"
  }
}

禁止输出任何解释性文字。`;
    const userPrompt = '生成一个新的关系片段。不引用历史文本。';
    const result = await callWriter(systemPrompt, userPrompt);
    const parsed = parseJSONResult(result.text);
    return (parsed.text || result.text || '').trim();
}

function fillFeedPool(targetCount) {
    return new Promise((resolve, reject) => {
        db.get('SELECT COUNT(*) as c FROM feed_pool', (err, row) => {
            if (err) return reject(err);
            const current = row ? row.c : 0;
            if (current >= targetCount) return resolve();
            const need = targetCount - current;
            let done = 0;
            function next() {
                if (done >= need) return resolve();
                generateOneSeed()
                    .then((text) => {
                        if (!text) return next();
                        db.run('INSERT INTO feed_pool (text) VALUES (?)', [text], (e) => {
                            if (e) console.error('feed_pool insert error:', e);
                            done++;
                            setTimeout(next, 500);
                        });
                    })
                    .catch((e) => {
                        console.error('generateOneSeed error:', e);
                        done++;
                        setTimeout(next, 1000);
                    });
            }
            next();
        });
    });
}

app.get('/api/feed', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 10, 20);
    const mode = req.query.mode === 'random' ? 'random' : 'cursor';

    // 随机模式：按随机顺序取样，并尽量避开本次会话里已经看过的 id
    if (mode === 'random') {
        let excludeIds = [];
        if (req.query.exclude) {
            excludeIds = String(req.query.exclude)
                .split(',')
                .map((s) => parseInt(s, 10))
                .filter((n) => Number.isFinite(n) && n > 0);
            // 控制一下长度，避免 SQL 里 IN 过长
            if (excludeIds.length > 200) {
                excludeIds = excludeIds.slice(-200);
            }
        }
        let sql = 'SELECT id, text, created_at FROM feed_pool';
        const params = [];
        if (excludeIds.length) {
            sql += ` WHERE id NOT IN (${excludeIds.map(() => '?').join(',')})`;
            params.push(...excludeIds);
        }
        sql += ' ORDER BY RANDOM() LIMIT ?';
        params.push(limit);

        return db.all(sql, params, (err, rows) => {
            if (err) {
                console.error('feed query error (random):', err);
                return res.status(500).json({ error: '获取列表失败' });
            }
            const items = rows || [];
            res.json({
                items: items.map((r) => ({ id: r.id, text: r.text, created_at: r.created_at })),
                next_cursor: null
            });
        });
    }

    // 默认模式：旧的基于 cursor 的倒序分页
    const cursor = req.query.cursor ? parseInt(req.query.cursor, 10) : null;
    let sql = 'SELECT id, text, created_at FROM feed_pool';
    const params = [];
    if (cursor) {
        sql += ' WHERE id < ?';
        params.push(cursor);
    }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(limit + 1);
    db.all(sql, params, (err, rows) => {
        if (err) {
            console.error('feed query error:', err);
            return res.status(500).json({ error: '获取列表失败' });
        }
        const hasMore = rows.length > limit;
        const items = hasMore ? rows.slice(0, limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1].id : null;
        res.json({
            items: items.map((r) => ({ id: r.id, text: r.text, created_at: r.created_at })),
            next_cursor: nextCursor
        });
    });
});

// ---------- V1.2 自定义生成（Schema Pipeline） ----------
const customizeRateLimit = new Map();
const CUSTOMIZE_RATE_MAX = 10;
function customizeRateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const window = 60 * 1000;
    if (!customizeRateLimit.has(ip)) {
        customizeRateLimit.set(ip, { count: 1, resetTime: now + window });
        return next();
    }
    const d = customizeRateLimit.get(ip);
    if (now > d.resetTime) {
        d.count = 1;
        d.resetTime = now + window;
        return next();
    }
    if (d.count >= CUSTOMIZE_RATE_MAX) {
        return res.status(429).json({ error: '生成次数过多，请稍后再试' });
    }
    d.count++;
    next();
}

app.post('/api/customize', customizeRateLimiter, async (req, res) => {
    const { input, ref, use_rag } = req.body || {};
    const userInput = (input || '').trim();
    if (!userInput) {
        return res.status(400).json({ error: '请输入 1-3 句描述' });
    }
    if (userInput.length > 300) {
        return res.status(400).json({ error: '输入过长，请控制在 300 字内' });
    }
    const requestId = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const startTime = Date.now();
    const refText = (ref || '').trim();
    const withRag = Boolean(use_rag);

    const extracted = extractSchemaFromInput(userInput);
    const ragSnippets = withRag ? sampleRagSnippets(3) : [];
    const systemPrompt = buildSystemPromptFromSchema(extracted.schema, ragSnippets);
    const userPrompt = buildUserPromptForCustomize(extracted.situation);
    const userPromptWithRef = refText
        ? userPrompt + '\n\n【参考句（情绪方向）】\n' + refText
        : userPrompt;

    try {
        const result = await callWriter(systemPrompt, userPromptWithRef);
        const parsed = parseJSONResult(result.text);
        let text = (parsed.text || result.text || '').trim();
        if (text.length > 200) text = text.slice(0, 200);
        const responseTimeMs = Date.now() - startTime;
        const schemaJson = JSON.stringify({
            cp: extracted.cp,
            situation: extracted.situation,
            requested_style: extracted.requested_style,
            schema: extracted.schema
        });
        logCustomizeGeneration(requestId, userInput, refText, result.text, text, responseTimeMs, schemaJson);

        const s = extracted.schema;
        insertEventServer('generate_seed_result', requestId, {
            status: 'success',
            response_time_ms: responseTimeMs,
            retry_count: 0,
            critic_pass: null,
            mode: 'customize',
            op: null,
            seed_id: requestId,
            relation_primary: s.relation?.primary ?? null,
            form: s.form ?? null,
            intensity: s.intensity ?? null,
            hook: s.hook ?? null
        });
        res.json({ text, request_id: requestId });
    } catch (e) {
        console.error('customize error:', e);
        const responseTimeMs = Date.now() - startTime;
        const s = extracted.schema;
        insertEventServer('generate_seed_result', requestId, {
            status: 'fail',
            response_time_ms: responseTimeMs,
            error_code: 'GEN_ERROR',
            relation_primary: s?.relation?.primary ?? null,
            form: s?.form ?? null,
            intensity: s?.intensity ?? null,
            hook: s?.hook ?? null
        });
        res.status(500).json({ error: '生成失败，请稍后重试' });
    }
});

// ---------- 调试 / 管理只读接口 ----------
app.get('/admin/feed-preview', requireAdmin, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
    db.all(
        'SELECT id, text, created_at FROM feed_pool ORDER BY id DESC LIMIT ?',
        [limit],
        (err, rows) => {
            if (err) {
                console.error('admin feed-preview error:', err);
                return res.status(500).json({ error: '获取失败' });
            }
            res.json({ items: rows || [] });
        }
    );
});

app.get('/admin/last-logs', requireAdmin, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    db.all(
        `SELECT id, request_id, timestamp, mode, op, context_tail, final_text, response_time_ms
         FROM generation_logs
         ORDER BY id DESC
         LIMIT ?`,
        [limit],
        (err, rows) => {
            if (err) {
                console.error('admin last-logs error:', err);
                return res.status(500).json({ error: '获取失败' });
            }
            res.json({ items: rows || [] });
        }
    );
});

app.get('/admin/last-events', requireAdmin, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 300);
    db.all(
        `SELECT id, event, ts, user_id, device_id, session_id, page, app_version, platform, request_id, properties
         FROM events
         ORDER BY id DESC
         LIMIT ?`,
        [limit],
        (err, rows) => {
            if (err) {
                console.error('admin last-events error:', err);
                return res.status(500).json({ error: '获取失败' });
            }
            res.json({ items: rows || [] });
        }
    );
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', version: '1.2.0', timestamp: new Date().toISOString() });
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
    const url = `http://localhost:${PORT}`;
    console.log(`It Clicks V1.2 已启动 → ${url}`);
    console.log(`在浏览器打开上面地址即可访问`);
    console.log(`API: /api/generate (保留) /api/feed /api/customize`);
});
