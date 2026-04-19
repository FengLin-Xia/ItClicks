/**
 * RAG 检索（纯 Node）：读 corpus 下的 anchors_ids.json、anchors.jsonl、anchors_vectors.json，
 * 按 query 向量做余弦相似度，返回 top-k 条。不包含 query 文本的 embedding，需调用方自备或接 API。
 */

const path = require('path');
const fs = require('fs');

const RAG_ROOT = path.resolve(__dirname);
const CORPUS = path.join(RAG_ROOT, 'corpus');
const IDS_PATH = path.join(CORPUS, 'anchors_ids.json');
const JSONL_PATH = path.join(CORPUS, 'anchors.jsonl');
const VECTORS_PATH = path.join(CORPUS, 'anchors_vectors.json');

let cached = null;

function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function norm(a) {
  return Math.sqrt(dot(a, a)) || 1e-10;
}

function cosineSimilarity(a, b) {
  return dot(a, b) / (norm(a) * norm(b));
}

/**
 * 加载语料与向量（懒加载，只读一次）
 * @returns {{ ids: string[], docsById: Record<string, object>, vectors: number[][] }}
 */
function load() {
  if (cached) return cached;
  const ids = JSON.parse(fs.readFileSync(IDS_PATH, 'utf8'));
  const vectors = JSON.parse(fs.readFileSync(VECTORS_PATH, 'utf8'));
  const docsById = {};
  const lines = fs.readFileSync(JSONL_PATH, 'utf8').split(/\n/).filter(Boolean);
  for (const line of lines) {
    try {
      const doc = JSON.parse(line);
      if (doc.id != null) docsById[doc.id] = doc;
    } catch (_) {}
  }
  cached = { ids, docsById, vectors };
  return cached;
}

/**
 * 按 query 向量检索 top-k 条
 * @param {number[]} queryVector - 与 corpus 向量同维
 * @param {number} [k=5]
 * @param {{ filterForm?: string, filterStyle?: object }} [opts] - 可选：按 style.form 等过滤后再排序
 * @returns {{ id: string, text: string, style: object, score: number }[]}
 */
function retrieve(queryVector, k = 5, opts = {}) {
  const { ids, docsById, vectors } = load();
  if (ids.length !== vectors.length) throw new Error('anchors_ids 与 anchors_vectors 条数不一致');
  const filterForm = opts.filterForm;
  const filterStyle = opts.filterStyle;

  const scored = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const doc = docsById[id];
    if (!doc) continue;
    if (filterForm != null && (doc.style && doc.style.form) !== filterForm) continue;
    if (filterStyle != null && doc.style) {
      let skip = false;
      for (const [k, v] of Object.entries(filterStyle)) {
        if (doc.style[k] !== v) { skip = true; break; }
      }
      if (skip) continue;
    }
    const score = cosineSimilarity(queryVector, vectors[i]);
    scored.push({ id, doc, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k).map(({ id, doc, score }) => ({
    id,
    text: doc.text,
    style: doc.style || {},
    score,
  }));
}

/**
 * 仅加载并返回语料信息（不检索），用于校验或按 id 取 doc
 */
function getCorpus() {
  return load();
}

module.exports = {
  load,
  retrieve,
  getCorpus,
  cosineSimilarity,
};
