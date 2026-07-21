#!/usr/bin/env node
/**
 * compute-centrality.mjs — 计算 mtc_ 微主题的 centrality（核心度）。
 *
 * 算法：下游可达的"概念/技能"节点数 / 最大可达数，归一化到 [0,1]。
 *   centrality(topic) = |{ 从 topic 可达的 concept/skill 节点 }| / maxReach
 *
 * 直觉：掌握一个核心基础知识（如"加法"）能解锁多少后续知识。centrality 越高，
 *   说明这个知识点越是"枢纽"——不学它，后面大片知识都进不去。
 *
 * 算法选型依据（逆向工程上游）：
 *   - 上游 mt_ 图的 centrality 与"下游可达节点数"相关系数 0.79（实测）
 *   - 上游 top：一一对应计数(1.0)/总数(0.97)/握笔(0.66)——全是基础枢纽技能
 *   - 非 PageRank（PR 相关系数仅 0.28），非入度(0.07)/出度(0.31)/eigenvector(NaN)
 *
 * 节点过滤（经 opus review 确认，修复 v1 的语义污染）：
 *   - 只对 nodeKind ∈ {concept, skill} 的节点计算 centrality（这才是"知识枢纽"）
 *   - nodeKind === 'text' 的节点 centrality = null（明确表示"不适用"，非 0）
 *   - 课文中转可达的概念仍计入（如"课文A→概念B"，B 算入 A 的 reach——但 A 自身是 text 不计算）
 *   - maxReach 只在 concept+skill 起点里取 max，避免 text 节点污染归一化分母
 *
 * 边方向：prerequisite -> topic（知识从基础流向进阶）。
 *   只统计 reviewStatus !== 'rejected' 的边（rejected 不入图）。
 *
 * 已知偏差（v2 升级路径，本版不实现，为对齐上游保持简单）：
 *   - 链长无衰减（"近邻"和"远亲"同权）→ 可升级为 γ^{dist} 衰减可达和
 *   - 忽略 strength（hard/soft 同权）→ 可升级为路径瓶颈强度加权
 *   - 跨学科枢纽天然被低估 → 可考虑 betweenness/Katz，但会丢失对齐上游能力
 *
 * 有效性验证：用 Top-20 语义抽查（清理后应是基础概念，不是课文）。
 *
 *   node scripts/compute-centrality.mjs --check      验证存储值与当前 reviewed 图一致
 *   node scripts/compute-centrality.mjs --dry-run    只报告分布，不写盘
 *   node scripts/compute-centrality.mjs              写盘到 data/cn-topics.json
 */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishedGraph } from './review-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const TOPICS_PATH = resolve(DATA, 'cn-topics.json');

