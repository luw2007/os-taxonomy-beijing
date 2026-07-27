#!/usr/bin/env node
/**
 * checksum.mjs — 重新计算并更新 manifest.json 中的统计、SHA-256 校验和与文件大小。
 *
 *   node scripts/checksum.mjs
 *
 * 每次修改 data/ 下的 JSON 后运行，保持 manifest 统计与校验和准确。
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const MANIFEST = resolve(DATA, 'manifest.json');

const FILES = [
  'topics.zh.json',
  'cn-topics.json',
  'dependencies.zh.json',
  'cn-dependencies.json',
  'cn-bridge-dependencies.json',
  'clusters.zh.json',
  'cn-curriculum-standards.json',
  'domains.zh.json',
  'dimensions.json',
  'terminology.json',
];

// 按 keys 枚举给字段计数；getKey 命中 keys 之外的值（含 undefined，即迁移前尚无该字段）一律计零，不抛错
function tallyBy(items, getKey, keys) {
  const counts = Object.fromEntries(keys.map(key => [key, 0]));
  for (const item of items) {
    const key = getKey(item);
    if (key in counts) counts[key]++;
  }
  return counts;
}

export function deriveManifestCounts({ topicsZh, cnTopics, dependenciesZh, cnDependencies, cnBridgeDependencies, clustersZh, cnStandards }) {
  return {
    topicsZh: topicsZh.topics.length,
    cnTopics: cnTopics.topics.length,
    dependenciesZh: dependenciesZh.dependencies.length,
    clustersZh: clustersZh.clusters.length,
    cnCurricula: cnStandards.curricula.length,
    cnCurriculumEntries: cnStandards.curricula.reduce((sum, curriculum) => sum + curriculum.topics.length, 0),
    cnDeps: cnDependencies.dependencies.length,
    // reviewStatus 缺失（尚未跑迁移）时按 machine 兜底，与 serve.mjs 的 REVIEW_DEFAULT 口径一致
    cnDepsReview: tallyBy(cnDependencies.dependencies, edge => edge.reviewStatus ?? 'machine', ['reviewed', 'machine', 'rejected']),
    cnBridgeReview: tallyBy(cnBridgeDependencies.dependencies, edge => edge.reviewStatus ?? 'machine', ['reviewed', 'machine', 'rejected']),
    // reviewProvenance 由迁移脚本注入；迁移前该字段不存在，三项全零而非报错
    cnDepsProvenance: tallyBy(cnDependencies.dependencies, edge => edge.reviewProvenance, ['rule', 'ai-consensus', 'human']),
  };
}
export function mergeManifestCounts(currentCounts, derivedCounts) {
  return { ...currentCounts, ...derivedCounts };
}

function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  manifest.files = manifest.files || {};

  for (const name of FILES) {
    const bytes = readFileSync(resolve(DATA, name));
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    manifest.files[name] = { bytes: bytes.length, sha256 };
  }

  manifest.counts = mergeManifestCounts(manifest.counts, deriveManifestCounts({
    topicsZh: JSON.parse(readFileSync(resolve(DATA, 'topics.zh.json'), 'utf8')),
    cnTopics: JSON.parse(readFileSync(resolve(DATA, 'cn-topics.json'), 'utf8')),
    dependenciesZh: JSON.parse(readFileSync(resolve(DATA, 'dependencies.zh.json'), 'utf8')),
    cnDependencies: JSON.parse(readFileSync(resolve(DATA, 'cn-dependencies.json'), 'utf8')),
    cnBridgeDependencies: JSON.parse(readFileSync(resolve(DATA, 'cn-bridge-dependencies.json'), 'utf8')),
    clustersZh: JSON.parse(readFileSync(resolve(DATA, 'clusters.zh.json'), 'utf8')),
    cnStandards: JSON.parse(readFileSync(resolve(DATA, 'cn-curriculum-standards.json'), 'utf8')),
  }));

  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

  console.log('✓ manifest.json 统计与校验和已更新:');
  for (const [name, meta] of Object.entries(manifest.files)) {
    console.log(`  ${name}  ${meta.bytes} bytes  ${meta.sha256.slice(0, 16)}…`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
