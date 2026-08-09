import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const load = name => JSON.parse(readFileSync(new URL(`../../data/${name}`, import.meta.url), 'utf8'));

test('mtc_450 remains the single中华人民共和国成立 topic across source data', () => {
  const topics = load('cn-topics.json').topics;
  const topic = topics.find(({ id }) => id === 'mtc_450');
  const dependencies = load('cn-dependencies.json').dependencies;

  assert.equal(topic?.name, '中华人民共和国成立');
  assert.equal(topics.filter(({ name }) => name === '中华人民共和国成立').length, 1);
  assert.equal(dependencies.find(({ topicId, prerequisiteId }) => topicId === 'mtc_450' && prerequisiteId === 'mtc_1106')?.reason,
    'Contemporary Chinese History 渐进：香港 → 中华人民共和国成立');
  assert.equal(dependencies.find(({ topicId, prerequisiteId }) => topicId === 'mtc_451' && prerequisiteId === 'mtc_450')?.reason,
    'Contemporary Chinese History 渐进：中华人民共和国成立 → 社会主义制度的建立');
});
