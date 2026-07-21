import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateGoldSet } from '../evaluate-ai-gold-set.mjs';

test('gold-set harness reports consensus precision recall and reviewer kappa by subject and kind', () => {
  const records = [
    { subject: 'Biology', kind: 'relation', predicted: 'prerequisite', reviewerA: 'prerequisite', reviewerB: 'prerequisite' },
    { subject: 'Biology', kind: 'relation', predicted: 'prerequisite', reviewerA: 'none', reviewerB: 'none' },
    { subject: 'Biology', kind: 'relation', predicted: 'none', reviewerA: 'prerequisite', reviewerB: 'prerequisite' },
    { subject: 'Biology', kind: 'relation', predicted: 'none', reviewerA: 'none', reviewerB: 'none' },
  ];
  const report = evaluateGoldSet(records);
  const row = report.groups['Biology|relation'];
  assert.equal(row.consensusCount, 4);
  assert.equal(row.precision, 0.5);
  assert.equal(row.recall, 0.5);
  assert.equal(row.kappa, 1);
  assert.equal(row.sampleReady, false);
});
