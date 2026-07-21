#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildPathSequence,
  classifyPathGesture,
  applyKnowledgeDecision,
} from '../../viewer/mobile-path-state.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}\n    ${error.message}`); }
}

console.log('=== mobile path state unit tests ===\n');

// --- buildPathSequence -------------------------------------------------

const nodes = {
  A: ['爱丽丝', 'math', 8],
  B: ['鲍勃', 'math', 7],
  C: ['查理', 'science', 6],
  D: ['丹妮', 'math', 9],
};
const edges = [
  { f: 'B', t: 'A' },
  { f: 'C', t: 'A' },
  { f: 'A', t: 'D' },
];

test('filters the sequence to nodes matching the subject filter, respecting dependency order', () => {
  const seq = buildPathSequence(nodes, edges, { subject: 'math' });
  assert.deepEqual(seq, ['B', 'A', 'D']);
});
test('orders independent ready nodes alongside dependency roots', () => {
  const seq = buildPathSequence({
    A: ['后续', 'math', 8],
    B: ['前置', 'math', 7],
    C: ['独立', 'math', 6],
  }, [{ f: 'B', t: 'A' }], { subject: 'math' });
  assert.deepEqual(seq, ['C', 'B', 'A']);
});


test('filters the sequence to nodes matching the age filter', () => {
  const seq = buildPathSequence(nodes, edges, { age: 8 });
  assert.deepEqual(seq, ['A']);
});

test('breaks ties deterministically by age, then Chinese name, then id', () => {
  const tieNodes = {
    X: ['赵四', 'math', 5],
    Y: ['钱五', 'math', 5],
    Z: ['孙六', 'math', 5],
  };
  const seq = buildPathSequence(tieNodes, [], { subject: 'math' });
  assert.deepEqual(seq, ['Y', 'Z', 'X']);
});

test('includes every matching node exactly once even when the graph contains a cycle', () => {
  const cyclicEdges = [{ f: 'A', t: 'B' }, { f: 'B', t: 'A' }];
  const seq = buildPathSequence(nodes, cyclicEdges, { subject: 'math' });
  assert.deepEqual(seq, ['D', 'B', 'A']);
  assert.equal(seq.length, new Set(seq).size);
});

test('classifies upward navigation as next only when content is at its bottom edge', () => {
  assert.equal(classifyPathGesture({ dx: 0, dy: -80 }, { atBottom: true }), 'next');
  assert.equal(classifyPathGesture({ dx: 0, dy: -80 }, { atBottom: false }), null);
});

test('classifies downward navigation as previous only when content is at its top edge', () => {
  assert.equal(classifyPathGesture({ dx: 0, dy: 80 }, { atTop: true }), 'previous');
  assert.equal(classifyPathGesture({ dx: 0, dy: 80 }, { atTop: false }), null);
});

test('requires a deliberate horizontal swipe for knowledge decisions', () => {
  assert.equal(classifyPathGesture({ dx: -64, dy: 5 }), null);
  assert.equal(classifyPathGesture({ dx: 64, dy: 5 }), null);
  assert.equal(classifyPathGesture({ dx: -96, dy: 5 }), 'mastered');
  assert.equal(classifyPathGesture({ dx: 96, dy: 5 }), 'needs-review');
});

test('rejects short gestures below the vertical distance threshold', () => {
  assert.equal(classifyPathGesture({ dx: 5, dy: 40 }, { atTop: true }), null);
});

test('rejects diagonal gestures that are not dominant in either axis', () => {
  assert.equal(classifyPathGesture({ dx: 50, dy: 45 }), null);
});

test('rejects vertical gestures that conflict with scroll position', () => {
  assert.equal(classifyPathGesture({ dx: 0, dy: -80 }, { atBottom: false, atTop: false }), null);
  assert.equal(classifyPathGesture({ dx: 0, dy: 80 }, { atBottom: false, atTop: false }), null);
});

test('honors configurable horizontal distance and dominance thresholds', () => {
  assert.equal(classifyPathGesture({ dx: -70, dy: 1 }, { horizontalMinDistance: 80 }), null);
  assert.equal(classifyPathGesture({ dx: -70, dy: 1 }, { horizontalMinDistance: 60 }), 'mastered');
  assert.equal(classifyPathGesture({ dx: -90, dy: 65 }, { dominance: 1.5 }), null);
});

// --- applyKnowledgeDecision -------------------------------------------------

test('marks a topic mastered without mutating the input state', () => {
  const state = { mastered: new Set(), needsReview: new Set(['x']) };
  const next = applyKnowledgeDecision(state, 'x', 'mastered');
  assert.deepEqual([...next.mastered], ['x']);
  assert.deepEqual([...next.needsReview], []);
  assert.deepEqual([...state.mastered], []);
  assert.deepEqual([...state.needsReview], ['x']);
});

test('marks a topic needs-review, removing it from mastered (mutual exclusivity)', () => {
  const state = { mastered: new Set(['x']), needsReview: new Set() };
  const next = applyKnowledgeDecision(state, 'x', 'needs-review');
  assert.deepEqual([...next.mastered], []);
  assert.deepEqual([...next.needsReview], ['x']);
});

test('clears both mastered and needs-review status for a topic', () => {
  const state = { mastered: new Set(['x']), needsReview: new Set(['x']) };
  const next = applyKnowledgeDecision(state, 'x', 'clear');
  assert.deepEqual([...next.mastered], []);
  assert.deepEqual([...next.needsReview], []);
});

console.log(`\n=== result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
