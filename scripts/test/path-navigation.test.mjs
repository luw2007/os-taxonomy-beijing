#!/usr/bin/env node
import assert from 'node:assert/strict';
import { findNextUnmastered } from '../../viewer/path-navigation.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}\n    ${error.message}`); }
}

console.log('=== path navigation unit tests ===\n');

const nodes = {
  A: { age: 8, name: 'A' }, B: { age: 7, name: 'B' }, C: { age: 6, name: 'C' },
  D: { age: 9, name: 'D' }, E: { age: 10, name: 'E' }, F: { age: 11, name: 'F' },
};
const edges = [
  { f: 'C', t: 'B' }, { f: 'B', t: 'A' }, { f: 'A', t: 'D' },
  { f: 'D', t: 'E' }, { f: 'E', t: 'F' },
];

test('finds an unmastered transitive prerequisite before later topics', () => {
  assert.equal(findNextUnmastered('A', new Set(['A', 'B']), nodes, edges), 'C');
});

test('uses the first unmastered transitive dependent when prerequisites are mastered', () => {
  assert.equal(findNextUnmastered('A', new Set(['A', 'B', 'C', 'D', 'E']), nodes, edges), 'F');
});

test('chooses the oldest prerequisite first within a graph level', () => {
  const branchEdges = [{ f: 'B', t: 'A' }, { f: 'C', t: 'A' }];
  assert.equal(findNextUnmastered('A', new Set(['A']), nodes, branchEdges), 'C');
});

test('does not loop when malformed input contains a cycle', () => {
  const cyclicEdges = [{ f: 'B', t: 'A' }, { f: 'A', t: 'B' }];
  assert.equal(findNextUnmastered('A', new Set(['A', 'B']), nodes, cyclicEdges), null);
});

console.log(`\n=== result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
