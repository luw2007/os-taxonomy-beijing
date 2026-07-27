import assert from 'node:assert/strict';
import test from 'node:test';

import {
  migrateEdge, migrateReviewProvenance,
  AI_CONSENSUS_REVIEWER, BRIDGE_CURATION_REVIEWER, BRIDGE_CURATION_REVIEWED_AT,
} from '../migrate-review-provenance.mjs';

// --- 映射：cn-dependencies.json（isBridge=false）--------------------------

test('cn-dependencies mapping: reviewed without reviewedBy becomes rule', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mtc_2', strength: 'hard', reviewStatus: 'reviewed' },
  ] };
  const { doc: next, counts } = migrateReviewProvenance(doc, false);
  assert.equal(next.dependencies[0].reviewProvenance, 'rule');
  assert.equal(next.dependencies[0].reviewedBy, undefined);
  assert.deepEqual(counts, { rule: 1, 'ai-consensus': 0, human: 0, machine: 0, alreadyStamped: 0 });
});

test('cn-dependencies mapping: the ai-consensus reviewer covers both reviewed and rejected', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mtc_2', strength: 'hard', reviewStatus: 'reviewed', reviewedBy: AI_CONSENSUS_REVIEWER },
    { topicId: 'mtc_3', prerequisiteId: 'mtc_4', strength: 'hard', reviewStatus: 'rejected', reviewedBy: AI_CONSENSUS_REVIEWER },
  ] };
  const { doc: next, counts } = migrateReviewProvenance(doc, false);
  assert.equal(next.dependencies[0].reviewProvenance, 'ai-consensus');
  assert.equal(next.dependencies[1].reviewProvenance, 'ai-consensus');
  assert.equal(counts['ai-consensus'], 2);
});

test('machine edges (including missing reviewStatus) are left untouched', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mtc_2', strength: 'hard', reviewStatus: 'machine' },
    { topicId: 'mtc_3', prerequisiteId: 'mtc_4', strength: 'hard' },
  ] };
  const { doc: next, counts } = migrateReviewProvenance(doc, false);
  assert.equal(next.dependencies[0].reviewProvenance, undefined);
  assert.equal(next.dependencies[1].reviewProvenance, undefined);
  assert.equal(counts.machine, 2);
});

// --- 映射：cn-bridge-dependencies.json（isBridge=true）--------------------

test('bridge mapping: reviewed without reviewedBy becomes human with an injected curation audit', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mt_1', strength: 'soft', reason: 'x', reviewStatus: 'reviewed' },
  ] };
  const { doc: next, counts } = migrateReviewProvenance(doc, true);
  const edge = next.dependencies[0];
  assert.equal(edge.reviewProvenance, 'human');
  assert.equal(edge.reviewedBy, BRIDGE_CURATION_REVIEWER);
  assert.equal(edge.reviewedAt, BRIDGE_CURATION_REVIEWED_AT);
  assert.equal(counts.human, 1);
});

test('bridge mapping: the ai-consensus reviewer is unaffected by the bridge human default', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mt_1', strength: 'soft', reviewStatus: 'reviewed', reviewedBy: AI_CONSENSUS_REVIEWER },
  ] };
  const { doc: next, counts } = migrateReviewProvenance(doc, true);
  assert.equal(next.dependencies[0].reviewProvenance, 'ai-consensus');
  assert.equal(next.dependencies[0].reviewedBy, AI_CONSENSUS_REVIEWER);
  assert.equal(counts['ai-consensus'], 1);
});

// --- 幂等性 -----------------------------------------------------------------

test('idempotent: re-running on already-migrated cn-dependencies produces identical output', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mtc_2', strength: 'hard', reviewStatus: 'reviewed' },
    { topicId: 'mtc_3', prerequisiteId: 'mtc_4', strength: 'hard', reviewStatus: 'reviewed', reviewedBy: AI_CONSENSUS_REVIEWER },
    { topicId: 'mtc_5', prerequisiteId: 'mtc_6', strength: 'hard', reviewStatus: 'machine' },
  ] };
  const first = migrateReviewProvenance(doc, false);
  const second = migrateReviewProvenance(first.doc, false);
  assert.deepEqual(second.doc, first.doc);
  assert.deepEqual(second.counts, { rule: 0, 'ai-consensus': 0, human: 0, machine: 1, alreadyStamped: 2 });
});

test('idempotent: re-running on already-migrated bridge does not choke on the injected curation reviewedBy', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mt_1', strength: 'soft', reviewStatus: 'reviewed' },
  ] };
  const first = migrateReviewProvenance(doc, true);
  const second = migrateReviewProvenance(first.doc, true);
  assert.deepEqual(second.doc, first.doc);
  assert.deepEqual(second.counts, { rule: 0, 'ai-consensus': 0, human: 0, machine: 0, alreadyStamped: 1 });
});

// --- 硬错误路径 --------------------------------------------------------------

test('hard error: a rejected edge without reviewedBy cannot be migrated', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mtc_2', strength: 'hard', reviewStatus: 'rejected' },
  ] };
  assert.throws(() => migrateReviewProvenance(doc, false), /rejected 边缺 reviewedBy/);
});

test('hard error: an unrecognized reviewedBy value is not silently treated as human', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mtc_2', strength: 'hard', reviewStatus: 'reviewed', reviewedBy: 'someone-unexpected' },
  ] };
  assert.throws(() => migrateReviewProvenance(doc, false), /无法识别的 reviewedBy/);
});

test('hard error: a pre-existing illegal reviewProvenance is rejected rather than overwritten', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mtc_2', strength: 'hard', reviewStatus: 'reviewed', reviewProvenance: 'upstream' },
  ] };
  assert.throws(() => migrateReviewProvenance(doc, false), /非法的既有 reviewProvenance/);
});

test('hard error: a machine edge carrying a stray reviewProvenance is rejected', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mtc_2', strength: 'hard', reviewStatus: 'machine', reviewProvenance: 'rule' },
  ] };
  assert.throws(() => migrateReviewProvenance(doc, false), /machine 边不得携带 reviewProvenance/);
});

test('hard error: an invalid reviewStatus is rejected rather than silently treated as reviewed', () => {
  const doc = { dependencies: [
    { topicId: 'mtc_1', prerequisiteId: 'mtc_2', strength: 'hard', reviewStatus: 'bogus' },
  ] };
  assert.throws(() => migrateReviewProvenance(doc, false), /非法 reviewStatus/);
});

// --- migrateEdge（单条边）作为独立可测单元 -----------------------------------

test('migrateEdge returns the same edge reference (no mutation) for machine edges', () => {
  const edge = { topicId: 'mtc_1', prerequisiteId: 'mtc_2', strength: 'hard', reviewStatus: 'machine' };
  const { edge: result, bucket } = migrateEdge(edge, false);
  assert.equal(result, edge);
  assert.equal(bucket, 'machine');
});
