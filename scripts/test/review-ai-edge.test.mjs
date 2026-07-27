import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewEdge } from '../review-ai-edge.mjs';

const edge = {
  topicId: 'b', prerequisiteId: 'a', strength: 'hard', reviewStatus: 'machine',
  rescopeRequired: true, previousReviewStatus: 'reviewed', rescopeBatchId: 'rescope-1', ageRegression: true,
};

test('teacher review resolves rescope quarantine with durable audit metadata', () => {
  const reviewed = reviewEdge(edge, {
    status: 'reviewed', reviewer: 'teacher-1', note: '先修仍适用于收窄后的主题', reviewedAt: '2026-07-21T00:00:00.000Z',
  });
  assert.equal(reviewed.reviewStatus, 'reviewed');
  assert.equal(reviewed.rescopeRequired, undefined);
  assert.equal(reviewed.previousReviewStatus, undefined);
  assert.equal(reviewed.reviewedBy, 'teacher-1');
  assert.equal(reviewed.reviewedAt, '2026-07-21T00:00:00.000Z');
  assert.equal(reviewed.reviewNote, '先修仍适用于收窄后的主题');
  assert.equal(reviewed.rescopeBatchId, 'rescope-1');
  assert.equal(reviewed.ageRegression, undefined);
});

test('teacher can reject an invalid inherited edge', () => {
  const rejected = reviewEdge(edge, { status: 'rejected', reviewer: 'teacher-2', reviewedAt: '2026-07-21T00:00:00.000Z' });
  assert.equal(rejected.reviewStatus, 'rejected');
  assert.equal(rejected.rescopeRequired, undefined);
  assert.equal(rejected.ageRegression, undefined);
});

test('review requires a human identity and a terminal status', () => {
  assert.throws(() => reviewEdge(edge, { status: 'reviewed', reviewer: '' }), /reviewer/);
  assert.throws(() => reviewEdge(edge, { status: 'machine', reviewer: 'teacher' }), /status/);
});

test('review defaults to human provenance when none is declared', () => {
  const reviewed = reviewEdge(edge, { status: 'reviewed', reviewer: 'teacher-1', reviewedAt: '2026-07-21T00:00:00.000Z' });
  assert.equal(reviewed.reviewProvenance, 'human');
});

test('review honors an explicit ai-consensus provenance', () => {
  const reviewed = reviewEdge(edge, {
    status: 'reviewed', reviewer: 'user-delegated-claude-opus-consensus',
    reviewedAt: '2026-07-21T00:00:00.000Z', provenance: 'ai-consensus',
  });
  assert.equal(reviewed.reviewProvenance, 'ai-consensus');
});

test('review rejects rule and upstream as a declared provenance', () => {
  assert.throws(() => reviewEdge(edge, { status: 'reviewed', reviewer: 'teacher-1', provenance: 'rule' }), /provenance/);
  assert.throws(() => reviewEdge(edge, { status: 'reviewed', reviewer: 'teacher-1', provenance: 'upstream' }), /provenance/);
});
