import assert from 'node:assert/strict';
import test from 'node:test';

import { prepareGranularityChanges, validateSplitResult } from '../granularity-safety.mjs';

const parent = {
  id: 'mtc_10', type: 'CONCEPTUAL', subject: 'Biology', domain: 'Immunity',
  name: '特异性免疫', description: '体液免疫和细胞免疫', ageRangeStart: 15, ageRangeEnd: 17,
  centrality: 0.5, evidence: ['能比较两类免疫'], assessmentPrompt: '比较',
  cnStandards: ['bio:1'], origin: 'textbook', stage: '高中', nodeKind: 'concept',
};
const covered = {
  id: 'mtc_11', type: 'CONCEPTUAL', subject: 'Biology', domain: 'Immunity',
  name: '免疫过程', description: '宽泛过程', ageRangeStart: 15, ageRangeEnd: 17,
  centrality: 0.1, evidence: ['能描述过程'], assessmentPrompt: '描述',
  cnStandards: ['bio:1'], origin: 'textbook', stage: '高中', nodeKind: 'concept',
};
const child = (name) => ({ name, description: `${name}的范围`, estimateMinutes: 40, evidence: [`能解释${name}`] });
const split = {
  id: 'mtc_10', verdict: 'split', estimateMinutes: 90,
  children: [child('体液免疫'), child('细胞免疫')],
};

const base = () => ({
  topicsDoc: { topicCount: 2, topics: structuredClone([parent, covered]) },
  depsDoc: { edgeCount: 2, dependencies: [
    { topicId: 'mtc_11', prerequisiteId: 'mtc_10', strength: 'hard', reason: 'old reviewed', reviewStatus: 'reviewed' },
    { topicId: 'mtc_10', prerequisiteId: 'mtc_11', strength: 'soft', reason: 'old machine', reviewStatus: 'machine' },
  ] },
});

test('split children require concrete descriptions and evidence before apply', () => {
  assert.equal(validateSplitResult({ ...split, children: [{ ...child('体液免疫'), evidence: [] }, child('细胞免疫')] }).valid, false);
  assert.equal(validateSplitResult({ ...split, children: [{ ...child('体液免疫'), description: '' }, child('细胞免疫')] }).valid, false);
  assert.equal(validateSplitResult(split).valid, true);
});

test('split apply demotes inherited reviewed edges and marks every touching edge for rescope', () => {
  const input = base();
  const out = prepareGranularityChanges({ ...input, results: [split], generationBatchId: 'split-batch' });
  const rewritten = out.depsDoc.dependencies;
  assert.equal(rewritten.length, 2);
  assert.ok(rewritten.every(edge => edge.reviewStatus === 'machine' && edge.rescopeRequired === true));
  assert.equal(rewritten[0].previousReviewStatus, 'reviewed');
  assert.equal(rewritten[1].previousReviewStatus, undefined);
  assert.ok(rewritten.every(edge => edge.generationBatchId === 'split-batch'));
  assert.equal(out.topicsDoc.topics.find(topic => topic.id === 'mtc_10').centrality, null);
  const second = out.topicsDoc.topics.find(topic => topic.splitFrom === 'mtc_10');
  assert.equal(second.name, '细胞免疫');
  assert.equal(second.centrality, null);
});

test('split apply is deterministic, rejects duplicate result ids, and is idempotent', () => {
  const input = base();
  assert.throws(() => prepareGranularityChanges({ ...input, results: [split, split] }), /重复/);
  const first = prepareGranularityChanges({ ...input, results: [split] });
  const second = prepareGranularityChanges({ topicsDoc: first.topicsDoc, depsDoc: first.depsDoc, results: [split] });
  assert.deepEqual(second.topicsDoc, first.topicsDoc);
  assert.deepEqual(second.depsDoc, first.depsDoc);
});

test('covered verdict persists canonical coveredBy without deleting the parent', () => {
  const input = base();
  const result = { id: 'mtc_11', verdict: 'covered', coveredBy: ['mtc_10', 'mtc_12'] };
  input.topicsDoc.topics.push({ ...parent, id: 'mtc_12', name: '细胞免疫' });
  input.topicsDoc.topicCount++;
  const out = prepareGranularityChanges({ ...input, results: [result] });
  const topic = out.topicsDoc.topics.find(item => item.id === 'mtc_11');
  assert.equal(topic.status, 'covered');
  assert.deepEqual(topic.coveredBy, ['mtc_10', 'mtc_12']);
});
