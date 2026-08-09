#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildPathHash, parsePathRoute } from '../../viewer/path-route.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}\n    ${error.message}`); }
}

console.log('=== path route unit tests ===\n');

test('restores dimension, subject, and domain from a legacy viewer hash', () => {
  assert.deepEqual(
    parsePathRoute('#/?dim=bj-primary&subject=Mathematics&domain=Geometry'),
    { id: null, dim: 'bj-primary', subject: 'Mathematics', domain: 'Geometry', tab: 'path' },
  );
});

test('builds a shareable path topic URL that preserves its catalog context', () => {
  assert.equal(
    buildPathHash({ id: 'mt_KJeEeTutJI', dim: 'bj-primary', subject: 'Mathematics', domain: 'Geometry', tab: 'path' }),
    '#/mt_KJeEeTutJI?dim=bj-primary&subject=Mathematics&domain=Geometry',
  );
});

test('builds and restores a graph topic URL', () => {
  const hash = buildPathHash({ id: 'mt_KJeEeTutJI', dim: 'bj-primary', subject: 'Mathematics', domain: 'Geometry', tab: 'graph' });
  assert.equal(hash, '#/mt_KJeEeTutJI?dim=bj-primary&subject=Mathematics&domain=Geometry&tab=graph');
  assert.deepEqual(parsePathRoute(hash), { id: 'mt_KJeEeTutJI', dim: 'bj-primary', subject: 'Mathematics', domain: 'Geometry', tab: 'graph' });
});

test('treats partial or unrelated route fields as no catalog selection', () => {
  assert.deepEqual(parsePathRoute('#/?dim=bj-primary&subject=Mathematics'), { id: null, dim: 'bj-primary', subject: null, domain: null, tab: 'path' });
  assert.deepEqual(parsePathRoute('#/mt_KJeEeTutJI?dim=bj-primary'), { id: 'mt_KJeEeTutJI', dim: 'bj-primary', subject: null, domain: null, tab: 'path' });
});

console.log(`\n=== result: ${passed} passed, ${failed} failed ===`);
if (failed) process.exit(1);
