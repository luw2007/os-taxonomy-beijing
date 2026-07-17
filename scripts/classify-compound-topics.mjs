#!/usr/bin/env node
/**
 * classify-compound-topics.mjs — 分析含「和/与」的复合微主题，自动做 A/B/C 分类。
 *
 * A=应拆分（两个独立渐进微技能）
 * B=不拆（单一概念/对比辨析/固定术语）
 * C=剔除（课文标题，非微技能）
 *
 *   node scripts/classify-compound-topics.mjs [--subject <Subject>] [--type A|B|C]
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(resolve(ROOT, 'data', 'cn-topics.json'), 'utf8'));
const hits = data.topics.filter(t => /[和与]/.test(t.name));

// --- C 类：课文标题（非微技能）---
// 特征：textbook origin + 语文 + name 像篇名（带书名号/作者/或特征词）
const C_PATTERNS = [
  /《.+》/,           // 含书名号
  /\/[（(]?[^\d]/,    // 带作者标注（如 /史铁生）
  /^说和做$/,
  /^阿长与《/,
  /^最苦与最乐$/,
  /^敬业与乐业$/,
  /^怀疑与学问$/,
  /^与朱元思书$/,
  /^国行公祭/,
  /^\*? ?读书[：:]/,
  /^我与地坛/,
  /^\*? ?老人与海/,
  /^记念刘和珍君/,
  /^孙权劝学/,
  /^愚公移山/,
];

// --- B 类：不拆（单一概念/对比辨析/固定术语）---
// 特征：和/与连接的是不可分割的概念
const B_PATTERNS = [
  // 辨析类（动作就是"区分/辨析/比较"本身）
  /区分.{0,6}[与和]/,
  /辨析.{0,6}[与和]/,
  /比较.{0,6}[与和]/,
  /辨.{0,4}[与和].{0,4}析/,
  // 对比/选择/关系（单一认知技能）
  /选择.{0,6}[与和].{0,6}解读/,
  /的关系$/,
  // 统一术语
  /权利与义务/,
  /民族团结/,
  /充分条件与必要条件/,
  /串联与并联/,
  /晶体与非晶体/,
  /误差与错误/,
  /物理变化与化学变化/,
  /有氧呼吸与无氧呼吸/,  // 对比认知
  /尊重与理解/,
  /规则与(团队|责任)/,
  /优点与不足/,
  /自理与自律/,
  /节奏与意境/,
  /聆听与感受/,
  /事实与观点/,
  /讨论与发表/,
  /讨论与辩论/,
  /输入与排版/,
  /备份与保护/,
  /步骤与顺序/,
  /互联网与在线/,
  /搜索与获取/,
  /密码与个人信息/,
  /文明上网与数字身份/,
  /扫地擦桌/,
  /物品归位/,
  /声音的产生与传播/,  // 单一物理概念
  /转化与守恒/,
  /测量.{0,4}与.{0,4}比较/,
  /概念与描述$/,
  /概念与特征$/,
  /特征与判断$/,
  /概念与同角/,
  /内能与热量/,
  /腐蚀与防护$/,
  /基因表达与性状/,
  /自然选择与适应/,
  /基因组成的变化与物种/,
  /协同进化与生物多样性/,
  /激素与内分泌/,
  /体液调节与神经调节/,
  /神经冲动的产生和传导/,
  /环境因素参与调节/,
  /蛋白质工程/,
  /和平外交/,
  /和平与发展$/,
  /国体与政体/,
  /侵权责任与权利/,
  /学会归纳与类比/,
  /模拟信号和数字信号/,
  /科学[、，]技术与工程/,
  /计算机建模与仿真/,
  /传感器的原理和种类/,
  /概念和功能$/,
  /设计方法$/,
  /快速成型与测试/,
  /决策与评价/,
  /工程设计过程和要素/,
  /功能与分类$/,
  /控制与实现$/,
  /传感网络与组网/,
  /三维扫描与打印/,
  /组合模型设计与切片/,
  /电动窗帘与智能窗帘/,
];

// --- 分类 ---
const classified = { A: [], B: [], C: [] };

for (const t of hits) {
  // C 类优先判定
  if (t.origin === 'textbook' && t.subject === 'Chinese' && C_PATTERNS.some(p => p.test(t.name))) {
    classified.C.push(t);
    continue;
  }
  // 非语文的课文标题特征
  if (C_PATTERNS.some(p => p.test(t.name)) && t.subject === 'Chinese') {
    // 有书名号等特征的语文条目
    if (!/(方法|技巧|分析|理解|鉴赏|概括|表达|写作|阅读|文言文|古诗)/.test(t.name)) {
      classified.C.push(t);
      continue;
    }
  }
  // B 类判定
  if (B_PATTERNS.some(p => p.test(t.name))) {
    classified.B.push(t);
    continue;
  }
  // 默认 A 类（待拆分）
  classified.A.push(t);
}

// --- 输出 ---
const getArg = (name) => {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : null;
};
const filterSubject = getArg('--subject');
const filterType = getArg('--type');

console.log(`总计命中: ${hits.length} (占 ${data.topics.length} 条的 ${(hits.length/data.topics.length*100).toFixed(1)}%)`);
console.log(`  A 类（应拆分）: ${classified.A.length}`);
console.log(`  B 类（不拆）:   ${classified.B.length}`);
console.log(`  C 类（剔除）:   ${classified.C.length}`);
console.log('');

for (const [type, label] of [['A', '应拆分'], ['B', '不拆'], ['C', '剔除']]) {
  if (filterType && filterType !== type) continue;
  const items = classified[type];
  if (filterSubject) {
    const filtered = items.filter(t => t.subject === filterSubject);
    console.log(`=== ${type} 类·${label}（${filterSubject}: ${filtered.length} 条）===`);
    for (const t of filtered) console.log(`  ${t.id}  [${t.ageRangeStart}-${t.ageRangeEnd}]  ${t.name}`);
    console.log('');
  } else {
    console.log(`=== ${type} 类·${label}（${items.length} 条）===`);
    for (const t of items) console.log(`  ${t.id}  ${t.subject.slice(0,12).padEnd(12)} ${t.name}`);
    console.log('');
  }
}
