#!/usr/bin/env node
import assert from 'node:assert/strict';
import { formatMasteryProgress } from '../../viewer/mastery-progress.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}\n    ${error.message}`); }
}

console.log('=== mastery progress unit tests ===\n');

test('counts only mastered topics visible in the active dimension', () => {
  assert.deepEqual(formatMasteryProgress(new Set(['a', 'off-dimension', 'missing']), new Set(['a', 'b'])), {
    count: 1,
    percent: '50.0',
  });
});

test('renders zero progress for an empty dimension', () => {
  assert.deepEqual(formatMasteryProgress(new Set(['a']), new Set()), { count: 0, percent: '0.0' });
});

console.log(`\n=== result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
