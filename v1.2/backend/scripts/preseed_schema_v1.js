#!/usr/bin/env node
/**
 * Seed Engine 预生成脚本（Schema v1.0 对齐）
 *
 * 功能：
 * - 离线调用 DeepSeek，根据五维 Schema 生成文本
 * - 分两种变体：
 *   A：有 RAG 语感锚点（anchors.jsonl，只做 tone/base_style & form 结构参考）
 *   B：无 RAG（纯 Schema 控制）
 * - 结果直接写入 backend 的 feed_pool 表（供刷流使用）
 *
 * 用法（在 v1.2/backend 目录下）：
 *   node scripts/preseed_schema_v1.js                   # 默认 AB 各 20 条
 *   node scripts/preseed_schema_v1.js --variant=A --count=50
 *   node scripts/preseed_schema_v1.js --variant=B --count=100
 *   node scripts/preseed_schema_v1.js --variant=AB --countA=30 --countB=70
 */

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
require('dotenv').config();

const {
  RELATION_TYPES,
  FORMS,
  INTENSITIES,
  HOOKS,
  DEFAULT_TONE,
  buildSystemPromptFromSchema,
  buildUserPromptForPreseed,
} = require('../schema_engine.js');

const API_KEY = process.env.DEEPSEEK_API_KEY;
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

if (!API_KEY) {
  console.error('DEEPSEEK_API_KEY 未配置，请在 backend/.env 中设置。');
  process.exit(1);
}

// ---------- CLI 参数解析 ----------

function parseArgs() {
  const args = process.argv.slice(2);
  let variant = 'AB'; // 'A' | 'B' | 'AB'
  let count = 40;
  let countA = null;
  let countB = null;

  for (const arg of args) {
    if (arg.startsWith('--variant=')) {
      variant = arg.split('=')[1] || 'AB';
    } else if (arg.startsWith('--countA=')) {
      countA = parseInt(arg.split('=')[1], 10) || 0;
    } else if (arg.startsWith('--countB=')) {
      countB = parseInt(arg.split('=')[1], 10) || 0;
    } else if (arg.startsWith('--count=')) {
      count = parseInt(arg.split('=')[1], 10) || count;
    }
  }

  variant = variant.toUpperCase();
  if (!['A', 'B', 'AB'].includes(variant)) {
    console.warn(`未知 variant=${variant}，使用 AB。`);
    variant = 'AB';
  }

  if (variant === 'A') {
    countA = countA != null ? countA : count;
    countB = 0;
  } else if (variant === 'B') {
    countA = 0;
    countB = countB != null ? countB : count;
  } else {
    // AB
    if (countA == null && countB == null) {
      countA = Math.floor(count / 2);
      countB = count - countA;
    } else {
      countA = countA || 0;
      countB = countB || 0;
    }
  }

  return { variant, countA, countB };
}

// ---------- Schema 采样（常量来自 schema_engine.js） ----------

function randFrom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randFloat(min, max) {
  return min + Math.random() * (max - min);
}

function sampleSchema(lastHook) {
  const primary = randFrom(RELATION_TYPES);
  // 简单策略：secondary 20% 概率为另一个张力类型
  let secondary = null;
  if (Math.random() < 0.2) {
    let s;
    do {
      s = randFrom(RELATION_TYPES);
    } while (s === primary);
    secondary = s;
  }

  let form = randFrom(FORMS);
  let intensity = randFrom(INTENSITIES);
  // 禁止 high + lyrical_blank
  if (form === 'lyrical_blank' && intensity === 'high') {
    intensity = 'medium';
  }

  let hook = randFrom(HOOKS);
  // 避免连续使用同一 hook
  if (lastHook && hook === lastHook) {
    const others = HOOKS.filter(h => h !== lastHook);
    hook = randFrom(others);
  }

  const tone = {
    ...DEFAULT_TONE,
    coldness_level: randFloat(0.4, 0.8),
    restraint_level: randFloat(0.6, 0.9),
    concreteness_level: randFloat(0.4, 0.7),
  };

  return {
    relation: { primary, secondary },
    form,
    intensity,
    hook,
    tone,
    hookForNext: hook,
  };
}

// ---------- RAG 样本加载（仅 A 变体使用） ----------

const RAG_ROOT = path.resolve(__dirname, '../../rag');
const ANCHORS_PATH = path.join(RAG_ROOT, 'corpus', 'anchors.jsonl');

let cachedAnchors = null;

function loadAnchors() {
  if (cachedAnchors) return cachedAnchors;
  if (!fs.existsSync(ANCHORS_PATH)) {
    console.warn('未找到 anchors.jsonl，A 变体将退化为无 RAG。');
    cachedAnchors = [];
    return cachedAnchors;
  }
  const lines = fs.readFileSync(ANCHORS_PATH, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean);
  const docs = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj && obj.text) docs.push(obj);
    } catch {
      // ignore
    }
  }
  cachedAnchors = docs;
  return cachedAnchors;
}

