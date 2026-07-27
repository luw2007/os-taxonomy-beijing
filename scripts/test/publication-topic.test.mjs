import assert from 'node:assert/strict';
import test from 'node:test';

import { PUBLISHED_TOPIC_PROPS, publishedTopic } from '../review-policy.mjs';

const topic = {
  id: 'mtc_1', name: '主题', description: '描述', subject: 'Math', domain: 'Algebra',
  ageRangeStart: 8, ageRangeEnd: 10, type: 'PROCEDURAL', nodeKind: 'skill', centrality: 0.4,
  translationStatus: 'cn-origin', cnStandards: ['std-1'], evidence: ['能完成任务'], assessmentPrompt: '请说明',
  translated: true, subjectZh: '数学', domainZh: '代数',
  splitFrom: 'mtc_parent', coveredBy: ['mtc_child'], status: 'covered', splitPart: true,
  granularity: 'fine', stage: 'primary', origin: 'progression', generationBatchId: 'batch-1',
};

test('publishedTopic exposes UI teaching fields but rejects internal topic bookkeeping', () => {
  assert.deepEqual(publishedTopic(topic), {
    id: 'mtc_1', name: '主题', description: '描述', subject: 'Math', domain: 'Algebra',
    ageRangeStart: 8, ageRangeEnd: 10, type: 'PROCEDURAL', nodeKind: 'skill', centrality: 0.4,
    translationStatus: 'cn-origin', cnStandards: ['std-1'], evidence: ['能完成任务'], assessmentPrompt: '请说明',
    translated: true, subjectZh: '数学', domainZh: '代数',
  });
  for (const field of ['splitFrom', 'coveredBy', 'status', 'splitPart', 'granularity', 'stage', 'origin', 'generationBatchId']) {
    assert.equal(PUBLISHED_TOPIC_PROPS.includes(field), false);
  }
});
