#!/usr/bin/env node
/**
 * validate.mjs — 依赖零的完整性检查。
 *
 * 校验内容：
 *   1. 各文件的声明计数与实际长度一致
 *   2. topics.zh.json 的每个 mt_ ID 都存在于上游 topics.json
 *   3. evidence 数组长度与上游对齐（逐条翻译，不能增减）
 *   4. cnStandards 引用必须能在 cn-curriculum-standards.json 中解析
 *   5. dependencies.zh.json 的每个 topicId/prerequisiteId 存在于上游
 *   6. 课标文件的 codes-only 不变量（textIncluded 必须为 false，无 data 字段）
 *   7. manifest.json 的 SHA-256 校验和
 *
 *   node scripts/validate.mjs [--upstream <path>]
 *     --upstream  上游 os-taxonomy 仓库的路径（默认 ../os-taxonomy）
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');

// --- 解析 --upstream 参数 -------------------------------------------------
let upstreamPath = resolve(ROOT, '..', 'os-taxonomy');
const upIdx = process.argv.indexOf('--upstream');
if (upIdx !== -1 && process.argv[upIdx + 1]) upstreamPath = process.argv[upIdx + 1];

const UPSTREAM_DATA = resolve(upstreamPath, 'data');
const hasUpstream = existsSync(resolve(UPSTREAM_DATA, 'topics.json'));

const load = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
const bytesOf = (dir, name) => readFileSync(resolve(dir, name));

const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

// --- 加载中文数据 ---------------------------------------------------------
const topicsZh = load(DATA, 'topics.zh.json');
const depsZh = load(DATA, 'dependencies.zh.json');
const clustersZh = load(DATA, 'clusters.zh.json');
const cnStandards = load(DATA, 'cn-curriculum-standards.json');
const manifest = load(DATA, 'manifest.json');

// --- 加载上游（如可用） ---------------------------------------------------
let upstreamTopics = null;
let upstreamTopicIds = new Set();
let upstreamEvidenceLens = new Map();
if (hasUpstream) {
  upstreamTopics = load(UPSTREAM_DATA, 'topics.json');
  for (const t of upstreamTopics.topics) {
    upstreamTopicIds.add(t.id);
    upstreamEvidenceLens.set(t.id, t.evidence.length);
  }
}

// --- 1. 声明计数 ----------------------------------------------------------
check(topicsZh.topicCount === topicsZh.topics.length,
  `topics.zh: topicCount ${topicsZh.topicCount} != ${topicsZh.topics.length}`);
check(depsZh.edgeCount === depsZh.dependencies.length,
  `dependencies.zh: edgeCount ${depsZh.edgeCount} != ${depsZh.dependencies.length}`);
check(clustersZh.clusterCount === clustersZh.clusters.length,
  `clusters.zh: clusterCount ${clustersZh.clusterCount} != ${clustersZh.clusters.length}`);
check(cnStandards.curriculumCount === cnStandards.curricula.length,
  `cn-curriculum: curriculumCount != length`);

// --- 2/3. 中文 topic 完整性 -----------------------------------------------
const zhTopicIds = new Set();
for (const t of topicsZh.topics) {
  check(typeof t.id === 'string' && t.id.startsWith('mt_'), `topic id malformed: ${t.id}`);
  check(typeof t.description === 'string' && t.description.length > 0, `topic ${t.id}: empty description`);
  check(Array.isArray(t.evidence) && t.evidence.length > 0, `topic ${t.id}: evidence empty`);
  if (zhTopicIds.has(t.id)) errors.push(`duplicate zh topic id: ${t.id}`);
  zhTopicIds.add(t.id);

  // 上游对齐检查
  if (hasUpstream) {
    check(upstreamTopicIds.has(t.id),
      `topic ${t.id}: not found in upstream topics.json — ID 漂移，请检查同步`);
    const upLen = upstreamEvidenceLens.get(t.id);
    if (upLen !== undefined) {
      check(t.evidence.length === upLen,
        `topic ${t.id}: evidence length ${t.evidence.length} != upstream ${upLen}（逐条翻译，数量必须一致）`);
    }
  }
}

// --- 4. cnStandards 引用完整性 --------------------------------------------
const cnStandardKeys = new Set();
for (const c of cnStandards.curricula) {
  check(c.textIncluded === false,
    `curriculum ${c.slug}: textIncluded must be false（codes-only 不变量）`);
  check(c.topicCount === c.topics.length,
    `curriculum ${c.slug}: topicCount != length`);
  check(cnStandards.codesOnlySources.includes(c.slug),
    `curriculum ${c.slug}: missing from codesOnlySources`);
  for (const s of c.topics) {
    check(s.key === `${c.slug}:${s.code}`, `standard key mismatch: ${s.key}`);
    check(!('data' in s),
      `codes-only source ${c.slug} leaks verbatim text at ${s.key}（禁止收录课标原文）`);
    if (cnStandardKeys.has(s.key)) errors.push(`duplicate cn standard key: ${s.key}`);
    cnStandardKeys.add(s.key);
  }
}

let danglingCnRefs = 0;
for (const t of topicsZh.topics) {
  for (const key of (t.cnStandards ?? [])) {
    if (!cnStandardKeys.has(key)) {
      danglingCnRefs++;
      if (danglingCnRefs <= 5) errors.push(`topic ${t.id} references unknown cnStandard ${key}`);
    }
  }
}
if (danglingCnRefs > 5) errors.push(`…and ${danglingCnRefs - 5} more unknown cnStandard references`);

// --- 5. 依赖引用完整性 ----------------------------------------------------
for (const d of depsZh.dependencies) {
  check(d.topicId !== d.prerequisiteId, `self-dependency on ${d.topicId}`);
  check(d.strength === 'hard' || d.strength === 'soft', `bad strength ${d.strength}`);
  if (hasUpstream) {
    check(upstreamTopicIds.has(d.topicId),
      `dependency references unknown upstream topicId ${d.topicId}`);
    check(upstreamTopicIds.has(d.prerequisiteId),
      `dependency references unknown upstream prerequisiteId ${d.prerequisiteId}`);
  }
}

// --- 6. 上游版本一致性 ----------------------------------------------------
if (hasUpstream) {
  const upstreamVersion = upstreamTopics.version;
  check(topicsZh.upstreamVersion === upstreamVersion,
    `upstreamVersion mismatch: zh says "${topicsZh.upstreamVersion}", upstream is "${upstreamVersion}"`);
  check(depsZh.upstreamVersion === upstreamVersion,
    `dependencies.zh upstreamVersion != upstream (${depsZh.upstreamVersion} vs ${upstreamVersion})`);
}

// --- 7. manifest 校验和 ---------------------------------------------------
for (const [name, meta] of Object.entries(manifest.files ?? {})) {
  const bytes = bytesOf(DATA, name);
  const actual = createHash('sha256').update(bytes).digest('hex');
  // manifest 中的 bytes/sha256 可能为空（首次未生成），跳过空值
  if (meta.sha256) {
    check(actual === meta.sha256, `checksum mismatch for ${name}`);
  }
  if (meta.bytes) {
    check(bytes.length === meta.bytes, `byte size mismatch for ${name}: ${bytes.length} != ${meta.bytes}`);
  }
}

// --- 报告 -----------------------------------------------------------------
if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
const upstreamNote = hasUpstream ? ' + upstream alignment OK' : ' (上游未找到，跳过对齐检查)';
console.log(
  `✓ valid — ${topicsZh.topics.length} zh topics, ${depsZh.dependencies.length} zh deps, ` +
  `${clustersZh.clusters.length} zh clusters, ${cnStandardKeys.size} cn standards${upstreamNote}.`,
);
if (!hasUpstream) {
  console.log(`  💡 上游路径: ${upstreamPath} 不存在。克隆 os-taxonomy 到此路径以启用对齐检查。`);
}
