#!/usr/bin/env node
/**
 * normalize-cn-domains.mjs — 修复 mtc_ 主题内部 domain 命名不自洽问题。
 *
 * 背景：cn-topics.json 里存在同义 domain 并存（AI vs Artificial Intelligence、
 * Statistics & Probability vs Probability & Statistics 等），导致分桶时
 * 同类节点被拆进不同桶，破坏依赖建图的桶内聚性。
 *
 * 本脚本只改 cn-topics.json 的 subject/domain 分类字段 + 同步清理
 * domains.zh.json 的孤儿 key，不动 name/description/evidence 等内容字段。
 *
 *   node scripts/normalize-cn-domains.mjs --dry-run  # 预览变更清单
 *   node scripts/normalize-cn-domains.mjs            # 执行写盘
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const dryRun = process.argv.includes('--dry-run');

// ========== 归一化映射表 ==========
// key: "subject|oldDomain" → value: "newDomain"
// 只合并确认的同义重复；学段不同或语义不同的不合并。
const DOMAIN_NORMALIZE = {
  // IT 的 AI 缩写 → 全称（与上游 Computing/Artificial Intelligence 对齐）
  'Information Technology|AI': 'Artificial Intelligence',
  // 数学概率统计语序统一（保留与课标一致的 "概率与统计" 命名）
  'Mathematics|Statistics & Probability': 'Probability & Statistics',
  // 通用技术的分册命名合并（分册对依赖建图无意义）
  'General Technology|Technology & Design 1': 'Technology & Design',
  'General Technology|Technology & Design 2': 'Technology & Design',
  // 化学探究类同义合并
  'Chemistry|Chemical Science & Inquiry': 'Chemical Inquiry',
};

// 不合并的决策记录（留作参考，避免后续误操作）：
//   Chemistry|Inorganic Substances  ✗ 不并入 Common Substances（前者全高中、后者初中为主）
//   Information Technology|Information Processing  ✗ 不并入 Data Processing（小学文字处理 vs 数据处理）

const cnData = JSON.parse(readFileSync(resolve(DATA, 'cn-topics.json'), 'utf8'));
const domData = JSON.parse(readFileSync(resolve(DATA, 'domains.zh.json'), 'utf8'));

// ========== 执行归一化 ==========
const changes = []; // { id, subject, from, to }
const bucketBefore = new Map(); // "subject|domain" → count
const bucketAfter = new Map();

for (const t of cnData.topics) {
  const key = `${t.subject}|${t.domain}`;
  bucketBefore.set(key, (bucketBefore.get(key) || 0) + 1);

  const newDomain = DOMAIN_NORMALIZE[key];
  if (newDomain && newDomain !== t.domain) {
    changes.push({ id: t.id, subject: t.subject, from: t.domain, to: newDomain });
    t.domain = newDomain;
  }
  const afterKey = `${t.subject}|${t.domain}`;
  bucketAfter.set(afterKey, (bucketAfter.get(afterKey) || 0) + 1);
}

// ========== 同步清理 domains.zh.json 孤儿 key ==========
// 被合并掉的旧 domain key，其中文翻译迁移到新 key（若新 key 缺翻译）
const domCleanups = []; // { oldKey, newKey, action }
for (const [oldFullKey, newDomain] of Object.entries(DOMAIN_NORMALIZE)) {
  const [subject] = oldFullKey.split('|');
  const oldKey = `${subject} / ${oldFullKey.slice(subject.length + 1)}`;
  const newKey = `${subject} / ${newDomain}`;
  if (domData.domains[oldKey]) {
    if (!domData.domains[newKey]) {
      domData.domains[newKey] = domData.domains[oldKey];
      domCleanups.push({ oldKey, newKey, action: '迁移翻译' });
    } else {
      domCleanups.push({ oldKey, newKey, action: '删除旧key(目标已有翻译)' });
    }
    delete domData.domains[oldKey];
  } else {
    domCleanups.push({ oldKey, newKey, action: '旧key在domains.zh中不存在(无需操作)' });
  }
}

// 补一个漏译：General Technology / Technology & Design 当前值是英文原文
if (domData.domains['General Technology / Technology & Design'] === 'Technology & Design') {
  domData.domains['General Technology / Technology & Design'] = '技术与设计';
  domCleanups.push({
    oldKey: 'General Technology / Technology & Design',
    newKey: '(补译)',
    action: '修复漏译: Technology & Design → 技术与设计',
  });
}

// ========== 报告 ==========
console.log('=== mtc_ domain 归一化 ===\n');

// 按映射项分组统计
const byMapping = new Map(); // "from→to" → [ids]
for (const c of changes) {
  const k = `${c.subject}|${c.from} → ${c.subject}|${c.to}`;
  if (!byMapping.has(k)) byMapping.set(k, []);
  byMapping.get(k).push(c.id);
}

console.log(`受影响节点: ${changes.length} 个 / ${cnData.topics.length} 总主题`);
console.log(`桶数变化: ${bucketBefore.size} → ${bucketAfter.size}\n`);

console.log('--- 归一化明细 ---');
for (const [k, ids] of byMapping) {
  console.log(`  ${k}  (${ids.length} 个节点)`);
  console.log(`    样例: ${ids.slice(0, 3).join(', ')}${ids.length > 3 ? ' ...' : ''}`);
}

console.log('\n--- domains.zh.json 清理 ---');
for (const c of domCleanups) {
  console.log(`  [${c.action}] ${c.oldKey}`);
}

if (dryRun) {
  console.log('\n（--dry-run 模式，未写盘）');
} else {
  // 写盘
  writeFileSync(resolve(DATA, 'cn-topics.json'), JSON.stringify(cnData, null, 2) + '\n', 'utf8');
  writeFileSync(resolve(DATA, 'domains.zh.json'), JSON.stringify(domData, null, 2) + '\n', 'utf8');
  console.log('\n✓ 已写 cn-topics.json');
  console.log('✓ 已写 domains.zh.json');
  console.log('\n下一步: node scripts/checksum.mjs && node scripts/validate.mjs');
}
