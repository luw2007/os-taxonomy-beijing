import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExport, mergeTopics, toNodeRow, toRelationshipRow } from '../export-jsonl.mjs';

test('toNodeRow projects only whitelisted properties, dropping internal bookkeeping and teaching payload', () => {
  const topic = {
    id: 'mtc_001',
    name: '拼音·声母韵母',
    description: '声母与韵母的组合规则',
    subject: 'Chinese',
    domain: 'Literacy & Handwriting',
    type: 'LANGUAGE',
    nodeKind: 'concept',
    ageRangeStart: 6,
    ageRangeEnd: 8,
    centrality: 0.333333,
    cnStandards: ['moe-2022-chinese:S1.RW.01'],
    translationStatus: 'cn-origin',
    // 教学载荷与内部审核簿记——绝不应出现在导出属性里
    evidence: '教材第 3 单元',
    assessmentPrompt: '请拼读……',
    splitFrom: 'mtc_000',
    coveredBy: 'mtc_099',
    generationBatchId: 'batch-42',
    previousReviewStatus: 'machine',
    status: 'active',
  };
  const row = toNodeRow(topic);
  assert.deepEqual(row, {
    id: 'mtc_001',
    labels: ['MicroTopic', 'ChinaOrigin'],
    properties: {
      name: '拼音·声母韵母',
      description: '声母与韵母的组合规则',
      subject: 'Chinese',
      domain: 'Literacy & Handwriting',
      type: 'LANGUAGE',
      nodeKind: 'concept',
      ageRangeStart: 6,
      ageRangeEnd: 8,
      centrality: 0.333333,
      cnStandards: ['moe-2022-chinese:S1.RW.01'],
      translationStatus: 'cn-origin',
    },
  });
});

test('toNodeRow labels non mtc_ ids as Upstream', () => {
  const row = toNodeRow({ id: 'mt_abc', name: 'x' });
  assert.deepEqual(row.labels, ['MicroTopic', 'Upstream']);
});

test('toRelationshipRow projects only whitelisted properties; a rescopeRequired fixture must not leak', () => {
  const edge = {
    topicId: 'mt__00ZSLnB7p',
    prerequisiteId: 'mt_VBl1T1sFCM',
    strength: 'hard',
    reason: '在找到音量模式之前必须了解振动发出声音',
    reviewStatus: 'reviewed',
    reviewProvenance: 'upstream',
    // 内部审核簿记——绝不应出现在导出属性里
    rescopeRequired: true,
    previousReviewStatus: 'machine',
    reviewNote: '待复核',
    splitFrom: 'mt_old',
    coveredBy: 'mt_other',
    generationBatchId: 'batch-7',
  };
  const row = toRelationshipRow(edge);
  assert.deepEqual(row, {
    type: 'PREREQUISITE_OF',
    from: 'mt_VBl1T1sFCM',
    to: 'mt__00ZSLnB7p',
    properties: {
      strength: 'hard',
      reason: '在找到音量模式之前必须了解振动发出声音',
      reviewStatus: 'reviewed',
      reviewProvenance: 'upstream',
    },
  });
  assert.equal('rescopeRequired' in row.properties, false);
});

test('toRelationshipRow omits undefined optional properties instead of writing null/undefined', () => {
  const row = toRelationshipRow({ topicId: 'b', prerequisiteId: 'a', strength: 'soft', reviewStatus: 'reviewed' });
  assert.deepEqual(row.properties, { strength: 'soft', reviewStatus: 'reviewed' });
});

test('mergeTopics: upstream+zh merges with zh text overriding upstream structure fields kept', () => {
  const upstreamTopics = { topics: [{ id: 'mt_a', name: 'EN name', description: 'EN desc', subject: 'Math', domain: 'Algebra', ageRangeStart: 10, ageRangeEnd: 12, centrality: 0.1 }] };
  const zhTopics = { topics: [{ id: 'mt_a', name: '中文名', description: '中文描述', cnStandards: ['std-1'], translationStatus: 'reviewed' }] };
  const [topic] = mergeTopics({ upstreamTopics, zhTopics, cnTopics: null });
  assert.equal(topic.name, '中文名');
  assert.equal(topic.description, '中文描述');
  assert.equal(topic.subject, 'Math');
  assert.deepEqual(topic.cnStandards, ['std-1']);
  assert.equal(topic.translationStatus, 'reviewed');
});

test('mergeTopics: upstream-only topic is marked untranslated', () => {
  const upstreamTopics = { topics: [{ id: 'mt_b', name: 'EN only', subject: 'Science' }] };
  const zhTopics = { topics: [] };
  const [topic] = mergeTopics({ upstreamTopics, zhTopics, cnTopics: null });
  assert.equal(topic.translationStatus, 'untranslated');
  assert.equal(topic.name, 'EN only');
});

test('mergeTopics: cn-origin topics are appended with translationStatus cn-origin', () => {
  const upstreamTopics = { topics: [] };
  const zhTopics = { topics: [] };
  const cnTopics = { topics: [{ id: 'mtc_x', name: '中国主题', subject: 'Chinese' }] };
  const [topic] = mergeTopics({ upstreamTopics, zhTopics, cnTopics });
  assert.equal(topic.translationStatus, 'cn-origin');
  assert.equal(topic.id, 'mtc_x');
});

test('buildExport only emits the published graph (non-covered topics, reviewed non-rescope edges) with whitelisted rows', () => {
  const upstreamTopics = { topics: [
    { id: 'mt_a', name: 'A', description: 'desc a', subject: 'Math', domain: 'Algebra', ageRangeStart: 8, ageRangeEnd: 10, centrality: 0.2 },
    { id: 'mt_b', name: 'B', description: 'desc b', subject: 'Math', domain: 'Algebra', ageRangeStart: 9, ageRangeEnd: 11, centrality: 0.3 },
  ] };
  const zhTopics = { topics: [
    { id: 'mt_a', name: 'A中文', description: 'A中文描述', translationStatus: 'reviewed' },
    { id: 'mt_b', name: 'B中文', description: 'B中文描述', translationStatus: 'reviewed' },
  ] };
  const cnTopics = { topics: [
    { id: 'mtc_c', name: 'C', description: 'C描述', subject: 'Chinese', domain: '拼音', status: 'covered' },
  ] };
  const upstreamDeps = { dependencies: [
    { topicId: 'mt_b', prerequisiteId: 'mt_a', strength: 'hard', reason: 'upstream reason' },
  ] };
  const zhDeps = { dependencies: [] };
  const cnDeps = { dependencies: [
    { topicId: 'mtc_c', prerequisiteId: 'mt_a', strength: 'soft', reason: 'cn reason', reviewStatus: 'reviewed' },
  ] };
  const bridgeDeps = { dependencies: [] };

  const { nodes, relationships } = buildExport({ upstreamTopics, zhTopics, cnTopics, upstreamDeps, zhDeps, cnDeps, bridgeDeps });

  // mtc_c 是 covered 节点：既不出现在 nodes 里，也让指向它的边被剔除。
  assert.deepEqual(nodes.map(node => node.id).sort(), ['mt_a', 'mt_b']);
  assert.equal(relationships.length, 1);
  const [edge] = relationships;
  assert.equal(edge.from, 'mt_a');
  assert.equal(edge.to, 'mt_b');
  assert.equal(edge.properties.reviewProvenance, 'upstream');
  assert.equal(edge.properties.reviewStatus, 'reviewed');
});