function sampleRagSnippets(n) {
  const anchors = loadAnchors();
  if (!anchors.length) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = Math.floor(Math.random() * anchors.length);
    const t = anchors[idx].text || '';
    // 截断避免 prompt 过长
    const trimmed = t.length > 60 ? t.slice(0, 60) + '…' : t;
    out.push(trimmed);
  }
  return out;
}

// ---------- DeepSeek 调用 ----------

async function callDeepseek(systemPrompt, userPrompt) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 220,
        temperature: 0.8,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`DeepSeek API 错误: ${res.status} - ${txt}`);
    }
    const data = await res.json();
    return data.choices[0].message.content.trim();
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

function parseJsonText(raw) {
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return raw.trim();
    const obj = JSON.parse(match[0]);
    if (obj && typeof obj.text === 'string') return obj.text.trim();
    return raw.trim();
  } catch {
    return raw.trim();
  }
}

// ---------- SQLite：feed_pool 写入 + JSON 审核输出 ----------

const LOG_DIR = path.resolve(__dirname, '../logs');
const DB_PATH = path.join(LOG_DIR, 'generation_logs.db');
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const DUMP_PATH = path.join(LOG_DIR, `preseed_${RUN_ID}.jsonl`);

function initDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) return reject(err);
      db.exec(
        `CREATE TABLE IF NOT EXISTS feed_pool (
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
        )`,
        (e) => {
          if (e) return reject(e);
          resolve(db);
        },
      );
    });
  });
}

function insertFeed(db, text, schema, variant) {
  const r = schema?.relation;
  const toneJson = schema?.tone ? JSON.stringify(schema.tone) : null;
  return new Promise((resolve) => {
    db.run(
      `INSERT INTO feed_pool (text, relation_primary, relation_secondary, form, intensity, hook, tone_json, variant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        text,
        r?.primary ?? null,
        r?.secondary ?? null,
        schema?.form ?? null,
        schema?.intensity ?? null,
        schema?.hook ?? null,
        toneJson,
        variant ?? null,
      ],
      (err) => {
        if (err) console.error('feed_pool insert error:', err.message);
        resolve();
      }
    );
  });
}

// ---------- 主流程 ----------

async function generateBatch(db, count, variant, dumpStream) {
  if (count <= 0) return;
  console.log(`\n开始生成：variant=${variant}, count=${count}`);

  let lastHook = null;
  for (let i = 0; i < count; i++) {
    const schema = sampleSchema(lastHook);
    lastHook = schema.hookForNext;
    const ragSnippets = variant === 'A' ? sampleRagSnippets(3) : [];
    const systemPrompt = buildSystemPromptFromSchema(schema, ragSnippets);
    const userPrompt = buildUserPromptForPreseed();

    try {
      const raw = await callDeepseek(systemPrompt, userPrompt);
      let text = parseJsonText(raw);
      if (!text || text.length < 10) {
        console.warn(`[#${i + 1}/${count}] 文本过短或为空，跳过。`);
        continue;
      }
      if (text.length > 200) text = text.slice(0, 200);
      await insertFeed(db, text, schema, variant);
      if (dumpStream) {
        const dumpRecord = {
          variant,
          text,
          schema: {
            relation: schema.relation,
            form: schema.form,
            intensity: schema.intensity,
            hook: schema.hook,
            tone: schema.tone,
          },
          created_at: new Date().toISOString(),
        };
        dumpStream.write(JSON.stringify(dumpRecord) + '\n');
      }
      console.log(`[#${i + 1}/${count}] OK (${variant})：${text.slice(0, 40)}…`);
    } catch (e) {
      console.error(`[#${i + 1}/${count}] 生成失败 (${variant}):`, e.message);
    }
  }
}

async function main() {
  const { variant, countA, countB } = parseArgs();
  console.log('Seed 预生成启动，参数：', { variant, countA, countB });
  console.log('DB:', DB_PATH);
  console.log('RAG anchors:', ANCHORS_PATH);
  console.log('JSON 审核输出文件:', DUMP_PATH);

  // 确保日志目录存在
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  const db = await initDb();
  const dumpStream = fs.createWriteStream(DUMP_PATH, { encoding: 'utf8' });

  try {
    if (variant === 'A') {
      await generateBatch(db, countA, 'A', dumpStream);
    } else if (variant === 'B') {
      await generateBatch(db, countB, 'B', dumpStream);
    } else {
      await generateBatch(db, countA, 'A', dumpStream);
      await generateBatch(db, countB, 'B', dumpStream);
    }
  } finally {
    dumpStream.end();
    db.close();
  }

  console.log('\n预生成完成。可以在 logs 目录下查看 JSON 审核文件：', DUMP_PATH);
}

main().catch((e) => {
  console.error('预生成脚本异常退出:', e);
  process.exit(1);
});

