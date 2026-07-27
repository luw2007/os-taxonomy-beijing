// docs-stats.test.mjs — 断言 README / BACKLOG 里的对外数字与仓库实际数据一致。
// 直接读 data/*.json 计算真值（不依赖 manifest.json 是否已跑过 checksum，也不依赖
// review-provenance 迁移是否已执行），防止文档手工同步再次漂移（v1.2 已经翻车过一次）。

import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readData = (name) => JSON.parse(readFileSync(resolve(ROOT, 'data', name), 'utf8'));
const readDoc = (name) => readFileSync(resolve(ROOT, name), 'utf8');

const topicsZh = readData('topics.zh.json');
const cnTopics = readData('cn-topics.json');
const dependenciesZh = readData('dependencies.zh.json');
const cnDependencies = readData('cn-dependencies.json');
const cnBridgeDependencies = readData('cn-bridge-dependencies.json');
const manifest = readData('manifest.json');
const readme = readDoc('README.md');
const backlog = readDoc('BACKLOG.md');

const fmt = (n) => n.toLocaleString('en-US');

function tally(items, getKey, fallback) {
  const counts = {};
  for (const item of items) {
    const key = getKey(item) ?? fallback;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

const depsReview = tally(cnDependencies.dependencies, (e) => e.reviewStatus, 'machine');
const bridgeReview = tally(cnBridgeDependencies.dependencies, (e) => e.reviewStatus);
const translationStatus = tally(topicsZh.topics, (t) => t.translationStatus);
const origin = tally(cnTopics.topics, (t) => t.origin);
const textbookTextCount = cnTopics.topics.filter((t) => t.origin === 'textbook' && t.nodeKind === 'text').length;

// README 状态行是一段以 "> **状态：**" 开头、后续行都以 "> " 续行的块
function readmeStatusBlock() {
  const lines = readme.split('\n');
  const startIndex = lines.findIndex((line) => line.startsWith('> **状态：**'));
  assert.ok(startIndex >= 0, 'README 缺少状态行');
  const block = [];
  for (let i = startIndex; i < lines.length && (lines[i].startsWith('>') || lines[i] === ''); i++) {
    if (lines[i] === '' && block.length > 0) break;
    block.push(lines[i]);
  }
  return block.join(' ');
}

test('README 状态行的核心计数与 data/*.json 实测一致', () => {
  const block = readmeStatusBlock();
  assert.ok(block.includes(`已翻译微主题 ${fmt(topicsZh.topics.length)} / ${fmt(topicsZh.topics.length)}`));
  assert.ok(block.includes(`中国特有微主题 ${fmt(cnTopics.topics.length)}`));
  assert.ok(block.includes(`上游依赖 ${fmt(dependenciesZh.dependencies.length)}`));
  assert.ok(block.includes(`中国特有依赖 ${fmt(cnDependencies.dependencies.length)}`));
});

test('README 状态行的内部边审核数字（reviewed/machine/rejected）与 cn-dependencies.json 实测一致', () => {
  const block = readmeStatusBlock();
  assert.ok(block.includes(`reviewed ${fmt(depsReview.reviewed ?? 0)}`), 'reviewed 数字不匹配');
  assert.ok(block.includes(`machine ${fmt(depsReview.machine ?? 0)}`), 'machine 数字不匹配');
  assert.ok(block.includes(`rejected ${fmt(depsReview.rejected ?? 0)}`), 'rejected 数字不匹配');
});

test('README 状态行的审核覆盖率百分比与实测一致', () => {
  const block = readmeStatusBlock();
  const total = (depsReview.reviewed ?? 0) + (depsReview.machine ?? 0) + (depsReview.rejected ?? 0);
  const expectedPct = Number((((depsReview.reviewed ?? 0) / total) * 100).toFixed(1));
  const stated = block.match(/（([\d.]+)%）/);
  assert.ok(stated, 'README 状态行缺少覆盖率百分比');
  assert.equal(Number(stated[1]), expectedPct);
});

test('README alpha 声明的机器翻译数字与 topics.zh.json 实测一致', () => {
  assert.ok(
    readme.includes(`${fmt(translationStatus.machine ?? 0)} / ${fmt(topicsZh.topics.length)} 条`),
    'README alpha 声明的机翻数字与 translationStatus 实测不一致'
  );
  assert.ok(readme.includes(`仅 ${fmt(translationStatus.reviewed ?? 0)} 条经人工校对`));
});

test('README alpha 声明的未审核 machine 边数字与 cn-dependencies.json 实测一致', () => {
  assert.ok(readme.includes(`中国特有依赖中 ${fmt(depsReview.machine ?? 0)} 条`));
});

test('README 教材来源节点数字与 cn-topics.json 实测一致', () => {
  assert.ok(
    readme.includes(`${fmt(origin.textbook ?? 0)} 个教材来源节点，含 ${fmt(textbookTextCount)} 个具体阅读文本节点`),
    'README 教材来源元数据行的数字与 origin=textbook / nodeKind=text 实测不一致'
  );
});

test('README Roadmap 的 cn-deps / bridge 审核数字与实测一致', () => {
  assert.ok(readme.includes(`reviewed ${fmt(depsReview.reviewed ?? 0)} / machine ${fmt(depsReview.machine ?? 0)} / rejected ${fmt(depsReview.rejected ?? 0)}`));
  assert.ok(readme.includes(`reviewed ${fmt(bridgeReview.reviewed ?? 0)} / rejected ${fmt(bridgeReview.rejected ?? 0)}`));
});

test('BACKLOG.md 的 alignedMathLowExcluded 与 manifest.json 一致（该口径来自人工对齐工作，无法从原始数组重算）', () => {
  const { alignedMathHigh, alignedMathMedium, alignedMathLowExcluded, alignedMathTotal } = manifest.counts;
  assert.ok(backlog.includes(`${alignedMathLowExcluded} 条 low 置信度数学节点未对齐`));
  assert.ok(backlog.includes(`alignedMathLowExcluded: ${alignedMathLowExcluded}`));
  assert.ok(
    backlog.includes(`${alignedMathTotal} 个小学数学节点中 ${alignedMathHigh + alignedMathMedium} 条已对齐`)
  );
});

// PROVENANCE.md / NOTICE 位于许可边界表内，是合规文本——数字漂移比 README 更严重
const provenance = readDoc('PROVENANCE.md');
const notice = readDoc('NOTICE');

test('PROVENANCE.md 的教材来源节点数字与 cn-topics.json 实测一致', () => {
  assert.ok(provenance.includes(`${fmt(origin.textbook)} 条 \`origin: textbook\``));
  assert.ok(provenance.includes(`${fmt(origin.textbook)} 条教材来源节点中有 ${fmt(textbookTextCount)} 条 \`nodeKind: text\``));
});

test('NOTICE 的阅读文本记录数与 cn-topics.json 实测一致', () => {
  assert.ok(notice.includes(`including ${fmt(textbookTextCount)} records`));
});
