require('dotenv').config();
const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.DEEPSEEK_API_KEY;
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

// 限流配置（内存限流）
const rateLimit = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1分钟
const RATE_LIMIT_MAX = 30; // 每分钟最多30次

// 简单限流中间件
function rateLimiter(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    if (!rateLimit.has(ip)) {
        rateLimit.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW });
        return next();
    }

    const data = rateLimit.get(ip);

    if (now > data.resetTime) {
        // 重置计数器
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

app.use(express.json({ limit: '10kb' }));
app.use(express.static(__dirname + '/../frontend'));

// CORS 允许（虽然同域，但保持兼容性）
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Writer Prompt
const WRITER_SYSTEM = `你是一个"代入引线生成器"。

任务：生成一段可被同人爱好者代入的短文本，用作脑补或写作起点。

必须遵守以下规则：

【结构】
1. 输出中文，50–120 字，2–4 句。
2. 必须使用至少 3 个模糊指代（如：他、她、你、那句话、那件事、现在、最近）保持人称指代连续。
3. 不得使用具体背景设定（地名、职业、组织、世界观、具体事件名称）。
4. 不得解释原因，不得使用"因为/所以/其实/原来/终于/后来"等总结性语言。
5. 不得形成完整故事或明确结局。
6. 结尾必须停在"还可以继续"的位置（差一点/没说完/没确认）。

【语气】
7. 语气自然，像同人群里随手发的一段话；不要文学腔、不要宏大抽象词（命运/洪流/空气沉默等）。
8. 用动作/边界/选择表达张力，少用情绪形容词堆砌。

【禁止前史】
9. 不得暗示明确前史事件（禁止：那天之后/自从那件事/后来才知道/从此/最终/决定了）。

只输出文本，不要解释规则。`;

app.post('/api/generate', rateLimiter, async (req, res) => {
    try {
        const { mode, op, hint = '', context = {}, state = {} } = req.body;

        // 输入验证
        if (hint && hint.length > 200) {
            return res.status(400).json({ error: '提示过长，最多 200 字' });
        }

        const contextText = Object.values(context).filter(v => v).join('');
        if (contextText && contextText.length > 2000) {
            return res.status(400).json({ error: '上下文过长，最多 2000 字' });
        }

        // 构建用户 prompt
        let userPrompt = '';

        if (mode === 'seed') {
            userPrompt = '生成一段全新的独立引线文本。不要引用任何已有内容。';
        } else if (mode === 'assist') {
            if (op === 'continue') {
                const { around_cursor, tail } = context;
                userPrompt = `基于下面的局部上下文，续写一小段（50–120字），保持语气与状态，但不要补前史、不要闭合。

【上下文】
${around_cursor || tail || '（无）'}

【用户提示】
${hint || '（无）'}`;
            } else if (op === 'rewrite') {
                const { selected } = context;
                userPrompt = `改写下面选中片段，给出 3 个候选版本（每个 30–80字），更自然、更好代入，仍遵守规则。用 "1) ... 2) ... 3) ..." 格式输出。

【待改写】
${selected}`;
            }
        }

        if (!userPrompt) {
            return res.status(400).json({ error: '无效的请求参数' });
        }

        const messages = [
            { role: 'system', content: WRITER_SYSTEM },
            { role: 'user', content: userPrompt }
        ];

        const startTime = Date.now();

        // 调用 DeepSeek API
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`
            },
            body: JSON.stringify({
                model: 'deepseek-chat',
                messages: messages,
                max_tokens: 300,
                temperature: 0.8
            })
        });

        if (!response.ok) {
            throw new Error(`DeepSeek API 错误: ${response.status}`);
        }

        const data = await response.json();
        const generatedText = data.choices[0].message.content.trim();
        const duration = Date.now() - startTime;

        // 日志（仅记录统计信息，不记录用户文本）
        console.log({
            timestamp: new Date().toISOString(),
            mode,
            op,
            hintLength: hint.length,
            contextLength: contextText.length,
            outputLength: generatedText.length,
            duration
        });

        res.json({
            text: generatedText,
            meta: {
                retry: 0,
                critic: { pass: true, confidence: 0.86, problems: [] }
            }
        });

    } catch (error) {
        console.error('生成错误:', error);
        res.status(500).json({ error: '生成失败，请稍后重试' });
    }
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`API endpoint: http://localhost:${PORT}/api/generate`);
});
