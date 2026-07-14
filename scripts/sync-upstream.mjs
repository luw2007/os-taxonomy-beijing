#!/usr/bin/env node
/**
 * sync-upstream.mjs — 检查上游 os-taxonomy 的结构变更，报告同步差异。
 *
 * 本项目复用上游的 mt_ ID、type、subject、domain、ageRange、centrality、
 * dependencies 的 topicId/prerequisiteId/strength。这些结构字段的任何变更
 * 都需要同步到中文数据。
 *
 * 本脚本做三件事：
 *   1. diff：列出上游有、中文还没有的 topic（待翻译）
 *   2. diff：列出中文有、上游已删除/改名的 topic（需清理）
 *   3. evidence 对齐：检查上游 evidence 条数变化（翻译需同步）
 *
 *   node scripts/sync-upstream.mjs [--upstream <path>] [--subject <Subject>]
 *
 * 不修改任何文件——只报告差异，由人工决定如何同步。
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');

let upstreamPath = resolve(ROOT, '..', 'os-taxonomy');
const upIdx = process.argv.indexOf('--upstream');
if (upIdx !== -1 && process.argv[upIdx + 1]) upstreamPath = process.argv[upIdx + 1];

const subjectFilterIdx = process.argv.indexOf('--subject');
const subjectFilter = subjectFilterIdx !== -1 && process.argv[subjectFilterIdx + 1]
  ? process.argv[subjectFilterIdx + 1]
  : null;

const UPSTREAM_DATA = resolve(upstreamPath, 'data');
if (!existsSync(resolve(UPSTREAM_DATA, 'topics.json'))) {
  console.error(`✗ 上游未找到: ${upstreamPath}`);
  console.error(`  克隆 os-taxonomy 后重试: git clone https://github.com/withmarbleapp/os-taxonomy "${upstreamPath}"`);
  process.exit(1);
}

const load = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));

const upstreamTopics = load(UPSTREAM_DATA, 'topics.json');
const topicsZh = load(DATA, 'topics.zh.json');

// --- 构建 lookup ----------------------------------------------------------
const upstreamById = new Map();
for (const t of upstreamTopics.topics) upstreamById.set(t.id, t);

const zhById = new Map();
for (const t of topicsZh.topics) zhById.set(t.id, t);

// --- 1. 上游有、中文没有（待翻译） ----------------------------------------
const pending = [];
for (const [id, t] of upstreamById) {
  if (subjectFilter && t.subject !== subjectFilter) continue;
  if (!zhById.has(id)) {
    pending.push(t);
  }
}

// --- 2. 中文有、上游已删除（需清理） --------------------------------------
const orphaned = [];
for (const [id, t] of zhById) {
  if (!upstreamById.has(id)) orphaned.push(t);
}

// --- 3. evidence 条数变化 -------------------------------------------------
const evidenceDrift = [];
for (const [id, zh] of zhById) {
  const up = upstreamById.get(id);
  if (!up) continue;
  if (zh.evidence.length !== up.evidence.length) {
    evidenceDrift.push({ id, zh: zh.evidence.length, up: up.evidence.length, name: up.name });
  }
}

// --- 报告 -----------------------------------------------------------------
console.log(`上游版本: ${upstreamTopics.version}`);
console.log(`上游总 topic: ${upstreamTopics.topics.length}`);
if (subjectFilter) console.log(`筛选学科: ${subjectFilter}`);
console.log(`中文已翻译: ${topicsZh.topics.length}`);
console.log('');

const pct = upstreamTopics.topics.length > 0
  ? (topicsZh.topics.length / upstreamTopics.topics.length * 100).toFixed(1)
  : '0';
console.log(`翻译覆盖率: ${pct}%`);

console.log(`\n📋 待翻译（${pending.length} 个）:`);
if (subjectFilter) {
  // 按领域分组显示
  const byDomain = {};
  for (const t of pending) (byDomain[t.domain] = byDomain[t.domain] || []).push(t);
  for (const [domain, ts] of Object.entries(byDomain)) {
    console.log(`  ${domain} (${ts.length}):`);
    for (const t of ts.slice(0, 3)) console.log(`    ${t.id}  ${t.name}  [${t.ageRangeStart}-${t.ageRangeEnd}]`);
    if (ts.length > 3) console.log(`    …还有 ${ts.length - 3} 个`);
  }
} else {
  console.log(`  （使用 --subject 过滤特定学科，如 --subject Mathematics）`);
}

if (orphaned.length) {
  console.log(`\n⚠️  中文有但上游已删除（${orphaned.length} 个，需清理）:`);
  for (const t of orphaned.slice(0, 10)) console.log(`  ${t.id}  ${t.name}`);
  if (orphaned.length > 10) console.log(`  …还有 ${orphaned.length - 10} 个`);
}

if (evidenceDrift.length) {
  console.log(`\n⚠️  evidence 条数变化（${evidenceDrift.length} 个，翻译需同步）:`);
  for (const e of evidenceDrift.slice(0, 10)) console.log(`  ${e.id}  中文 ${e.zh} 条 → 上游 ${e.up} 条  (${e.name})`);
}

if (!orphaned.length && !evidenceDrift.length) {
  console.log(`\n✓ 无结构漂移（已翻译的 topic 与上游对齐）`);
}
