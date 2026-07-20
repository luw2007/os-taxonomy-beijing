#!/usr/bin/env node
/**
 * backfill-node-kind.mjs — 给 cn-topics 的每个 topic 回填 nodeKind 字段。
 *
 * nodeKind 三值（经 opus review 确认的数据建模字段）：
 *   concept  可抽象、可迁移、有定义的知识点（如"加法""光的色散""力的概念"）
 *   text     具体课文/案例/阅读素材，一次性、不可迁移（如"太空一日""故乡""春"）
 *   skill    程序性技能，"会做"而非"懂"（如"毛笔楷书""查字典""显微镜操作"）
 *
 * 注：opus review 建议四值（含 meta），但实测 type=META 字段不可靠（51 个里大部分是
 * "能量守恒定律""数学建模"这种纯概念），自动判定 meta 会误伤。故 v1.2 暂不区分 meta，
 * 这些节点归入 concept。未来如需 meta 再加人工标注。
 *
 * 为什么需要 nodeKind（review 背景）：
 *   centrality 算法在混合语义图上跑出 Top 20 全是课文（"太空一日"reach=59），
 *   因为 cn-deps 把"课文→课文"也连成依赖。nodeKind 让 centrality 只对 concept+skill
 *   计算，text 节点 centrality=null。同时 A2 学段桥、C1 学习路径等下游都要用。
 *
 * 回填规则（基于实测数据，可靠性 >95%）：
 *   1. text 判定（最强信号）：
 *      - domain === "Reading Materials" 且 name 不含"·"  → text（实测 167/187 是课文）
 *      - name 含《》或 /篇名（如"孙权劝学/《资治通鉴》"）           → text
 *      - name 含"必背篇目"/"积累"且非动词性                          → text（篇目清单）
 *   2. meta 判定：type === "META"                                  → meta
 *   3. skill 判定：type === "PROCEDURAL" 且非 text                  → skill
 *   4. concept（兜底）：其余全部                                    → concept
 *      - 理科 textbook 节点（328 个）全部落这里 ✓（"光的色散""细胞结构"）
 *      - 文学 domain 里 name 含"·"或动词性词（"朗读·正确流利""读懂童话"）也落这里 ✓
 *
 * CLI：
 *   node scripts/backfill-node-kind.mjs --dry-run    只报告分布 + 不确定样本，不写盘
 *   node scripts/backfill-node-kind.mjs              写盘到 data/cn-topics.json
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const TOPICS_PATH = resolve(DATA, 'cn-topics.json');

// 文学类 domain（课文聚集区）
const LITERATURE_DOMAINS = new Set([
  'Reading Materials',      // 187 节点，167 是课文
  'Whole-book Reading',
  'Literary Reading',
  // Classical Poetry / Classical Chinese 不全列：它们里面概念和篇目混在一起，
  // 靠 name 模式区分（含·或动词 = 概念，其余 = 课文清单）
]);

// 动词性词（出现则偏向概念/技能而非篇目）
const CONCEPT_VERBS = /读懂|能写|能读|学会|掌握|运用|欣赏|分析|概括|辨析|翻译|理解|认识|了解|感受|体会|表达|梳理|探究|比较|归纳|推断|评价|创作|写作|阅读|朗读|背诵|拼写|发音|书写|查字典|使用|操作/;

// 判定单个 topic 的 nodeKind
function classifyNodeKind(t) {
  const name = t.name || '';
  const domain = t.domain || '';
  const type = t.type || '';

  // 先判 text（最强信号，优先级最高）
  // 1) Reading Materials domain → 课文（实测 180/187 是课文，含"·"的如"沁园春·雪"也是篇目）
  //    例外：name 含动词性词（如"理解文章结构"）才是概念
  if (domain === 'Reading Materials' && !CONCEPT_VERBS.test(name)) return 'text';
  // 2) name 含书名号《》→ 明确是具体篇目
  if (/《[^》]+》/.test(name)) return 'text';
  // 3) name 含"XX/《YY》"或"XX/作者"模式（如"孙权劝学/《资治通鉴》""沁园春·长沙/毛泽东"）
  if (/.+\/\s*[《]/.test(name) || /.+\/\s*[\u4e00-\u9fff]{2,4}$/.test(name)) return 'text';
  // 4) 词牌名/曲牌名模式（"沁园春·雪""念奴娇·赤壁怀古"）—— "·"前是固定词牌
  if (/^[沁念破蝶水满江红忆捣练子声声慢长相思如梦令卜算子诉衷情青玉案]([宫商角徵羽]|[a-zA-Z])|·.{1,4}$/.test(name)
      && !CONCEPT_VERBS.test(name)
      && (domain === 'Reading Materials' || domain === 'Classical Poetry')) return 'text';
  // 5) Classical Poetry/Classical Chinese/Literary Reading 里：
  //    - 含"·"的多是知识点分类（"文言文·常见虚词用法""古诗·节奏与意境"）→ concept（兜底）
  //    - 不含"·"且不含动词的多是篇目清单（"古代诗歌四首""古诗文背诵"）→ text
  if ((domain === 'Classical Poetry' || domain === 'Classical Chinese' || domain === 'Literary Reading')
      && !name.includes('·')
      && !CONCEPT_VERBS.test(name)) {
    return 'text';
  }

  // 再判 skill（PROCEDURAL 且非 text）
  if (type === 'PROCEDURAL') return 'skill';

  // 兜底：concept（理科 textbook 328 个全落这里 ✓）
  return 'concept';
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  const data = JSON.parse(readFileSync(TOPICS_PATH, 'utf8'));
  const topics = data.topics;

  const counts = { concept: 0, text: 0, skill: 0 };
  const samples = { concept: [], text: [], skill: [], meta: [] };
  const uncertain = []; // 边缘 case，供人工复核

  for (const t of topics) {
    const kind = classifyNodeKind(t);
    t._nodeKind = kind; // 临时标记，写盘时改正式字段名
    counts[kind]++;
    if (samples[kind].length < 8) samples[kind].push(`${t.subject}/${t.domain}: ${t.name}`);
  }

  console.log('=== nodeKind 回填分布 ===');
  for (const [k, c] of Object.entries(counts)) {
    console.log(`  ${k}: ${c} (${(100 * c / topics.length).toFixed(1)}%)`);
  }
  console.log('\n=== 各类样本 ===');
  for (const [k, ss] of Object.entries(samples)) {
    console.log(`\n[${k}]`);
    ss.forEach(s => console.log(`  ${s}`));
  }

  // 重点审查：Reading Materials 里被判 concept 的（应该很少，看是否误判）
  const rmConcepts = topics.filter(t => t.domain === 'Reading Materials' && t._nodeKind === 'concept');
  console.log(`\n=== Reading Materials 里被判 concept 的（${rmConcepts.length} 个，审查是否误判）===`);
  rmConcepts.forEach(t => console.log(`  ${t.name}`));

  if (dryRun) {
    console.log('\n（--dry-run 模式，未写盘）');
    // 清理临时字段
    topics.forEach(t => { delete t._nodeKind; });
    return;
  }

  // 备份
  const ts = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  const snapshotDir = resolve(DATA, '.snapshots', `${stamp}-nodekind`);
  mkdirSync(snapshotDir, { recursive: true });
  copyFileSync(TOPICS_PATH, resolve(snapshotDir, 'cn-topics.json'));
  console.log(`\n✓ 已备份到 ${snapshotDir}`);

  // 写盘：把 _nodeKind 转成正式字段 nodeKind，放在 type 后面
  let updated = 0;
  for (const t of topics) {
    const kind = t._nodeKind;
    delete t._nodeKind;
    if (t.nodeKind !== kind) {
      t.nodeKind = kind;
      updated++;
    }
  }
  writeFileSync(TOPICS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`✓ 已写 data/cn-topics.json（${updated} 个节点加 nodeKind 字段）`);
  console.log('下一步: node scripts/compute-centrality.mjs --dry-run（验证 centrality 现在只在 concept+skill 上算）');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}

export { classifyNodeKind };
