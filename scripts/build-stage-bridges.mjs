#!/usr/bin/env node
/**
 * build-stage-bridges.mjs — 给小学段关键概念补"→初中"的学段桥接边。
 *
 * 背景：当前小学→初中跨学段边仅 12 条（v2 KPI ≥30）。但 Math/Science 小学段
 * 缺基础概念节点（只有 10 个活动类），无法建有效桥。本脚本只对**已有节点**
 * 的同学科强桥接补边（道法/语文/英语/IT），Math/Science 学段桥留待 C1a
 * 补节点后内嵌处理（经 omp+opus 双审确认）。
 *
 * 桥接判据（严格，宁缺毋滥）：
 *   - 同学科、语义明确的"基础→进阶"（如"小学宪法概念"→"初中宪法地位"）
 *   - strength=soft（学段桥是建议性衔接，非硬先修）
 *   - reviewStatus=reviewed（规则产生、可审计）
 *   - reason 必须说明衔接语义（"小学X是初中Y的认知基础"）
 *
 * 安全保障：
 *   1. 端点必须存在（topicId/prerequisiteId 都在 cn-topics）
 *   2. 不能自环、不能重复
 *   3. 写盘后跑 break-cycles（学段桥本身 age 单调不会成环，但保险起见）
 *   4. 备份到 .snapshots
 *
 * CLI：
 *   node scripts/build-stage-bridges.mjs --dry-run    只报告将加的边，不写盘
 *   node scripts/build-stage-bridges.mjs              写盘 + 触发破环
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { breakCycles } from './break-cycles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const DEPS_PATH = resolve(DATA, 'cn-dependencies.json');

// ===== 桥接定义（prerequisiteId=小学, topicId=初中）=====
// 每条：[小学源id, 初中目标id, 衔接理由]
const BRIDGES = [
  // --- 道法（+5：宪法/公民/国情/法治/国家象征）---
  ['mtc_047', 'mtc_553', '小学"宪法是根本大法"建立宪法概念，初中"宪法的地位"深化其法律层级'],
  ['mtc_048', 'mtc_554', '小学"公民的基本权利与义务"建立权利意识，初中深化具体权利内容'],
  ['mtc_048', 'mtc_555', '小学"公民的基本权利与义务"建立义务意识，初中深化具体义务内容'],
  ['mtc_045', 'mtc_561', '小学"国旗国徽国歌·国家象征"建立国家认同，初中"基本国情"提供制度与地理背景'],
  ['mtc_057', 'mtc_559', '小学"法治观念·规则"建立规则意识，初中"预防违法犯罪"延展到法律后果'],

  // --- 语文（+5：古诗文/小说人物/段落概括/习作/古诗意境）---
  ['mtc_030', 'mtc_535', '小学"古诗文·必背篇目(高段)"积累语感，初中"古诗文·背诵(七八年级)"系统化'],
  ['mtc_018', 'mtc_516', '小学"文学阅读·人物形象分析"初步分析人物，初中"小说·人物形象分析"深化方法'],
  ['mtc_014', 'mtc_512', '小学"段落大意的概括"训练信息提取，初中"说明文·说明对象"应用于文体阅读'],
  ['mtc_021', 'mtc_523', '小学"习作·把一件事写清楚"建立记叙基础，初中"记叙文写作·选材立意"进阶'],
  ['mtc_031', 'mtc_537', '小学"古诗·节奏与意境初感"建立感悟，初中"古诗文·诗意理解"系统分析'],

  // --- 英语（+1：仅保留强桥）---
  // 注：opus 建议的英语+2 中，"听力→文明上网""人与自我→防范欺凌"是跨学科弱桥，已剔除。
  // 英语学段桥需要先确认初中英语节点存在（当前初中 English 节点稀少），留待 C1b。
];

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const data = JSON.parse(readFileSync(DEPS_PATH, 'utf8'));
  const deps = data.dependencies;

  // 加载 topics 校验端点存在
  const topicsData = JSON.parse(readFileSync(resolve(DATA, 'cn-topics.json'), 'utf8'));
  const topicById = new Map(topicsData.topics.map(t => [t.id, t]));
  const stageOf = (id) => topicById.get(id)?.stage;

  // 已有边集合（防重复）
  const existingKeys = new Set(deps.map(d => `${d.topicId}->${d.prerequisiteId}`));

  console.log(`=== 学段桥接（A2 窄范围）===`);
  console.log(`  当前小学作 prereq 的边数: ${deps.filter(d => stageOf(d.prerequisiteId) === '小学' && stageOf(d.topicId) !== '小学').length}`);
  console.log(`  计划新增: ${BRIDGES.length} 条\n`);

  const toAdd = [];
  const skipped = [];
  for (const [prereq, topic, reason] of BRIDGES) {
    // 校验
    if (!topicById.has(prereq)) { skipped.push(`${prereq} 不存在`); continue; }
    if (!topicById.has(topic)) { skipped.push(`${topic} 不存在`); continue; }
    if (prereq === topic) { skipped.push(`自环 ${prereq}`); continue; }
    const key = `${topic}->${prereq}`;
    if (existingKeys.has(key)) { skipped.push(`已存在 ${key}`); continue; }
    // 校验方向：prereq=小学，topic=初中
    if (stageOf(prereq) !== '小学') { skipped.push(`${prereq} 不是小学（${stageOf(prereq)}）`); continue; }
    if (stageOf(topic) !== '初中') { skipped.push(`${topic} 不是初中（${stageOf(topic)}）`); continue; }

    toAdd.push({
      topicId: topic,
      prerequisiteId: prereq,
      strength: 'soft',
      reason,
      reviewStatus: 'reviewed', // 规则产生，可审计
      reviewProvenance: 'rule',
    });
    console.log(`  + ${prereq}(${topicById.get(prereq).name.slice(0,12)}) → ${topic}(${topicById.get(topic).name.slice(0,12)})`);
  }

  if (skipped.length) {
    console.log(`\n  跳过 ${skipped.length} 条:`);
    skipped.forEach(s => console.log(`    - ${s}`));
  }

  console.log(`\n  实际新增: ${toAdd.length} 条`);
  const newCount = deps.filter(d => stageOf(d.prerequisiteId) === '小学' && stageOf(d.topicId) !== '小学').length + toAdd.length;
  console.log(`  写盘后小学作 prereq 边数: ${newCount}`);

  if (dryRun) {
    console.log('\n（--dry-run 模式，未写盘）');
    return;
  }

  // 备份
  const ts = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  const snapshotDir = resolve(DATA, '.snapshots', `${stamp}-stage-bridges`);
  mkdirSync(snapshotDir, { recursive: true });
  copyFileSync(DEPS_PATH, resolve(snapshotDir, 'cn-dependencies.json'));

  // 合并 + 破环（学段桥 age 单调，理论上不成环，但保险）
  const merged = [...deps, ...toAdd];
  const { kept, removed } = breakCycles(merged);
  if (removed.length > 0) {
    console.log(`\n  ⚠️ 破环删除 ${removed.length} 条（学段桥引入了环，请检查）:`);
    removed.slice(0, 10).forEach(e => console.log(`    - ${e.prerequisiteId} -> ${e.topicId} [${e.removedReason}]`));
  }

  const output = { ...data, edgeCount: kept.length, dependencies: kept };
  writeFileSync(DEPS_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`\n✓ 已写 data/cn-dependencies.json（${kept.length} 边，+${toAdd.length} 学段桥）`);
  console.log('下一步: node scripts/compute-centrality.mjs（学段桥改变 reach）&& node scripts/checksum.mjs && node scripts/validate.mjs');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