// 只在 concept+skill 节点上计算 centrality 的"可达概念数"
// outAdj: prerequisiteId -> Set<topicId>（全图邻接，含 text 中转节点）
// countingPred: Set<nodeId>，只计这些节点（concept+skill），text 不计但可中转
function computeReachableConcepts(startIds, outAdj, countingPred) {
  const result = new Map();
  for (const start of startIds) {
    const visited = new Set();
    const queue = [start];
    while (queue.length) {
      const v = queue.shift();
      const succ = outAdj.get(v);
      if (!succ) continue;
      for (const w of succ) {
        if (!visited.has(w)) {
          visited.add(w);
          queue.push(w);
        }
      }
    }
    // visited 含所有可达节点（含 text）；只数 concept+skill
    let count = 0;
    for (const v of visited) if (countingPred.has(v)) count++;
    result.set(start, count);
  }
  return result;
}
function computeCentrality(topics, edges) {
  const outAdj = new Map();
  for (const edge of edges) {
    if (!outAdj.has(edge.prerequisiteId)) outAdj.set(edge.prerequisiteId, new Set());
    outAdj.get(edge.prerequisiteId).add(edge.topicId);
  }
  const isCounting = topic => topic.nodeKind === 'concept' || topic.nodeKind === 'skill' || !topic.nodeKind;
  const countingSet = new Set(topics.filter(isCounting).map(topic => topic.id));
  const countingIds = [...countingSet];
  const reachable = computeReachableConcepts(countingIds, outAdj, countingSet);
  const maxReach = Math.max(...countingIds.map(id => reachable.get(id) || 0), 1);
  const centrality = new Map(topics.map(topic => [topic.id,
    countingSet.has(topic.id) ? +((reachable.get(topic.id) || 0) / maxReach).toFixed(6) : null]));
  return { centrality, countingSet, reachable, maxReach };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const checkOnly = process.argv.includes('--check');

  const data = JSON.parse(readFileSync(TOPICS_PATH, 'utf8'));
  const topics = data.topics;
  const topicById = new Map(topics.map(t => [t.id, t]));
  // canonical centrality 只基于儿童可发布图，避免 machine/rescope/covered 影响路径排序
  const depsData = JSON.parse(readFileSync(resolve(DATA, 'cn-dependencies.json'), 'utf8'));
  const graph = publishedGraph(topics, depsData.dependencies);
  const computed = computeCentrality(graph.topics, graph.dependencies);
  const centrality = new Map(topics.map(topic => [topic.id, computed.centrality.get(topic.id) ?? null]));
  const countingSet = computed.countingSet;
  const reachable = computed.reachable;
  const maxReach = computed.maxReach;
  const countingIds = [...countingSet];
  const reachVals = countingIds.map(id => reachable.get(id) || 0);

  console.log(`=== centrality 计算 ===`);
  console.log(`  总节点: ${topics.length}`);
  console.log(`  参与 centrality（concept+skill）: ${countingIds.length}`);
  console.log(`  covered/text 不参与: ${topics.length - countingIds.length}`);
  console.log(`  有效边数（reviewed published）: ${graph.dependencies.length}`);
  const t0 = Date.now();
  const dt = ((Date.now() - t0) / 1000).toFixed(2);

  // 分布统计（只看 concept+skill）
  const sorted = [...reachVals.map(r => r / maxReach)].sort((a, b) => b - a);
  const nonZero = sorted.filter(c => c > 0).length;
  const top10pct = sorted.slice(0, Math.floor(sorted.length * 0.1));
  console.log(`\n=== 分布（${dt}s）===`);
  console.log(`  max: ${sorted[0].toFixed(4)}（maxReach=${maxReach}）`);
  console.log(`  非零节点: ${nonZero} / ${countingIds.length} (${(100 * nonZero / countingIds.length).toFixed(1)}%)`);
  console.log(`  P50: ${sorted[Math.floor(sorted.length / 2)].toFixed(4)}`);
  console.log(`  P90: ${sorted[Math.floor(sorted.length * 0.1)].toFixed(4)}`);
  console.log(`  Top 10% 平均: ${(top10pct.reduce((a, b) => a + b, 0) / top10pct.length).toFixed(4)}`);

  // Top 20 核心节点（语义抽查的关键）
  console.log(`\n=== Top 20 核心节点（语义抽查：应是基础概念/技能，不应有课文）===`);
  const ranked = countingIds.map(id => {
    const t = topicById.get(id);
    return { id, name: t.name, c: centrality.get(id), reach: reachable.get(id), subject: t.subject, stage: t.stage, kind: t.nodeKind };
  }).sort((a, b) => b.c - a.c);
  for (const r of ranked.slice(0, 20)) {
    console.log(`  ${r.c.toFixed(4)} reach=${String(r.reach).padStart(3)} [${r.subject}/${r.stage}/${r.kind}] ${r.name}`);
  }

  if (checkOnly) {
    const mismatches = topics.filter(topic => topic.centrality !== centrality.get(topic.id));
    if (mismatches.length) throw new Error(`${mismatches.length} 个 centrality 字段已过期`);
    console.log('✓ centrality 与当前 reviewed 图一致');
    return;
  }
  if (dryRun) {
    console.log('\n（--dry-run 模式，未写盘）');
    return;
  }

  // 备份
  const ts = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  const snapshotDir = resolve(DATA, '.snapshots', `${stamp}-centrality`);
  mkdirSync(snapshotDir, { recursive: true });
  copyFileSync(TOPICS_PATH, resolve(snapshotDir, 'cn-topics.json'));
  console.log(`\n✓ 已备份到 ${snapshotDir}`);

  // 写盘
  let updated = 0;
  for (const t of topics) {
    const old = t.centrality;
    if (countingSet.has(t.id)) {
      t.centrality = centrality.get(t.id);
    } else {
      t.centrality = null; // text 节点：null 表示"不适用"
    }
    if (old !== t.centrality) updated++;
  }
  writeFileSync(TOPICS_PATH, JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`✓ 已写 data/cn-topics.json（更新 ${updated} 个 centrality 字段）`);
  console.log('下一步: node scripts/checksum.mjs && node scripts/validate.mjs');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}

export { computeCentrality, computeReachableConcepts };

