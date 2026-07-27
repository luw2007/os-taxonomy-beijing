import assert from 'node:assert/strict';
import test from 'node:test';

import { mergeTopics } from '../review-policy.mjs';

test('mergeTopics overlays zh text onto upstream structure', () => {
  const [topic] = mergeTopics({
    upstreamTopics: { topics: [{ id: 'mt_a', name: 'English', description: 'English description', subject: 'Math', domain: 'Number', ageRangeStart: 7 }] },
    zhTopics: { topics: [{ id: 'mt_a', name: '中文', description: '中文描述', cnStandards: ['moe-2022-math:S1.NA.01'], translationStatus: 'machine' }] },
    cnTopics: { topics: [] },
  });

  assert.deepEqual(topic, {
    id: 'mt_a', name: '中文', description: '中文描述', subject: 'Math', domain: 'Number', ageRangeStart: 7,
    cnStandards: ['moe-2022-math:S1.NA.01'], translationStatus: 'machine', translated: true,
  });
});

test('mergeTopics rejects a cn-origin id collision', () => {
  assert.throws(() => mergeTopics({
    upstreamTopics: { topics: [{ id: 'mt_a', name: 'A' }] },
    zhTopics: { topics: [] },
    cnTopics: { topics: [{ id: 'mt_a', name: 'collision' }] },
  }), /collides/);
});
