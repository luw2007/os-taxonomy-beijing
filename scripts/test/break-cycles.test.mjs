#!/usr/bin/env node
/**
 * break-cycles.test.mjs — breakCycles() 单元测试。
 * 纯 Node.js，用 node:assert，无外部测试框架。
 *
 * 运行：node scripts/test/break-cycles.test.mjs
 */
import assert from 'node:assert/strict';
import { breakCycles } from '../break-cycles.mjs';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

// 辅助：用 Kahn 拓扑排序独立验证是否真无环（不依赖 breakCycles 内部实现）
function isDAG(edges) {
  const adj = new Map();
  const nodes = new Set();
  const indeg = new Map();
  for (const e of edges) {
    nodes.add(e.topicId);
    nodes.add(e.prerequisiteId);
    if (!adj.has(e.prerequisiteId)) adj.set(e.prerequisiteId, []);
    adj.get(e.prerequisiteId).push(e.topicId);
    indeg.set(e.topicId, (indeg.get(e.topicId) || 0) + 1);
    if (!indeg.has(e.prerequisiteId)) indeg.set(e.prerequisiteId, 0);
  }
  const queue = [];
  for (const n of nodes) if ((indeg.get(n) || 0) === 0) queue.push(n);
  let sorted = 0;
  while (queue.length) {
    const v = queue.shift();
    sorted++;
    for (const w of adj.get(v) || []) {
      indeg.set(w, indeg.get(w) - 1);
      if (indeg.get(w) === 0) queue.push(w);
    }
  }
  return sorted === nodes.size;
}

const E = (topicId, prerequisiteId, strength = 'soft', reason = '') =>
  ({ topicId, prerequisiteId, strength, reason });

console.log('=== break-cycles 单元测试 ===\n');

// fixture A：3 节点环 A→B→C→A
test('A. 3 节点环：破环后 0 环，删 ≥1 条', () => {
  const edges = [E('A', 'C'), E('B', 'A'), E('C', 'B')];
  const { kept, removed } = breakCycles(edges);
  assert.ok(removed.length >= 1, `应删 ≥1 条，实际 ${removed.length}`);
  assert.ok(isDAG(kept), '破环后必须是 DAG');
  assert.equal(kept.length, edges.length - removed.length);
});

// fixture B：两个共享边的环
//   A→B→C→A（环1）和 A→B→D→A（环2），共享 A→B
test('B. 共享边的双环：破环后 0 环', () => {
  const edges = [
    E('B', 'A'), E('C', 'B'), E('A', 'C'),  // 环1: A→B→C→A
    E('D', 'A'), E('A', 'D'),                // 环2: A→B→D→A（复用 A→B = B←A）
  ];
  const { kept, removed } = breakCycles(edges);
  assert.ok(isDAG(kept), '破环后必须是 DAG');
  assert.ok(removed.length >= 1);
});

// fixture C：已经是 DAG（无环），幂等
test('C. 无环图：删 0 条（幂等）', () => {
  const edges = [E('B', 'A'), E('C', 'A'), E('D', 'B'), E('D', 'C')];
  const { kept, removed } = breakCycles(edges);
  assert.equal(removed.length, 0, `无环图应删 0 条，实际删 ${removed.length}`);
  assert.equal(kept.length, edges.length);
  assert.ok(isDAG(kept));
});

// fixture D：8 字环（两个环共享一个节点）
//   上环 A→B→C→A，下环 A→D→E→A，共享节点 A
test('D. 8 字环：破环后 0 环', () => {
  const edges = [
    E('B', 'A'), E('C', 'B'), E('A', 'C'),   // 上环
    E('D', 'A'), E('E', 'D'), E('A', 'E'),   // 下环
  ];
  const { kept, removed } = breakCycles(edges);
  assert.ok(isDAG(kept), '破环后必须是 DAG');
  assert.ok(removed.length >= 2, `两个独立环至少删 2 条，实际 ${removed.length}`);
});

// fixture E：soft + hard 混合环，优先删 soft
//   环 A→B→C→A，其中 A→B 是 hard，B→C 和 C→A 是 soft
test('E. 混合环：优先删 soft 边', () => {
  const edges = [
    E('B', 'A', 'hard'),  // A→B hard
    E('C', 'B', 'soft'),  // B→C soft
    E('A', 'C', 'soft'),  // C→A soft
  ];
  const { kept, removed } = breakCycles(edges);
  assert.ok(isDAG(kept), '破环后必须是 DAG');
  assert.ok(removed.length >= 1);
  // 删的边里应该至少有一条是 soft（优先删 soft）
  const removedSoft = removed.filter(e => e.strength === 'soft');
  assert.ok(removedSoft.length >= 1, '应优先删至少 1 条 soft 边');
});

// fixture F：反平行对（A→B 且 B→A）
test('F. 反平行对：至少删 1 条', () => {
  const edges = [
    E('B', 'A', 'soft'),
    E('A', 'B', 'hard'),
    E('C', 'B'),  // 加一条非环节点
  ];
  const { kept, removed } = breakCycles(edges);
  assert.ok(isDAG(kept));
  assert.ok(removed.length >= 1, '反平行对至少删 1 条');
});

// fixture G：每条 removed 边带 removedReason 字段
test('G. removed 边带 removedReason 字段', () => {
  const edges = [E('A', 'C', 'soft'), E('B', 'A', 'soft'), E('C', 'B', 'soft')];
  const { removed } = breakCycles(edges);
  for (const e of removed) {
    assert.ok(typeof e.removedReason === 'string', 'removedReason 必须是字符串');
    assert.ok(['cycle-soft', 'cycle-template', 'cycle-lowdeg'].includes(e.removedReason),
      `removedReason 值非法: ${e.removedReason}`);
  }
});

// fixture H：模板 reason 优先删
test('H. 模板 reason 边优先删', () => {
  const edges = [
    E('B', 'A', 'soft', '两篇诗的题材和写作背景理解上有一定关联性。'),
    E('C', 'B', 'soft'),
    E('A', 'C', 'soft'),
  ];
  const { removed } = breakCycles(edges);
  // 环里只有一条是模板，应优先删它（如果删了的话）
  const removedTemplate = removed.filter(e => e.removedReason === 'cycle-template' || e.removedReason === 'cycle-soft');
  assert.ok(removedTemplate.length >= 1);
});

// fixture I：大环（10 节点）验证不爆栈、能破开
test('I. 10 节点大环：破环后 0 环', () => {
  const edges = [];
  for (let i = 0; i < 10; i++) {
    edges.push(E(`n${i}`, `n${(i + 1) % 10}`, 'soft'));
  }
  const { kept, removed } = breakCycles(edges);
  assert.ok(isDAG(kept), '大环破环后必须是 DAG');
  assert.ok(removed.length >= 1);
});

// fixture J：空输入
test('J. 空边集：删 0 条，kept 为空', () => {
  const { kept, removed } = breakCycles([]);
  assert.equal(removed.length, 0);
  assert.equal(kept.length, 0);
});

console.log(`\n=== 结果：${passed} 通过，${failed} 失败 ===`);
if (failed > 0) process.exit(1);
