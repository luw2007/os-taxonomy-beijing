import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewEdge } from '../review-ai-edge.mjs';

const edge = {
  topicId: 'b', prerequisiteId: 'a', strength: 'hard', reviewStatus: 'machine',
  rescopeRequired: true, previousReviewStatus: 'reviewed', rescopeBatchId: 'rescope-1',
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
});

test('teacher can reject an invalid inherited edge', () => {
  const rejected = reviewEdge(edge, { status: 'rejected', reviewer: 'teacher-2', reviewedAt: '2026-07-21T00:00:00.000Z' });
  assert.equal(rejected.reviewStatus, 'rejected');
  assert.equal(rejected.rescopeRequired, undefined);
});

test('review requires a human identity and a terminal status', () => {
  assert.throws(() => reviewEdge(edge, { status: 'reviewed', reviewer: '' }), /reviewer/);
  assert.throws(() => reviewEdge(edge, { status: 'machine', reviewer: 'teacher' }), /status/);
});
