#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { renderAssessmentForm, renderAssessmentResult } from '../../viewer/graph-assessment-ui.js';

test('renders a labeled graph assessment form with an escaped topic id', () => {
  const html = renderAssessmentForm('topic-<unsafe>');
  assert.match(html, /class="assessment-form"/);
  assert.match(html, /data-topic-id="topic-&lt;unsafe&gt;"/);
  assert.match(html, /class="assessment-answer"/);
  assert.match(html, /系统语音输入/);
  assert.match(html, /aria-live="polite"/);
});

test('renders escaped formative assessment feedback', () => {
  const html = renderAssessmentResult({
    score: 86,
    summary: '回答 <完整>',
    strengths: ['措施准确'],
    improvements: ['补充 & 作用'],
  });
  assert.match(html, /86/);
  assert.match(html, /回答 &lt;完整&gt;/);
  assert.match(html, /补充 &amp; 作用/);
  assert.match(html, /做得好的地方/);
  assert.match(html, /可以改进/);
});
