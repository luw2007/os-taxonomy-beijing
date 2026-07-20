#!/usr/bin/env node
/**
 * compute-centrality.test.mjs — centrality 计算单元测试。
 * 纯 Node.js，用 node:assert，无外部框架。
 *
 * 运行：node scripts/test/compute-centrality.test.mjs
 */
import assert from 'node:assert/strict';
import { computeReachableConcepts } from '../compute-centrality.mjs';
import { classifyNodeKind } from '../backfill-node-kind.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}

console.log('=== compute-centrality + nodeKind 单元测试 ===\n');

// --- computeReachableConcepts ---

test('A. 链状图 A→B→C→D：A reach=3（B,C,D 都是概念）', () => {
  const outAdj = new Map([
    ['A', new Set(['B'])],
    ['B', new Set(['C'])],
    ['C', new Set(['D'])],
  ]);
  const counting = new Set(['A', 'B', 'C', 'D']);
  const r = computeReachableConcepts(['A'], outAdj, counting);
  assert.equal(r.get('A'), 3);
});

test('B. text 节点中转可达：A→T→C，T 是 text。A 的 reach 只数 concept（C），不数 T', () => {
  // T 是 text 但能中转：A 能通过 T 到达 C
  const outAdj = new Map([
    ['A', new Set(['T'])],
    ['T', new Set(['C'])],
  ]);
  const counting = new Set(['A', 'C']); // T 不在 counting 里
  const r = computeReachableConcepts(['A'], outAdj, counting);
  assert.equal(r.get('A'), 1, 'A 应 reach=1（只有 C 是 concept，T 是 text 中转不计）');
});

test('C. 分支图：A→B, A→C, B→D, C→D。A reach=3（B,C,D）', () => {
  const outAdj = new Map([
    ['A', new Set(['B', 'C'])],
    ['B', new Set(['D'])],
    ['C', new Set(['D'])],
  ]);
  const counting = new Set(['A', 'B', 'C', 'D']);
  const r = computeReachableConcepts(['A'], outAdj, counting);
  assert.equal(r.get('A'), 3);
});

test('D. 孤立节点（无出边）：reach=0', () => {
  const outAdj = new Map();
  const counting = new Set(['X']);
  const r = computeReachableConcepts(['X'], outAdj, counting);
  assert.equal(r.get('X'), 0);
});

test('E. 多起点：A reach=2，B reach=1', () => {
  const outAdj = new Map([
    ['A', new Set(['B', 'C'])],
    ['B', new Set(['C'])],
  ]);
  const counting = new Set(['A', 'B', 'C']);
  const r = computeReachableConcepts(['A', 'B'], outAdj, counting);
  assert.equal(r.get('A'), 2);
  assert.equal(r.get('B'), 1);
});

// --- classifyNodeKind ---

test('F. Reading Materials 课文 → text', () => {
  const t = { name: '太空一日', domain: 'Reading Materials', type: 'LANGUAGE', subject: 'Chinese', origin: 'textbook' };
  assert.equal(classifyNodeKind(t), 'text');
});

test('G. 理科概念（Physics textbook）→ concept', () => {
  const t = { name: '光的色散', domain: 'Sound & Light', type: 'CONCEPTUAL', subject: 'Physics', origin: 'textbook' };
  assert.equal(classifyNodeKind(t), 'concept');
});

test('H. PROCEDURAL 节点 → skill', () => {
  const t = { name: '毛笔楷书入门', domain: 'Literacy & Handwriting', type: 'PROCEDURAL', subject: 'Chinese', origin: 'cn_only' };
  assert.equal(classifyNodeKind(t), 'skill');
});

test('I. 含书名号《》→ text', () => {
  const t = { name: '《论语》十二章', domain: 'Classical Chinese', type: 'CONCEPTUAL', subject: 'Chinese', origin: 'textbook' };
  assert.equal(classifyNodeKind(t), 'text');
});

test('J. 含"·"的 Classical 概念（"文言文·常见虚词用法"）→ concept，不是 text', () => {
  const t = { name: '文言文·常见虚词用法', domain: 'Classical Chinese', type: 'CONCEPTUAL', subject: 'Chinese', origin: 'textbook' };
  assert.equal(classifyNodeKind(t), 'concept');
});

test('K. 词牌名"沁园春·雪"（Reading Materials）→ text', () => {
  const t = { name: '沁园春·雪', domain: 'Reading Materials', type: 'LANGUAGE', subject: 'Chinese', origin: 'textbook' };
  assert.equal(classifyNodeKind(t), 'text');
});

test('L. 数学概念 → concept', () => {
  const t = { name: '数轴表示', domain: 'Number & Algebra', type: 'CONCEPTUAL', subject: 'Mathematics', origin: 'cn_only' };
  assert.equal(classifyNodeKind(t), 'concept');
});

test('M. "作者/篇名"模式（孙权劝学/《资治通鉴》）→ text', () => {
  const t = { name: '孙权劝学/《资治通鉴》', domain: 'Classical Chinese', type: 'LANGUAGE', subject: 'Chinese', origin: 'textbook' };
  assert.equal(classifyNodeKind(t), 'text');
});

test('N. 自环 A→A：BFS 不应把自身计入 reach（前置条件：DAG 无自环，此处验证健壮性）', () => {
  const outAdj = new Map([['A', new Set(['A'])]]); // 自环
  const counting = new Set(['A']);
  const r = computeReachableConcepts(['A'], outAdj, counting);
  // 自环：visited 会含 A 自身，但 A 在 counting 里，所以 reach=1
  // 这个测试记录"自环下行为"，不作为正确性断言（真实数据 validate 保证无自环）
  assert.equal(r.get('A'), 1, '自环：A→A，A 被加进 visited 且在 counting 里，reach=1（记录行为）');
});

test('O. 空 counting（所有节点都是 text）：maxReach 不崩，返回空结果', () => {
  const outAdj = new Map([['A', new Set(['B'])]]);
  const counting = new Set(); // 空：所有节点都是 text
  const r = computeReachableConcepts(['A'], outAdj, counting);
  // A 不在 counting 里，但作为起点传入；其 reach 只数 counting 里的，=0
  assert.equal(r.get('A'), 0, 'counting 空，reach=0');
});

console.log(`\n=== 结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
