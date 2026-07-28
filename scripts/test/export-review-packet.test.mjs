import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { assertPacketSourceChecksums, buildReviewPacket } from '../export-review-packet.mjs';
import { edgeContentFingerprint } from '../consensus-roles.mjs';

const topics = {
  topics: [
    { id: 'mtc_a', name: '基础', description: '基础描述', subject: 'Mathematics', domain: 'Number', ageRangeStart: 7, ageRangeEnd: 8, evidence: ['能完成基础任务'], cnStandards: ['std-a'], origin: 'progression' },
    { id: 'mtc_b', name: '进阶', description: '进阶描述', subject: 'Mathematics', domain: 'Number', ageRangeStart: 8, ageRangeEnd: 9, evidence: ['能完成进阶任务'], cnStandards: ['std-b'], origin: 'progression' },
    { id: 'mtc_c', name: '语文', description: '语文描述', subject: 'Chinese', domain: 'Reading', ageRangeStart: 8, ageRangeEnd: 9, evidence: ['能阅读'], cnStandards: ['std-c'], origin: 'progression' },
  ],
};

const dependencies = {
  dependencies: [
    { topicId: 'mtc_c', prerequisiteId: 'mtc_a', strength: 'soft', reason: '相关', reviewStatus: 'machine' },
    { topicId: 'mtc_b', prerequisiteId: 'mtc_a', strength: 'hard', reason: '先修', reviewStatus: 'machine', generationBatchId: 'batch-1' },
    { topicId: 'mtc_a', prerequisiteId: 'mtc_b', strength: 'hard', reason: '已审核', reviewStatus: 'reviewed', reviewProvenance: 'rule' },
    { topicId: 'mtc_b', prerequisiteId: 'mtc_a', strength: 'soft', reason: '隔离', reviewStatus: 'machine', ageRegression: true },
    { topicId: 'mtc_b', prerequisiteId: 'mtc_c', strength: 'soft', reason: '隔离', reviewStatus: 'machine', rescopeRequired: true },
    { topicId: 'mtc_c', prerequisiteId: 'mtc_b', strength: 'soft', reason: '隔离', reviewStatus: 'machine', previousReviewStatus: 'reviewed' },
  ],
  generationBatches: [{ id: 'batch-1', model: 'test-model', inputFingerprint: 'abc', generatedAt: '2026-07-20T00:00:00.000Z', strategy: 'test' }],
};

const source = { taxonomyVersion: '1.2.0-zh.0', generatedAt: '2026-07-20T00:00:00.000Z', cnTopicsSha256: 'topics-hash', cnDependenciesSha256: 'deps-hash' };

test('review packet is deterministic and carries machine-edge teaching context', () => {
  const options = { subject: 'Mathematics', limit: 20, offset: 0 };
  const first = buildReviewPacket({ topics, dependencies, source, options });
  const second = buildReviewPacket({ topics, dependencies, source, options });

  assert.deepEqual(first, second);
  assert.equal(first.format, 'beijing-skill-taxonomy-edge-review-packet/v1');
  assert.deepEqual(first.selection, { subject: 'Mathematics', domain: null, generationBatchId: null, offset: 0, limit: 20 });
  assert.equal(first.totalMachineEdges, 1);
  assert.equal(first.edges.length, 1);
  assert.deepEqual(first.edges[0], {
    topicId: 'mtc_b', prerequisiteId: 'mtc_a', strength: 'hard', reason: '先修', generationBatchId: 'batch-1',
    contentFingerprint: edgeContentFingerprint(dependencies.dependencies[1]),
    generationBatch: { id: 'batch-1', model: 'test-model', inputFingerprint: 'abc', generatedAt: '2026-07-20T00:00:00.000Z', strategy: 'test' },
    topic: { id: 'mtc_b', name: '进阶', description: '进阶描述', subject: 'Mathematics', domain: 'Number', ageRangeStart: 8, ageRangeEnd: 9, evidence: ['能完成进阶任务'], cnStandards: ['std-b'] },
    prerequisite: { id: 'mtc_a', name: '基础', description: '基础描述', subject: 'Mathematics', domain: 'Number', ageRangeStart: 7, ageRangeEnd: 8, evidence: ['能完成基础任务'], cnStandards: ['std-a'] },
  });
});

test('review packet rejects missing topic context and never includes non-machine edges', () => {
  assert.throws(() => buildReviewPacket({
    topics: { topics: [] }, dependencies: { dependencies: [dependencies.dependencies[1]], generationBatches: [] }, source, options: {},
  }), /missing topic context/);
});

test('review packet excludes quarantined machine edges and centrality from shared topic projection', () => {
  const packet = buildReviewPacket({ topics: { topics: topics.topics.map(topic => ({ ...topic, centrality: 0.8 })) }, dependencies, source, options: { limit: 20 } });
  assert.equal(packet.totalMachineEdges, 2);
  assert.equal(packet.edges.some(edge => 'centrality' in edge.topic || 'centrality' in edge.prerequisite), false);
  assert.equal(packet.edges.some(edge => ['隔离'].includes(edge.reason)), false);
});

test('packet source checksum guard rejects a stale manifest', () => {
  const sha256 = value => createHash('sha256').update(value).digest('hex');
  assert.doesNotThrow(() => assertPacketSourceChecksums({
    manifest: { files: { 'cn-topics.json': { sha256: sha256('topics') }, 'cn-dependencies.json': { sha256: sha256('dependencies') } } },
    cnTopicsBytes: Buffer.from('topics'), cnDependenciesBytes: Buffer.from('dependencies'),
  }));
  assert.throws(() => assertPacketSourceChecksums({
    manifest: { files: { 'cn-topics.json': { sha256: sha256('stale') }, 'cn-dependencies.json': { sha256: sha256('dependencies') } } },
    cnTopicsBytes: Buffer.from('topics'), cnDependenciesBytes: Buffer.from('dependencies'),
  }), /checksum mismatch/);
});
