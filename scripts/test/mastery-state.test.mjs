#!/usr/bin/env node
import assert from 'node:assert/strict';
import { toggleMastery } from '../../viewer/mastery-state.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}\n    ${error.message}`); }
}

console.log('=== mastery state unit tests ===\n');

test('adds an unmastered topic without mutating the input', () => {
  const mastered = new Set(['a']);
  const next = toggleMastery(mastered, 'b');
  assert.deepEqual([...next].sort(), ['a', 'b']);
  assert.deepEqual([...mastered], ['a']);
});

test('removes a mastered topic', () => {
  assert.deepEqual([...toggleMastery(new Set(['a', 'b']), 'a')], ['b']);
});

console.log(`\n=== result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
