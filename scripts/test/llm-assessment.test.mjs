#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAssessmentMessages,
  createAssessmentResponder,
  parseAssessmentResponse,
  validateAssessmentRequest,
} from '../llm-assessment.mjs';

const topic = {
  id: 'mtc_427',
  name: '秦的统一',
  description: '了解秦灭六国统一全国的过程，掌握秦始皇巩固统一的措施。',
  evidence: ['能说出秦始皇巩固统一的各项措施', '能说明中央集权制度的特点'],
  assessmentPrompt: '让 {{name}} 说说秦始皇采取了哪些措施巩固统一，这些措施有什么作用。',
};

const validRequest = { topicId: topic.id, answer: '秦统一文字、货币和度量衡，并推行郡县制，有利于政令和经济文化交流。' };

test('validates and trims a bounded assessment request', () => {
  assert.deepEqual(validateAssessmentRequest({ topicId: ` ${topic.id} `, answer: ` ${validRequest.answer} ` }), validRequest);
});

test('rejects malformed topic ids and answers outside 1–500 characters', () => {
  assert.throws(() => validateAssessmentRequest(null), /invalid request/);
  assert.throws(() => validateAssessmentRequest({ ...validRequest, topicId: ' ' }), /topicId/);
  assert.throws(() => validateAssessmentRequest({ ...validRequest, answer: ' ' }), /answer/);
  assert.throws(() => validateAssessmentRequest({ ...validRequest, answer: '秦'.repeat(501) }), /answer/);
});

test('builds server-owned knowledge and grading context', () => {
  const messages = buildAssessmentMessages(topic, validRequest.answer);
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /秦的统一/);
  assert.match(messages[0].content, /掌握证据/);
  assert.match(messages[0].content, /统一六国.*不.*巩固统一措施/);
  assert.match(messages[0].content, /不是教师结论或掌握判定/);
  assert.equal(messages[1].content, validRequest.answer);
});

test('parses a conforming model JSON assessment', () => {
  const result = parseAssessmentResponse(JSON.stringify({
    score: 86,
    summary: '主要措施和作用对应较完整。',
    strengths: ['提到统一文字货币度量衡', '说明了交流作用'],
    improvements: ['可补充郡县制对中央集权的作用'],
  }), topic.id);
  assert.deepEqual(result, {
    score: 86,
    summary: '主要措施和作用对应较完整。',
    strengths: ['提到统一文字货币度量衡', '说明了交流作用'],
    improvements: ['可补充郡县制对中央集权的作用'],
    topicId: topic.id,
  });
});

test('rejects invalid model fields rather than inventing a score', () => {
  const base = { score: 80, summary: '回答基本完整。', strengths: ['准确'], improvements: ['补充作用'] };
  for (const invalid of [
    { ...base, score: 80.5 }, { ...base, score: 101 }, { ...base, summary: '' },
    { ...base, strengths: ['a', 'b', 'c', 'd'] }, { ...base, improvements: [''] },
    { ...base, extra: true },
  ]) assert.throws(() => parseAssessmentResponse(JSON.stringify(invalid), topic.id), /invalid assessment/);
  assert.throws(() => parseAssessmentResponse('not json', topic.id), /invalid assessment/);
});

test('calls deepseek-v4-flash in JSON mode with fixed scoring parameters', async () => {
  let request;
  const responder = createAssessmentResponder({
    apiKey: 'test-key',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"score":90,"summary":"完整。","strengths":["准确"],"improvements":[]}' } }] }) };
    },
  });
  assert.ok(responder);
  assert.deepEqual(await responder(topic, validRequest), { score: 90, summary: '完整。', strengths: ['准确'], improvements: [], topicId: topic.id });
  assert.equal(request.body.model, 'deepseek-v4-flash');
  assert.equal(request.body.temperature, 0);
  assert.equal(request.body.max_tokens, 500);
  assert.deepEqual(request.body.response_format, { type: 'json_object' });
});

test('retries one transient upstream failure', async () => {
  let attempts = 0;
  const responder = createAssessmentResponder({
    apiKey: 'test-key',
    fetchImpl: async () => {
      attempts++;
      if (attempts === 1) return { ok: false, status: 502, text: async () => 'temporary upstream failure' };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"score":90,"summary":"完整。","strengths":["准确"],"improvements":[]}' } }] }) };
    },
  });
  assert.equal((await responder(topic, validRequest)).score, 90);
  assert.equal(attempts, 2);
});

test('does not retry a non-transient upstream failure', async () => {
  let attempts = 0;
  const responder = createAssessmentResponder({
    apiKey: 'test-key',
    fetchImpl: async () => {
      attempts++;
      return { ok: false, status: 400, text: async () => 'invalid request' };
    },
  });
  await assert.rejects(() => responder(topic, validRequest), /AI HTTP 400/);
  assert.equal(attempts, 1);
});

test('disables assessment when no API key is configured', () => {
  assert.equal(createAssessmentResponder({ apiKey: '' }), null);
});
