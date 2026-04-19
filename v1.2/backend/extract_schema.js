/**
 * Prompt A v0.1：规则版意图抽取
 * 将用户输入（CP/情节/设定）roughly 映射到 Schema 五维，供 Prompt B 使用
 * 输出协议对齐 0302_checklist：cp, situation, requested_style, schema
 */

const { RELATION_TYPES, FORMS, INTENSITIES, HOOKS, DEFAULT_TONE } = require('./schema_engine.js');

const DEFAULT_PRIMARY = '情感留白';
const DEFAULT_FORM = 'micro_scene';
const DEFAULT_INTENSITY = 'medium';
const DEFAULT_HOOK = 'contrast';

// 关键词 → relation.primary（按优先级匹配第一个）
const RELATION_KEYWORDS = [
    { keys: ['等', '等你', '等待', '等不到', '等他'], primary: '遗弃/等待' },
    { keys: ['不能爱', '不能在一起', '不能喜欢', '不可以'], primary: '不能爱' },
    { keys: ['虐', '折磨', '伤害', '纠缠', '痛'], primary: '伤害纠缠' },
    { keys: ['吃醋', '占有', '占有欲', '醋'], primary: '占有欲/吃醋' },
    { keys: ['年下', '年上', '位阶', '上下级', '师徒'], primary: '位阶张力' },
    { keys: ['错过', '临终', '时间停止', '时间终止', '来不及'], primary: '时间终止' },
    { keys: ['矛盾', '拉扯', '纠结'], primary: '矛盾拉扯' },
    { keys: ['反差', '人设反差'], primary: '反差' },
    { keys: ['悖论', '行为悖论', '口是心非'], primary: '行为悖论' },
    { keys: ['留白', '日常', '平淡', '克制', '不说'], primary: '情感留白' },
];

const FORM_KEYWORDS = [
    { keys: ['一句', '单句', '金句'], form: 'single' },
    { keys: ['对话', '对白', '两人说'], form: 'dialogue' },
    { keys: ['场景', '小场景', '微剧情'], form: 'micro_scene' },
    { keys: ['抒情', '留白', '诗意'], form: 'lyrical_blank' },
];

const INTENSITY_KEYWORDS = [
    { keys: ['很虐', '极致', '爆发', '激烈', '强烈'], intensity: 'high' },
    { keys: ['克制', '淡淡', '轻', '淡'], intensity: 'low' },
];

const HOOK_KEYWORDS = [
    { keys: ['告白', '直白', '直接说'], hook: 'direct_confession' },
    { keys: ['时间截断', '错过', '临终'], hook: 'time_cut' },
    { keys: ['行为悖论', '口是心非', '做的不一样'], hook: 'behavioral_paradox' },
    { keys: ['对比', '反差', '预期违背'], hook: 'contrast' },
];

function matchKeyword(text, list, defaultVal, getVal) {
    const raw = (text || '').trim();
    for (const item of list) {
        for (const k of item.keys) {
            if (raw.includes(k)) return getVal(item);
        }
    }
    return defaultVal;
}

/**
 * 规则版抽取：用户输入 → { cp, situation, requested_style, schema }
 * @param {string} userInput - 用户输入的 CP 名称/情节/设定（1-3 句）
 */
function extractSchemaFromInput(userInput) {
    const raw = (userInput || '').trim();
    const situation = raw.slice(0, 80) || '无';
    const requested_style = raw.slice(0, 60) || '无';

    let primary = matchKeyword(raw, RELATION_KEYWORDS, DEFAULT_PRIMARY, (x) => x.primary);
    const form = matchKeyword(raw, FORM_KEYWORDS, DEFAULT_FORM, (x) => x.form);
    let intensity = matchKeyword(raw, INTENSITY_KEYWORDS, DEFAULT_INTENSITY, (x) => x.intensity);
    const hook = matchKeyword(raw, HOOK_KEYWORDS, DEFAULT_HOOK, (x) => x.hook);

    if (form === 'lyrical_blank' && intensity === 'high') {
        intensity = 'medium';
    }

    const schema = {
        relation: { primary, secondary: null },
        form,
        intensity,
        hook,
        tone: { ...DEFAULT_TONE }
    };

    return {
        cp: { name_a: null, name_b: null },
        situation,
        requested_style,
        schema
    };
}

module.exports = { extractSchemaFromInput };
