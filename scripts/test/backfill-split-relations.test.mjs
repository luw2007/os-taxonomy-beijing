#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildCandidates,
  missingTargetIds,
  parseRelations,
  selectAppendableEdges,
} from '../backfill-split-relations.mjs';

const topics = [
  { id: 'parent', subject: 'Biology', domain: 'Immunity', stage: '高中', ageRangeStart: 16, name: '特异性免疫', description: '体液免疫和细胞免疫' },
  { id: 'child-a', splitFrom: 'parent', subject: 'Biology', domain: 'Immunity', stage: '高中', ageRangeStart: 16, name: '体液免疫', description: '抗体参与的免疫' },
  { id: 'child-b', splitFrom: 'parent', subject: 'Biology', domain: 'Immunity', stage: '高中', ageRangeStart: 16, name: '细胞免疫', description: '细胞参与的免疫' },
  { id: 'prior', subject: 'Biology', domain: 'Immunity', stage: '高中', ageRangeStart: 16, name: '免疫系统组成', description: '免疫器官和免疫细胞' },
  { id: 'later', subject: 'Biology', domain: 'Immunity', stage: '高中', ageRangeStart: 16, name: '免疫失调', description: '过敏与自身免疫病' },
  { id: 'local', subject: 'Biology', domain: 'Immunity', stage: '高中', ageRangeStart: 16, name: '抗原与抗体', description: '抗原抗体特异性结合' },
  { id: 'junior', subject: 'Biology', domain: 'Immunity', stage: '初中', ageRangeStart: 13, name: '人体免疫防线', description: '人体三道防线' },
  { id: 'unrelated', splitFrom: 'parent', subject: 'Geography', domain: 'Climate', stage: '高中', ageRangeStart: 16, name: '季风气候', description: '季风气候' },
];
const existing = [
  { topicId: 'parent', prerequisiteId: 'prior', strength: 'hard', reason: '先理解组成' },
  { topicId: 'later', prerequisiteId: 'parent', strength: 'soft', reason: '再理解失调' },
];

const candidates = buildCandidates(topics[1], topics, existing, { localLimit: 4, crossStageLimit: 2 });
assert.ok(candidates.some(c => c.id === 'prior' && c.sources.includes('parent-edge')), '应召回父节点前置邻居');
assert.ok(candidates.some(c => c.id === 'later' && c.sources.includes('parent-edge')), '应召回父节点后续邻居');
assert.ok(candidates.some(c => c.id === 'child-b' && c.sources.includes('sibling')), '应召回兄弟节点');
assert.ok(candidates.some(c => c.id === 'local' && c.sources.includes('local')), '应召回同桶近邻');
assert.ok(!candidates.some(c => c.id === 'unrelated'), '同 splitFrom 但跨学科的历史脏数据不应视为兄弟');
assert.ok(candidates.some(c => c.id === 'junior' && c.sources.includes('cross-stage')), '应召回相邻学段节点');
const corruptCandidates = buildCandidates(topics[7], topics, existing);
assert.ok(!corruptCandidates.some(c => ['parent', 'prior', 'later'].includes(c.id)),
  '跨学科错误 splitFrom 不得召回父节点及父边邻居');

assert.deepEqual(
  missingTargetIds([{ id: 'a' }, { id: 'b' }], [{ targets: [{ id: 'a' }] }]),
  ['b'],
  '应报告筛选范围内尚未审计的目标',
);

const allowedPairs = new Set(['child-a|prior', 'child-a|local', 'child-b|child-a']);
const parsed = parseRelations(JSON.stringify({ relations: [
  { topicId: 'child-a', prerequisiteId: 'prior', type: 'prerequisite', strength: 'hard', confidence: 0.9, reason: '需要先理解免疫组成' },
  { topicId: 'child-a', prerequisiteId: 'local', type: 'related', confidence: 0.8, reason: '相关但非先修' },
  { topicId: 'unrelated', prerequisiteId: 'prior', type: 'prerequisite', strength: 'hard', confidence: 0.99, reason: '幻觉端点' },
] }), allowedPairs, new Set(topics.map(t => t.id)));
assert.equal(parsed.prerequisites.length, 1, '只保留候选集内的 prerequisite');
assert.equal(parsed.related.length, 1, 'related 只进入工作结果');
assert.equal(parsed.rejected.length, 1, '候选集外关系必须拒绝');

const oldEdges = [
  { topicId: 'B', prerequisiteId: 'A', strength: 'hard', reason: 'old', reviewStatus: 'reviewed' },
  { topicId: 'C', prerequisiteId: 'B', strength: 'hard', reason: 'old', reviewStatus: 'reviewed' },
];
const proposals = [
  { topicId: 'D', prerequisiteId: 'C', strength: 'soft', reason: 'valid' },
  { topicId: 'B', prerequisiteId: 'A', strength: 'soft', reason: 'duplicate' },
  { topicId: 'A', prerequisiteId: 'B', strength: 'soft', reason: 'reverse conflict' },
  { topicId: 'A', prerequisiteId: 'C', strength: 'soft', reason: 'cycle' },
  { topicId: 'missing', prerequisiteId: 'A', strength: 'soft', reason: 'bad endpoint' },
  { topicId: 'junior', prerequisiteId: 'senior', strength: 'hard', reason: 'stage regression' },
];
const stageTopics = new Map([
  ['A', { stage: '初中' }], ['B', { stage: '初中' }], ['C', { stage: '高中' }], ['D', { stage: '高中' }],
  ['junior', { stage: '初中' }], ['senior', { stage: '高中' }],
]);
const selected = selectAppendableEdges(oldEdges, proposals, new Set(stageTopics.keys()), stageTopics);
assert.deepEqual(selected.appended.map(e => [e.topicId, e.prerequisiteId]), [['D', 'C']], '只追加安全的新边');
assert.equal(selected.rejected.length, 5);
assert.ok(selected.rejected.some(e => e.rejectedReason === 'stage-regression'));
assert.deepEqual(oldEdges, [
  { topicId: 'B', prerequisiteId: 'A', strength: 'hard', reason: 'old', reviewStatus: 'reviewed' },
  { topicId: 'C', prerequisiteId: 'B', strength: 'hard', reason: 'old', reviewStatus: 'reviewed' },
], '不得修改旧边');
assert.equal(selected.finalEdges.length, 3);
assert.deepEqual(selected.finalEdges.slice(0, oldEdges.length), oldEdges, '旧边顺序和内容必须原样保留在前缀');
assert.equal(selected.finalEdges[2].reviewStatus, 'machine');

console.log('✓ backfill-split-relations safety tests');
