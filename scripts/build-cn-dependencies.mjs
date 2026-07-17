#!/usr/bin/env node
/**
 * build-cn-dependencies.mjs — 为 mtc_ 中国特有主题自动建立知识依赖 DAG。
 *
 * 三层建图规则（全部自动，无需人工标注）：
 *   1. 学段内同 domain 的 ageRange 链（soft）：相邻 age 建渐进边
 *   2. 跨学段同 domain 的进阶边（hard）：小学→初中→高中衔接
 *   3. 跨 domain 的先修关系（hard）：每个学科定义 domain 先修链
 *
 * 输出 data/cn-dependencies.json（遵循 AGENTS.md 的 cn- 前缀规范）。
 *   node scripts/build-cn-dependencies.mjs            # 执行（写盘）
 *   node scripts/build-cn-dependencies.mjs --dry-run  # 预览
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const dryRun = process.argv.includes('--dry-run');

const data = JSON.parse(readFileSync(resolve(DATA, 'cn-topics.json'), 'utf8'));
const topics = data.topics;

// ========== 学段判定 ==========
function getStage(ageStart) {
  if (ageStart <= 8) return 'primary';   // 小学低段 1-2
  if (ageStart <= 10) return 'primary-mid'; // 小学中段 3-4
  if (ageStart <= 12) return 'primary-hi';  // 小学高段 5-6
  if (ageStart <= 15) return 'junior';   // 初中
  return 'senior';                       // 高中
}

// ========== 第 3 层：跨 domain 先修链（每个学科定义）==========
const DOMAIN_PREREQ_CHAINS = {
  'Mathematics': [
    ['Number & Algebra', 'Equations & Inequalities'],
    ['Equations & Inequalities', 'Functions'],
    ['Functions', 'Mathematical Modeling'],
    ['Geometry & Shapes', 'Geometry & Algebra'],
    ['Number & Algebra', 'Probability & Statistics'],
    ['Preliminaries', 'Functions'],
  ],
  'Physics': [
    ['Kinematics', 'Dynamics'],
    ['Dynamics', 'Energy'],
    ['Heat & Thermodynamics', 'Energy'],
    ['Sound & Light', 'Electricity & Magnetism'],
    ['Mechanics', 'Curvilinear Motion & Gravitation'],
    ['Motion & Interaction', 'Energy'],
  ],
  'Chemistry': [
    ['Common Substances', 'Chemical Formulas & Calculations'],
    ['Chemical Formulas & Calculations', 'Chemical Changes'],
    ['Common Substances', 'Solutions'],
    ['Properties & Applications', 'Chemical Changes'],
    ['Composition & Structure', 'Structure & Reactions'],
  ],
  'Biology': [
    ['Cell Biology', 'Botany'],
    ['Cell Biology', 'Human Physiology'],
    ['Cell Biology', 'Heredity & Evolution'],
    ['Botany', 'Ecology'],
    ['Human Physiology', 'Ecology'],
    ['Microbiology', 'Ecology'],
    ['Biological Structure', 'Cell Biology'],
  ],
  'History': [
    ['Ancient Chinese History', 'Modern Chinese History'],
    ['Modern Chinese History', 'Contemporary Chinese History'],
    ['Ancient World History', 'Modern World History'],
    ['Chinese History', 'Modern Chinese History'],
  ],
  'Chinese': [
    ['Literacy & Handwriting', 'Reading & Appreciation'],
    ['Reading & Appreciation', 'Literary Reading'],
    ['Classical Chinese', 'Reading & Appreciation'],
    ['Classical Poetry', 'Classical Chinese'],
    ['Reading Materials', 'Literary Reading'],
    ['Expression & Communication', 'Writing'],
    ['Language Fundamentals', 'Writing'],
  ],
  'English': [
    ['Phonetics', 'Vocabulary'],
    ['Vocabulary', 'Grammar'],
    ['Grammar', 'Language Skills'],
    ['Language Skills', 'Integrated Language Use'],
    ['Language Knowledge', 'Integrated Language Use'],
  ],
  'Information Technology': [
    ['Data', 'Data Processing'],
    ['Data Processing', 'Data & Computing'],
    ['Algorithm', 'Data & Computing'],
    ['Internet & Innovation', 'Information Systems & Society'],
    ['Internet of Things', 'Artificial Intelligence'],
    ['AI', 'Artificial Intelligence'],
  ],
  'Geography': [
    ['Earth & Maps', 'World Geography'],
    ['Earth & Maps', 'Geography of China'],
    ['World Geography', 'Physical Geography'],
    ['Geography of China', 'Human Geography'],
    ['Physical Geography', 'Human Geography'],
  ],
  'Moral & Rule of Law': [
    ['Myself', 'Others & Community'],
    ['Others & Community', 'Society'],
    ['My Country', 'National Conditions'],
    ['Rule of Law', 'Traditional Culture'],
    ['Safety Education', 'Digital Citizenship'],
  ],
  'Politics': [
    ['Socialism with Chinese Characteristics', 'Economy & Society'],
    ['Economy & Society', 'Politics & Rule of Law'],
    ['Politics & Rule of Law', 'Philosophy & Culture'],
    ['International Relations', 'Philosophy & Culture'],
  ],
  'General Technology': [
    ['Design Process', 'Structure & Design'],
    ['Design Process', 'Process & Design'],
    ['Design Process', 'System & Design'],
    ['Design Process', 'Control & Design'],
    ['Electronic Technology', 'Robotics & AI'],
    ['Structure & Design', 'Technology & Design 1'],
  ],
  'Science': [
    ['Human & Environment', 'Chinese Ecosystems'],
    ['Technology & Engineering', 'Human & Environment'],
  ],
  'PE & Health': [
    ['Fundamental Movement', 'Sport Skills'],
    ['Physical Fitness', 'Sport Skills'],
    ['Health Education', 'Cross-disciplinary'],
  ],
  'Art': [
    ['Appreciation', 'Performance'],
    ['Performance', 'Creation'],
    ['Appreciation', 'Connection & Integration'],
  ],
};

// ========== 建图 ==========
const deps = new Map(); // key: "topicId->prerequisiteId" → dep object

function addDep(topicId, prerequisiteId, strength, reason) {
  if (topicId === prerequisiteId) return;
  const key = `${topicId}->${prerequisiteId}`;
  if (deps.has(key)) return; // 去重
  deps.set(key, { topicId, prerequisiteId, strength, reason });
}

// 按 subject+domain 分组
const groups = new Map(); // "subject|domain" → [topics sorted by ageRangeStart]
for (const t of topics) {
  const key = `${t.subject}|${t.domain}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(t);
}
for (const arr of groups.values()) {
  arr.sort((a, b) => (a.ageRangeStart || 0) - (b.ageRangeStart || 0));
}

let layer1 = 0, layer2 = 0, layer3 = 0;

// --- 第 1 层 + 第 2 层：同 domain 内的 ageRange 链 ---
for (const [key, arr] of groups) {
  if (arr.length < 2) continue;
  const [subject, domain] = key.split('|');

  for (let i = 1; i < arr.length; i++) {
    const prev = arr[i - 1];
    const curr = arr[i];
    const prevStage = getStage(prev.ageRangeStart);
    const currStage = getStage(curr.ageRangeStart);

    if (prevStage === currStage) {
      // 同学段：soft 渐进边
      addDep(curr.id, prev.id, 'soft',
        `${domain}的知识递进：${prev.name} → ${curr.name}`);
      layer1++;
    } else {
      // 跨学段：hard 进阶边
      addDep(curr.id, prev.id, 'hard',
        `从${stageLabel(prevStage)}进阶到${stageLabel(currStage)}：${prev.name} → ${curr.name}`);
      layer2++;
    }
  }
}

// --- 第 3 层：跨 domain 先修链 ---
for (const [subject, chains] of Object.entries(DOMAIN_PREREQ_CHAINS)) {
  for (const [fromDomain, toDomain] of chains) {
    const fromTopics = groups.get(`${subject}|${fromDomain}`);
    const toTopics = groups.get(`${subject}|${toDomain}`);
    if (!fromTopics || !toTopics) continue;

    // 找 from 中 ageRangeEnd 最小的（最基础的）和 to 中 ageRangeStart 最接近的
    const fromBase = fromTopics[0]; // 已按 age 排序，第一条最基础
    // 在 to 中找 ageRangeStart >= fromBase.ageRangeEnd 的第一条
    const toTarget = toTopics.find(t => t.ageRangeStart >= (fromBase.ageRangeEnd || 0))
      || toTopics[0];

    if (fromBase && toTarget && fromBase.id !== toTarget.id) {
      addDep(toTarget.id, fromBase.id, 'hard',
        `${fromDomain} 是 ${toDomain} 的先修：${fromBase.name} → ${toTarget.name}`);
      layer3++;
    }
  }
}

function stageLabel(stage) {
  return { primary: '小学低段', 'primary-mid': '小学中段', 'primary-hi': '小学高段',
    junior: '初中', senior: '高中' }[stage] || stage;
}

// ========== 输出 ==========
const depArray = [...deps.values()];
const output = {
  version: '1.0.0-zh.0',
  upstreamVersion: 'v1',
  locale: 'zh-CN',
  edgeCount: depArray.length,
  note: '中国特有微主题（mtc_）的内部知识依赖 DAG。规则驱动自动生成：第1层=学段内同domain渐进(soft)；第2层=跨学段同domain进阶(hard)；第3层=跨domain先修(hard)。',
  dependencies: depArray,
};

console.log('=== cn-dependencies 建图结果 ===');
console.log(`  第1层（学段内渐进 soft）: ${layer1} 条`);
console.log(`  第2层（跨学段进阶 hard）: ${layer2} 条`);
console.log(`  第3层（跨domain先修 hard）: ${layer3} 条`);
console.log(`  合计: ${depArray.length} 条依赖边`);

// 密度对比
console.log(`\n密度: ${depArray.length} 边 / ${topics.length} 主题 = ${(depArray.length/topics.length).toFixed(2)} 边/主题`);
console.log(`上游对比: 3221 边 / 1590 主题 = ${(3221/1590).toFixed(2)} 边/主题`);

if (dryRun) {
  console.log('\n=== 前 20 条依赖预览 ===');
  for (const d of depArray.slice(0, 20)) {
    console.log(`  ${d.prerequisiteId} → ${d.topicId}  [${d.strength}]  ${d.reason}`);
  }
  console.log('\n（--dry-run 模式，未写盘）');
} else {
  writeFileSync(resolve(DATA, 'cn-dependencies.json'), JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log('\n✓ 已写入 data/cn-dependencies.json');
}
