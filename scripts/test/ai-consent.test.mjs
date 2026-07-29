#!/usr/bin/env node
import assert from 'node:assert/strict';
import { withAgreement } from '../../viewer/ai-consent.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}\n    ${error.message}`); }
}

console.log('=== AI consent unit tests ===\n');

test('runs an AI action immediately after agreement', () => {
  let ran = false;
  assert.equal(withAgreement(true, () => {}, () => { ran = true; }), true);
  assert.equal(ran, true);
});

test('requests agreement without running an AI action before consent', () => {
  let requested = false;
  let ran = false;
  assert.equal(withAgreement(false, () => { requested = true; }, () => { ran = true; }), false);
  assert.equal(requested, true);
  assert.equal(ran, false);
});

console.log(`\n=== result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
