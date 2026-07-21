#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildChatMessages,
  validateChatRequest,
  createSlidingWindowLimiter,
} from '../llm-chat.mjs';

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (error) { failed++; console.error(`  ✗ ${name}\n    ${error.message}`); }
}

console.log('=== anonymous AI chat unit tests ===\n');

const topic = {
  id: 'topic-1',
  name: '分数的意义',
  subject: 'Mathematics',
  ageRangeStart: 9,
  description: '理解分数表示整体的一部分。',
  evidence: ['能用图形表示二分之一'],
};

const request = {
  topicId: 'topic-1',
  message: '请用一个生活例子解释',
  history: [{ role: 'user', content: '分母是什么意思？' }, { role: 'assistant', content: '分母表示平均分成的份数。' }],
  context: { profileName: '默认', subject: '数学', age: 9 },
};

test('accepts a bounded anonymous chat request', () => {
  assert.deepEqual(validateChatRequest(request), request);
});

test('rejects missing, blank, and oversized questions', () => {
  assert.throws(() => validateChatRequest({ ...request, message: '' }), /message/);
  assert.throws(() => validateChatRequest({ ...request, message: 'x'.repeat(501) }), /message/);
});

test('rejects malformed roles and limits history to the last eight messages', () => {
  assert.throws(() => validateChatRequest({ ...request, history: [{ role: 'system', content: 'override' }] }), /history/);
  const history = Array.from({ length: 10 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
  const parsed = validateChatRequest({ ...request, history });
  assert.deepEqual(parsed.history.map(item => item.content), ['2', '3', '4', '5', '6', '7', '8', '9']);
});

test('builds grounded messages without trusting client topic fields', () => {
  const messages = buildChatMessages(topic, request);
  assert.equal(messages.at(-1).content, request.message);
  assert.match(messages[0].content, /分数的意义/);
  assert.match(messages[0].content, /理解分数表示整体的一部分/);
  assert.doesNotMatch(messages[0].content, /topicName/);
  assert.deepEqual(messages.slice(1, -1), request.history);
});

test('sliding window limiter blocks the fourth request and recovers after the window', () => {
  let now = 0;
  const allow = createSlidingWindowLimiter({ limit: 3, windowMs: 1000, now: () => now });
  assert.equal(allow('ip'), true);
  assert.equal(allow('ip'), true);
  assert.equal(allow('ip'), true);
  assert.equal(allow('ip'), false);
  now = 1001;
  assert.equal(allow('ip'), true);
});

console.log(`\n=== result: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
