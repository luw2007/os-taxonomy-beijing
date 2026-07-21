import assert from 'node:assert/strict';
import test from 'node:test';

import { migrateAiSafetyData } from '../migrate-ai-safety.mjs';

const topicsDoc = { topicCount: 4, topics: [
  { id: 'p', name: 'first', subject: 'Biology', stage: '高中', ageRangeStart: 16, granularity: 'split-45min', centrality: 0.5 },
  { id: 'c', name: 'second', subject: 'Biology', stage: '高中', ageRangeStart: 15, splitFrom: 'p', centrality: 0.5 },
  { id: 'x', name: 'covered', subject: 'Biology', stage: '高中', ageRangeStart: 16, centrality: 0.1 },
  { id: 'y', name: 'detail', subject: 'Biology', stage: '高中', ageRangeStart: 16, centrality: 0.1 },
] };
const depsDoc = { edgeCount: 2, dependencies: [
  { topicId: 'x', prerequisiteId: 'p', strength: 'hard', reviewStatus: 'reviewed' },
  { topicId: 'c', prerequisiteId: 'p', strength: 'soft', reviewStatus: 'machine' },
] };

test('migration quarantines inherited edges and persists covered and historical batch metadata', () => {
  const out = migrateAiSafetyData({
    topicsDoc,
    depsDoc,
    coveredResults: [{ id: 'x', verdict: 'covered', coveredBy: ['c', 'y'] }],
    historicalBackfillStart: 1,
    migratedAt: '2026-07-21T00:00:00.000Z',
  });
  assert.equal(out.stats.rescopeEdges, 2);
  assert.equal(out.stats.demotedReviewed, 1);
  assert.equal(out.topicsDoc.topics.find(topic => topic.id === 'x').status, 'covered');
  assert.ok(out.depsDoc.dependencies.every(edge => edge.rescopeRequired));
  assert.equal(out.depsDoc.dependencies[1].generationBatchId, 'split-relations-20260721-historical');
  assert.equal(out.depsDoc.generationBatches.length, 1);
  assert.equal(out.depsDoc.dependencies[1].ageRegression, true);
  assert.equal(out.depsDoc.generationBatches[0].inputFingerprint, null);
});
