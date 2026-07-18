#!/usr/bin/env node
/**
 * dedupe-cn-topics.mjs — 清理 split-compound-topics 残留的完全重复节点。
 *
 * 问题：cn-topics.json 有 393 个节点与另一节点在 subject/domain/stage/
 *   description/evidence 上完全一致（仅 name 不同），是 splitFrom 拆分未清理的残留。
 *   这些重复节点会让 LLM 产生平行边、虚增依赖密度。
 *
 * 处理：
 *   1. 按 (subject, domain, stage, description, evidence) 聚组
 *   2. 每组保留一个（优先无 splitFrom 的、id 较小的），其余删除
 *   3. cn-dependencies.json / cn-bridge-dependencies.json 里引用被删节点的边
 *      重定向到保留节点（dupId → keepId），重定向后产生的重复边合并
 *
 *   node scripts/dedupe-cn-topics.mjs --dry-run  # 预览
 *   node scripts/dedupe-cn-topics.mjs            # 执行
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const dryRun = process.argv.includes('--dry-run');

const cnData = JSON.parse(readFileSync(resolve(DATA, 'cn-topics.json'), 'utf8'));
const cnDeps = JSON.parse(readFileSync(resolve(DATA, 'cn-dependencies.json'), 'utf8'));
const bridge = JSON.parse(readFileSync(resolve(DATA, 'cn-bridge-dependencies.json'), 'utf8'));

// ========== 聚组找重复 ==========
const groups = new Map(); // key → [topics]
for (const t of cnData.topics) {
  const key = JSON.stringify([t.subject, t.domain, t.stage, t.description, t.evidence]);
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(t);
}

const dupGroups = [...groups.values()].filter(g => g.length > 1);
const toDelete = new Set();
const keepMap = {}; // dupId → keepId

for (const g of dupGroups) {
  // 保留优先级：无 splitFrom > 有 splitFrom；同优先级取 id 小的
  const keep = g.sort((a, b) => {
    const sa = a.splitFrom ? 1 : 0;
    const sb = b.splitFrom ? 1 : 0;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  })[0];
  for (const t of g) {
    if (t.id !== keep.id) {
      toDelete.add(t.id);
      keepMap[t.id] = keep.id;
    }
  }
}

// ========== 报告 ==========
console.log('=== 重复节点清理 ===\n');
console.log(`重复组数: ${dupGroups.length}`);
console.log(`待删除节点: ${toDelete.size} (保留每组 1 个)`);
console.log(`清理后主题数: ${cnData.topics.length - toDelete.size}\n`);

// 抽样展示
console.log('--- 抽样（前 10 组）---');
for (const g of dupGroups.slice(0, 10)) {
  const keep = g.find(t => !toDelete.has(t.id));
  const dups = g.filter(t => toDelete.has(t.id));
  console.log(`  保留 ${keep.id}《${keep.name}》  删除 ${dups.map(t => t.id).join(', ')}`);
}

// ========== 重映射依赖边 ==========
function remapDeps(depObj, label) {
  const before = depObj.dependencies.length;
  const seen = new Set();
  const out = [];
  let remapped = 0;
  for (const e of depObj.dependencies) {
    let { topicId, prerequisiteId, strength, reason } = e;
    if (keepMap[topicId]) { topicId = keepMap[topicId]; remapped++; }
    if (keepMap[prerequisiteId]) { prerequisiteId = keepMap[prerequisiteId]; remapped++; }
    if (topicId === prerequisiteId) continue; // 重映射后变自依赖，丢弃
    const key = `${topicId}->${prerequisiteId}`;
    if (seen.has(key)) continue; // 重映射后产生重复，合并
    seen.add(key);
    out.push({ topicId, prerequisiteId, strength, reason });
  }
  console.log(`\n${label}: ${before} → ${out.length} 条 (重映射端点 ${remapped} 次，合并重复 ${before - out.length - (before - out.length - remapped > 0 ? 0 : 0)})`);
  return { ...depObj, edgeCount: out.length, dependencies: out };
}

const newCnDeps = remapDeps(cnDeps, 'cn-dependencies');
const newBridge = remapDeps(bridge, 'cn-bridge-dependencies');

if (dryRun) {
  console.log('\n（--dry-run 模式，未写盘）');
} else {
  // 删除重复节点
  cnData.topics = cnData.topics.filter(t => !toDelete.has(t.id));
  cnData.topicCount = cnData.topics.length;
  writeFileSync(resolve(DATA, 'cn-topics.json'), JSON.stringify(cnData, null, 2) + '\n', 'utf8');
  writeFileSync(resolve(DATA, 'cn-dependencies.json'), JSON.stringify(newCnDeps, null, 2) + '\n', 'utf8');
  writeFileSync(resolve(DATA, 'cn-bridge-dependencies.json'), JSON.stringify(newBridge, null, 2) + '\n', 'utf8');
  console.log('\n✓ 已写 cn-topics.json (删除 ' + toDelete.size + ' 个重复节点)');
  console.log('✓ 已写 cn-dependencies.json');
  console.log('✓ 已写 cn-bridge-dependencies.json');
  console.log('\n下一步: node scripts/checksum.mjs && node scripts/validate.mjs');
}
