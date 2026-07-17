#!/usr/bin/env node
/**
 * cleanup-topics.mjs — cn-topics.json 的最终清理：去重 + 残余复合拆分 + 碎片删除。
 *
 * 三类处理：
 *   D 类（去重）：76 组重复 name，保留每组的最佳条目（优先 cn_only > progression > textbook）
 *   F 类（碎片删除）："文化""发展""管理""教化"等课本碎片，无实际微技能意义
 *   A 类（残余拆分）：~45 条漏网的复合标题
 *
 *   node scripts/cleanup-topics.mjs            # 执行（写盘）
 *   node scripts/cleanup-topics.mjs --dry-run  # 预览
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const dryRun = process.argv.includes('--dry-run');

const data = JSON.parse(readFileSync(resolve(DATA, 'cn-topics.json'), 'utf8'));

// ========== F 类：碎片删除 ==========
// 课本目录解析产生的碎片标题，name 无微技能意义
const FRAGMENT_NAMES = new Set([
  '文化', '发展', '管理', '教化', '科技', '文学', '艺术', '经济', '政治', '社会',
]);

// ========== A 类：残余复合标题拆分 ==========
const RESIDUAL_SPLITS = {
  'mtc_100': { a: '数据安全', b: '数据备份与保护' },
  'mtc_101': { a: '算法·步骤', b: '算法·顺序' },
  'mtc_104': { a: '互联网', b: '在线学习' },
  'mtc_105': { a: '网络·搜索信息', b: '网络·获取信息' },
  'mtc_106': { a: '文字处理·输入', b: '文字处理·排版' },
  'mtc_108': { a: '信息安全·密码', b: '信息安全·个人信息保护' },
  'mtc_109': { a: '信息社会责任·文明上网', b: '信息社会责任·数字身份' },
  'mtc_112': { a: '清洁·扫地擦桌', b: '卫生·整理' },
  'mtc_113': { a: '整理与收纳·物品归位', b: '整理与收纳·分类' },
  'mtc_616': { a: '集合的运算·交集', b: '集合的运算·并集' },
  'mtc_1861': { a: '集合的运算·补集', b: '集合的运算·Venn图' },
  'mtc_627': { a: '指数', b: '指数幂的运算' },
  'mtc_825': { a: 'Python·列表', b: 'Python·函数' },
  'mtc_830': { a: '发现与明确问题', b: '设计要求' }, // 通用技术两步
  'mtc_833': { a: '测试', b: '评估' },
  'mtc_896': { a: '金刚石', b: '石墨' },
  'mtc_905': { a: '酸碱中和反应', b: '中和反应的应用' },
  'mtc_966': { a: '醛', b: '酮' },
  'mtc_975': { a: '醛', b: '酮' }, // 重复条目的拆分
  'mtc_984': { a: '绿色植物的水循环', b: '生物圈的水循环' },
  'mtc_986': { a: '绿色植物的碳氧平衡', b: '生物圈中的碳氧平衡' },
  'mtc_993': { a: '动物的运动', b: '动物的行为' },
  'mtc_997': { a: '生物的生殖', b: '生物的发育' },
  'mtc_998': { a: '生物的遗传', b: '生物的变异' },
  'mtc_999': { a: '传染病', b: '免疫' },
  'mtc_1240': { a: '地球', b: '地图' },
  'mtc_1241': { a: '陆地', b: '海洋' },
  'mtc_1242': { a: '天气', b: '气候' },
  'mtc_1243': { a: '居民', b: '聚落' },
  'mtc_1273': { a: '集合', b: '常用逻辑用语' },
  'mtc_1275': { a: '集合', b: '常用逻辑用语' }, // 重复条目
  'mtc_1637': { a: '模拟信号', b: '数字信号' },
  'mtc_1667': { a: '智能家居·功能', b: '智能家居·分类' },
  'mtc_1668': { a: '智能家居·控制', b: '智能家居·实现' },
  'mtc_1686': { a: '传感器的原理', b: '传感器的种类' },
  'mtc_1687': { a: '路径规划', b: '运动控制·概念与功能' },
  'mtc_1688': { a: '路径规划·设计方法', b: '运动控制·设计方法' },
};

// ========== D 类：去重策略 ==========
// origin 优先级：cn_only > upstream_adapt > cross_domain > progression > textbook
const ORIGIN_PRIORITY = { 'cn_only': 5, 'upstream_adapt': 4, 'cross_domain': 3, 'progression': 2, 'textbook': 1 };

function pickBest(topics) {
  // 按 origin 优先级排序，同 origin 的取 description 最长的（信息最丰富）
  return topics.sort((a, b) => {
    const po = ORIGIN_PRIORITY[a.origin] || 0;
    const pb = ORIGIN_PRIORITY[b.origin] || 0;
    if (po !== pb) return pb - po;
    return (b.description?.length || 0) - (a.description?.length || 0);
  })[0];
}

// ========== 执行 ==========
let maxNum = 0;
for (const t of data.topics) {
  const m = t.id.match(/^mtc_(\d+)$/);
  if (m) maxNum = Math.max(maxNum, parseInt(m[1], 10));
}
let nextNum = maxNum + 1;

// 第 1 步：标记删除（F 类碎片 + D 类重复的冗余条目）
const deleteIds = new Set();

// F 类碎片
for (const t of data.topics) {
  if (FRAGMENT_NAMES.has(t.name)) {
    deleteIds.add(t.id);
  }
}

// D 类去重：同 name 多条，保留最佳
const byName = new Map();
for (const t of data.topics) {
  if (!byName.has(t.name)) byName.set(t.name, []);
  byName.get(t.name).push(t);
}
let dedupCount = 0;
const renameForDedup = new Map(); // id → 新 name（跨学段同名时给保留条加学段后缀）
for (const [name, ts] of byName) {
  if (ts.length < 2) continue;
  const best = pickBest([...ts]);
  // 检查是否有跨学段的情况
  const hasCrossStage = ts.some(t => Math.abs((t.ageRangeStart || 0) - (best.ageRangeStart || 0)) > 3);
  for (const t of ts) {
    if (t.id !== best.id) {
      deleteIds.add(t.id);
      dedupCount++;
    }
  }
  // 跨学段同名时，给保留条目加学段后缀避免混淆
  if (hasCrossStage) {
    const stage = best.ageRangeStart <= 12 ? '（初中）' : '（高中）';
    renameForDedup.set(best.id, best.name + stage);
  }
}

// 第 2 步：A 类残余拆分
const splitTopics = []; // 新生成的 b 条目
const splitUpdates = new Map(); // 原条目 id → 新 name

for (const t of data.topics) {
  if (deleteIds.has(t.id)) continue;
  const split = RESIDUAL_SPLITS[t.id];
  if (!split) continue;
  // 原 id 改为 a
  splitUpdates.set(t.id, split.a);
  // 新建 b
  const bId = `mtc_${String(nextNum++).padStart(3, '0')}`;
  splitTopics.push({ ...t, id: bId, name: split.b, splitFrom: t.id, splitPart: 'b' });
}

// 第 3 步：构建最终 topics 数组
const finalTopics = [];
let deleted = 0, splitCount = 0;

for (const t of data.topics) {
  if (deleteIds.has(t.id)) { deleted++; continue; }
  if (splitUpdates.has(t.id)) {
    t.name = splitUpdates.get(t.id);
    t.splitPart = 'a';
    splitCount++;
  }
  if (renameForDedup.has(t.id)) {
    t.name = renameForDedup.get(t.id);
  }
  finalTopics.push(t);
}
// 追加拆分出的 b 条目
for (const t of splitTopics) finalTopics.push(t);

data.topicCount = finalTopics.length;
data.topics = finalTopics;

// ========== 报告 ==========
const fragCount = data.topics.filter(t => false).length; // 已删
console.log('=== 清理结果 ===');
console.log(`  F 类碎片删除: ${[...deleteIds].filter(id => {
  const t = data.topics.find(x => x.id === id); return false;
}).length}`);
console.log(`  删除总数（碎片+冗余）: ${deleted}`);
console.log(`    其中碎片: ${data.topics.length}`);
console.log(`  A 类残余拆分: ${splitCount} → ${splitCount + splitTopics.length} 条`);
console.log(`  新增 b 条目: ${splitTopics.length}`);
console.log(`最终主题数: ${finalTopics.length}`);

// 残余"和/与"统计
const hits = finalTopics.filter(t => /[和与]/.test(t.name));
console.log(`\n残余含和/与: ${hits.length} (${(hits.length/finalTopics.length*100).toFixed(1)}%)`);

if (dryRun) {
  console.log('\n=== 残余和/与列表 ===');
  for (const t of hits) console.log(`  ${t.id}  ${t.subject.slice(0,12).padEnd(12)} ${t.name}`);
  console.log('\n（--dry-run 模式，未写盘）');
} else {
  writeFileSync(resolve(DATA, 'cn-topics.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log('\n✓ 已写入 data/cn-topics.json');
}
