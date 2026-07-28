import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCasePackage } from '../export-case.mjs';
import { toRelationshipRow } from '../export-jsonl.mjs';
import { publishedEdge, publishedPathEdge } from '../review-policy.mjs';

const internalEdge = {
  topicId: 'mtc_b',
  prerequisiteId: 'mtc_a',
  strength: 'hard',
  reason: 'original edge reason',
  reviewStatus: 'reviewed',
  reviewProvenance: 'ai-consensus',
  reviewedBy: `ai-consensus-v1:${'a'.repeat(64)}`,
  reviewedAt: '2026-07-27T00:00:00.000Z',
  reviewEvidenceRef: 'reviews/ai-consensus/v1/runs/run.json',
  consensusReason: 'private role reasoning',
  consensusReferences: ['private citation'],
  configuredModel: 'private-configured-model',
  actualModel: 'private-actual-model',
  role: 'necessity',
  transportResponseId: 'private-response-id',
};

const forbidden = [
  'reviewedBy', 'reviewedAt', 'reviewEvidenceRef', 'consensusReason', 'consensusReferences',
  'configuredModel', 'actualModel', 'role', 'transportResponseId',
  'private-configured-model', 'private-actual-model', 'private-response-id',
];

test('AI consensus audit identity, role reasons, and citations stay out of JSONL projection', () => {
  const serialized = JSON.stringify(toRelationshipRow(internalEdge));
  for (const field of forbidden) assert.equal(serialized.includes(field), false, field);
  assert.equal(serialized.includes('private role reasoning'), false);
  assert.equal(serialized.includes('private citation'), false);
});

test('AI consensus audit identity, role reasons, and citations stay out of CASE projection', () => {
  const output = buildCasePackage({
    topics: [{ id: 'mtc_a', name: 'A' }, { id: 'mtc_b', name: 'B' }],
    dependencies: [internalEdge],
    baseUrl: 'https://example.invalid/taxonomy',
    version: '1.2.0-zh.0',
    generatedAt: '2026-07-27T00:00:00.000Z',
  });
  const serialized = JSON.stringify(output);
  for (const field of forbidden) assert.equal(serialized.includes(field), false, field);
  assert.equal(serialized.includes('private role reasoning'), false);
  assert.equal(serialized.includes('private citation'), false);
});

test('AI consensus audit identity, role reasons, and citations stay out of HTTP edge projection', () => {
  const serialized = JSON.stringify(publishedEdge(internalEdge));
  for (const field of forbidden) assert.equal(serialized.includes(field), false, field);
  assert.equal(serialized.includes('private role reasoning'), false);
  assert.equal(serialized.includes('private citation'), false);
});

test('AI consensus audit identity, role reasons, and citations stay out of HTTP path projection', () => {
  const serialized = JSON.stringify(publishedPathEdge(internalEdge, true));
  for (const field of forbidden) assert.equal(serialized.includes(field), false, field);
  assert.equal(serialized.includes('private role reasoning'), false);
  assert.equal(serialized.includes('private citation'), false);
  assert.deepEqual(JSON.parse(serialized), { f: 'mtc_a', t: 'mtc_b', r: 'original edge reason', x: 1, p: 'ai-consensus' });
});
