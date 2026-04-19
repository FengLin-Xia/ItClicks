/**
 * Seed Engine Schema v1.0 公共模块
 * 供 server.js /api/customize 与 scripts/preseed_schema_v1.js 共用
 * 对齐 Prompt_Schema_v1.0.md
 */

const RELATION_TYPES = [
    '不能爱', '矛盾拉扯', '反差', '位阶张力', '占有欲/吃醋',
    '遗弃/等待', '时间终止', '伤害纠缠', '行为悖论', '情感留白'
];

const FORMS = ['single', 'dialogue', 'micro_scene', 'lyrical_blank'];
const INTENSITIES = ['low', 'medium', 'high'];
const HOOKS = ['contrast', 'time_cut', 'behavioral_paradox', 'direct_confession'];

const DEFAULT_TONE = {
    base_style: 'east_asian_subtle',
    coldness_level: 0.6,
    restraint_level: 0.8,
    concreteness_level: 0.5
};

/**
 * 根据五维 schema + 可选 RAG 片段，生成 system prompt（与 preseed 一致）
 * @param {object} schema - { relation: { primary, secondary }, form, intensity, hook, tone }
 * @param {string[]} ragSnippets - 可选，语感锚点片段
 */
function buildSystemPromptFromSchema(schema, ragSnippets = []) {
    const { relation, form, intensity, hook, tone } = schema;
    const baseSchemaJson = JSON.stringify({
        relation: { primary: relation.primary, secondary: relation.secondary },
        form,
        intensity,
        hook,
        tone
    }, null, 2);

    const ragBlock = ragSnippets.length
        ? `
【RAG 语感锚点（禁止抄写原句，仅参考语气和结构）】
示例片段：
${ragSnippets.map((t, i) => `${i + 1}. ${t}`).join('\n')}

只允许你：粗略学习语气、节奏、句长和留白；对齐圈层语感。
禁止你：复制句子片段、复制情节或设定、用它们补全剧情。`
        : '';

    return `你是 Seed Engine 的生成模块，必须严格遵守 Generation Control Schema v1.0。

当前控制参数如下（五维 Schema）：
${baseSchemaJson}

【生成流程（内部 Plan → Write）】
Step 1：Plan 阶段（在你内部完成，不单独输出）：
- 基于 relation.primary / secondary 构思关系结构草图
- 基于 hook 决定钩子句位置
- 基于 intensity 和 form 决定情绪峰值位置

Step 2：Write 阶段：
- 严格按五维参数写文本
- 不允许偏离 tone
- 不得写解释性句子（不要解释原因、动机、世界观）

【形式与钩子】
- form=single：一句高度压缩钩子句
- form=dialogue：双人对话，2-3 句
- form=micro_scene：2-3 句极小场景
- form=lyrical_blank：克制抒情、留白
- 按 hook 类型落实（time_cut=时间中断/错过感，behavioral_paradox=行为冲突）

【强约束】
- 不得 high intensity + lyrical_blank
- 不得宏大抽象（命运、时代洪流等）
- 不得写设定说明（职业、地名等）
${ragBlock}

【输出要求】
- 仅输出一个 JSON：{ "text": "你的生成文本" }
- 不要解释、标题或额外字段。`;
}

/**
 * 自定义生成用 user prompt（80-120 字）
 * @param {string} situation - 可选，场景摘要，会拼进提示
 */
function buildUserPromptForCustomize(situation) {
    if (situation && situation.trim()) {
        return `根据上述控制参数，结合以下场景倾向，生成一段 80-120 字的中文文本，只输出 JSON。\n场景倾向：${situation.trim()}`;
    }
    return '根据上述控制参数，生成一段 80-120 字的中文文本，只输出 JSON。';
}

/**
 * 预生成脚本用 user prompt（40-100 字）
 */
function buildUserPromptForPreseed() {
    return '根据上述控制参数，生成一段 40-100 字左右的中文文本，只输出 JSON。';
}

module.exports = {
    RELATION_TYPES,
    FORMS,
    INTENSITIES,
    HOOKS,
    DEFAULT_TONE,
    buildSystemPromptFromSchema,
    buildUserPromptForCustomize,
    buildUserPromptForPreseed
};
