#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInspectorRoute, renderTopicInspector } from '../../viewer/topic-inspector.js';

test('closing and traversing the Inspector preserve the shared workspace context', () => {
  const current = {
    id: 'mt_current', tab: 'graph', dim: 'us', subject: 'Mathematics', domain: 'Geometry',
    ageRange: '8-8', q: '分数',
  };
  assert.equal(buildInspectorRoute(null, current), '#/?tab=graph&dim=us&subject=Mathematics&domain=Geometry&ageRange=8-8&q=%E5%88%86%E6%95%B0');
  assert.equal(buildInspectorRoute('mt_next', current), '#/mt_next?tab=graph&dim=us&subject=Mathematics&domain=Geometry&ageRange=8-8&q=%E5%88%86%E6%95%B0');
});

test('shared Inspector safely renders its complete learning and assessment contract', () => {
  const html = renderTopicInspector({
    topic: { id: 'mt_x', name: '<img src=x onerror=alert(1)>', subject: 'Mathematics', domainZh: '几何', ageRangeStart: 8, ageRangeEnd: 9, description: '<script>x</script>', evidence: ['会解释 < >'], assessmentPrompt: '请解释 {{name}}' },
    prerequisites: [{ prerequisiteId: 'mt_pre', prerequisiteTopic: { name: '前置' } }],
    dependents: [{ topicId: 'mt_post', dependentTopic: { name: '后续' } }],
  }, { mastered: false, learnerName: '<小明>' });
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /学习说明/);
  assert.match(html, /掌握证据/);
  assert.match(html, /评估话术/);
  assert.match(html, /data-topic-id="mt_x"/);
  assert.match(html, /data-inspector-topic="mt_pre"/);
  assert.match(html, /data-inspector-topic="mt_post"/);
  assert.match(html, /评分仅供学习参考，不改变掌握状态/);
});
