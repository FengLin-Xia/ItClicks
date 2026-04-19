#!/usr/bin/env node
/**
 * RAG 上线前自测：检查语料/索引是否存在，并执行一次检索
 * 运行方式（二选一）：
 *   - 在 v1.2 目录下：node rag/scripts/verify.js
 *   - 在 rag 目录下：  node scripts/verify.js
 */

const path = require('path');
const fs = require('fs');

const RAG_ROOT = path.resolve(__dirname, '..');
const CORPUS_DIR = path.join(RAG_ROOT, 'corpus');
const INDEX_DIR = path.join(RAG_ROOT, 'index');

function checkDirs() {
  const ok = { corpus: false, index: false };
  if (fs.existsSync(CORPUS_DIR)) ok.corpus = true;
  if (fs.existsSync(INDEX_DIR)) ok.index = true;
  return ok;
}

function main() {
  console.log('RAG 自测开始…\n');

  const dirs = checkDirs();
  console.log('目录检查:');
  console.log('  corpus/', dirs.corpus ? '✓' : '✗ 缺失');
  console.log('  index/', dirs.index ? '✓' : '✗ 缺失');

  // 用 Node client：若有 anchors_vectors.json 则用第一条向量做一次检索
  const hasVectors = fs.existsSync(path.join(CORPUS_DIR, 'anchors_vectors.json'));
  const hasClient = fs.existsSync(path.join(RAG_ROOT, 'client.js'));
  if (hasClient && hasVectors) {
    console.log('\n检索测试: Node client（用首条向量作 query）…');
    try {
      const rag = require(path.join(RAG_ROOT, 'client.js'));
      const { vectors } = rag.getCorpus();
      if (vectors && vectors.length) {
        const out = rag.retrieve(vectors[0], 3);
        console.log('  检索结果:', out.length, '条');
        out.forEach((r, i) => console.log('   ', i + 1, r.id, r.score?.toFixed(4), r.text?.slice(0, 40) + '…'));
      } else {
        console.log('  (无向量数据，跳过)');
      }
    } catch (e) {
      console.error('  检索失败:', e.message);
      process.exitCode = 1;
    }
  } else if (hasClient) {
    console.log('\n检索测试: 有 client 但缺 corpus/anchors_vectors.json，跳过。');
  } else {
    console.log('\n检索测试: 暂无 client.js，跳过。');
  }

  console.log('\nRAG 自测结束。');
}

main();
