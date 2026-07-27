import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterPublishedDependencies, filterPublishedTopics,
  REVIEW_PROVENANCE, UPSTREAM_EDGE_REVIEW, mergeDependencies,
} from '../review-policy.mjs';

test('child-facing publication exposes only reviewed, non-rescope dependencies', () => {
  const edges = [
    { topicId: 'b', prerequisiteId: 'a', reviewStatus: 'reviewed' },
    { topicId: 'c', prerequisiteId: 'a', reviewStatus: 'machine' },
    { topicId: 'd', prerequisiteId: 'a', reviewStatus: 'reviewed', rescopeRequired: true },
    { topicId: 'e', prerequisiteId: 'a', reviewStatus: 'rejected' },
  ];
  assert.deepEqual(filterPublishedDependencies(edges).map(edge => edge.topicId), ['b']);
});

test('child-facing publication hides covered parent topics', () => {
  assert.deepEqual(filterPublishedTopics([{ id: 'a' }, { id: 'b', status: 'covered' }]).map(topic => topic.id), ['a']);
});

test('REVIEW_PROVENANCE enumerates the four evidence tiers and is frozen', () => {
  assert.deepEqual(REVIEW_PROVENANCE, ['upstream', 'rule', 'ai-consensus', 'human']);
  assert.throws(() => { REVIEW_PROVENANCE.push('x'); }, /extensible|frozen/);
});

test('UPSTREAM_EDGE_REVIEW marks edges reviewed with upstream provenance and is frozen', () => {
  assert.deepEqual(UPSTREAM_EDGE_REVIEW, { reviewStatus: 'reviewed', reviewProvenance: 'upstream' });
  assert.throws(() => { UPSTREAM_EDGE_REVIEW.reviewStatus = 'machine'; }, /read only|frozen|assign/i);
});

test('mergeDependencies stamps upstream edges reviewed/upstream and overlays the zh reason', () => {
  const upstreamDeps = { dependencies: [
    { topicId: 'mt_b', prerequisiteId: 'mt_a', strength: 'hard', reason: 'english reason' },
  ] };
  const zhDeps = { dependencies: [
    { topicId: 'mt_b', prerequisiteId: 'mt_a', strength: 'hard', reason: '中文理由' },
  ] };
  const merged = mergeDependencies({ upstreamDeps, zhDeps, cnDeps: null, bridgeDeps: null });
  assert.deepEqual(merged, [
    { topicId: 'mt_b', prerequisiteId: 'mt_a', strength: 'hard', reason: '中文理由', ...UPSTREAM_EDGE_REVIEW },
  ]);
});

test('mergeDependencies keeps the upstream reason when no zh override exists', () => {
  const upstreamDeps = { dependencies: [
    { topicId: 'mt_b', prerequisiteId: 'mt_a', strength: 'hard', reason: 'english reason' },
  ] };
  const merged = mergeDependencies({ upstreamDeps, zhDeps: { dependencies: [] }, cnDeps: null, bridgeDeps: null });
  assert.equal(merged[0].reason, 'english reason');
  assert.equal(merged[0].reviewProvenance, 'upstream');
});

test('mergeDependencies falls back to stamped zh-only deps when upstream is unavailable', () => {
  const zhDeps = { dependencies: [{ topicId: 'mt_b', prerequisiteId: 'mt_a', strength: 'hard', reason: '中文' }] };
  const merged = mergeDependencies({ upstreamDeps: null, zhDeps, cnDeps: null, bridgeDeps: null });
  assert.deepEqual(merged, [{ topicId: 'mt_b', prerequisiteId: 'mt_a', strength: 'hard', reason: '中文', ...UPSTREAM_EDGE_REVIEW }]);
});

test('mergeDependencies appends cn and bridge deps unchanged, without stamping them', () => {
  const zhDeps = { dependencies: [] };
  const cnDeps = { dependencies: [{ topicId: 'mtc_2', prerequisiteId: 'mtc_1', strength: 'hard', reviewStatus: 'machine' }] };
  const bridgeDeps = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mt_a', strength: 'soft', reviewStatus: 'reviewed', reviewProvenance: 'human' },
  ] };
  const merged = mergeDependencies({ upstreamDeps: null, zhDeps, cnDeps, bridgeDeps });
  assert.deepEqual(merged, [...cnDeps.dependencies, ...bridgeDeps.dependencies]);
});
