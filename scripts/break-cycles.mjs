#!/usr/bin/env node
/**
 * break-cycles.mjs — DAG 完整性修复：在依赖图上破除所有环。
 *
 * 背景：
 *   data/cn-dependencies.json 含 2537 条边，但存在 135 个含环 SCC（最大 31 节点）。
 *   旧版 build-deps-llm.mjs 里的 removeCycles 有三个 bug（_weak 字段从未赋值、
 *   pass<10 上限太小、对 LLM 边单独破环后再合并规则边导致重新成环）。本脚本替换它。
 *
 * 算法：
 *   1. 用迭代版 Tarjan 计算所有 SCC（节点 ~1640，递归会栈溢出，必须迭代）。
 *   2. 对每个 size>1 的 SCC，贪心删一条评分最高的边，然后重新跑 Tarjan，
 *      只要全图还有 size>1 的 SCC，就继续删，直到 DAG。
 *   3. 删边评分（多维权重）：
 *        score(edge) = w1 * (strength===soft ? 1 : 0)      // 优先删 soft（w1=1.0）
 *                    + w2 * (reason 是已知模板? 1 : 0)       // 优先删重复 reason（w2=0.5）
 *                    + w3 * (1 / degree(edge))              // 优先删低度数（w3=0.3）
 *      注意：第一遍【不】用 centrality（w4），避免与 B1 centrality 计算形成循环依赖。
 *   4. 贪心策略：每次在当前最大的 size>1 SCC 内删一条边（评分最高者），
 *      而不是按固定顺序删整条 SCC——这样能自动处理 SCC 之间共享边的情况。
 *
 * CLI：
 *   node scripts/break-cycles.mjs --dry-run    只报告，不写盘
 *   node scripts/break-cycles.mjs              备份后写盘到 data/cn-dependencies.json
 *
 * 幂等性：对已无环的数据再跑，删 0 条边。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const DEPS_PATH = resolve(DATA, 'cn-dependencies.json');

// ========== 权重配置 ==========
const W_SOFT = 1.0;        // 优先删 soft 边（LLM 不太确定的）
const W_TEMPLATE = 0.5;    // 优先删 reason 命中已知重复模板的边
const W_LOWDEG = 0.3;      // 优先删低度数边（度数 = 入度 + 出度）

// ========== 已知重复 reason 模板（实测高频成环模板，hardcode） ==========
const TEMPLATE_REASONS = [
  '理解不同作者的作品需要先掌握阅读理解的基本原理',
  '两篇诗的题材和写作背景理解上有一定关联性。',
  '理解不同文学作品需要先了解文学基本原理',
  '需要先理解刘绍棠的基本内容才能分析相关问题',
  '创新思维需要先理解概念',
];

function isTemplateReason(reason) {
  if (!reason) return false;
  return TEMPLATE_REASONS.some(t => reason === t || reason.includes(t));
}

// ========== 迭代 Tarjan SCC ==========
// 返回 SCC 数组，每个 SCC 是节点 id 数组（size=1 的是平凡 SCC）
// 采用显式工作栈模拟递归，避免大图栈溢出
function tarjanSCC(nodeIds, adj) {
  const index = new Map();    // 节点 → 发现序号
  const low = new Map();      // 节点 → low 值
  const onStack = new Map();  // 节点 → 是否在栈上
  const stack = [];           // Tarjan 显式栈
  const sccs = [];
  let idx = 0;

  for (const v0 of nodeIds) {
    if (index.has(v0)) continue;
    // 启动一棵 DFS 树
    index.set(v0, idx);
    low.set(v0, idx);
    idx++;
    stack.push(v0);
    onStack.set(v0, true);

    const work = [[v0, 0]]; // [节点, 邻接下标]
    while (work.length > 0) {
      const frame = work[work.length - 1];
      const v = frame[0];
      let i = frame[1];
      const succ = adj.get(v) || [];
      let recursed = false;

      while (i < succ.length) {
        const w = succ[i];
        if (!index.has(w)) {
          // 未访问：推入新帧
          index.set(w, idx);
          low.set(w, idx);
          idx++;
          stack.push(w);
          onStack.set(w, true);
          frame[1] = i + 1;
          work.push([w, 0]);
          recursed = true;
          break;
        } else if (onStack.get(w)) {
          // 在栈上：回链
          low.set(v, Math.min(low.get(v), index.get(w)));
        }
        i++;
      }

      if (recursed) continue;

      // 当前节点邻接处理完毕，检查是否为 SCC 根
      if (low.get(v) === index.get(v)) {
        const comp = [];
        let w;
        do {
          w = stack.pop();
          onStack.set(w, false);
          comp.push(w);
        } while (w !== v);
        sccs.push(comp);
      }

      work.pop();
      // 回到父节点：用当前 low 更新父 low
      if (work.length > 0) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
    }
  }

  return sccs;
}

// ========== 评分 ==========
function scoreEdge(edge, degreeMap) {
  const softScore = edge.strength === 'soft' ? 1 : 0;
  const tplScore = isTemplateReason(edge.reason) ? 1 : 0;
  const deg = degreeMap.get(edgeKey(edge)) || 1;
  const lowdegScore = 1 / deg;
  return W_SOFT * softScore + W_TEMPLATE * tplScore + W_LOWDEG * lowdegScore;
}

function edgeKey(e) {
  return `${e.prerequisiteId}->${e.topicId}`;
}

function removedReasonFor(edge) {
  // 给被删的边一个可读的 removedReason（按最显著维度归类）
  if (edge.strength === 'soft') return 'cycle-soft';
  if (isTemplateReason(edge.reason)) return 'cycle-template';
  return 'cycle-lowdeg';
}

// ========== 核心：贪心破环 ==========
// 输入：edges 数组，每条形如 {topicId, prerequisiteId, strength, reason, ...}
// 输出：{ kept: [...], removed: [...] }，removed 每条带 removedReason 字段
export function breakCycles(edges) {
  // 浅拷贝并加内部 key 字段（不污染调用方对象）
  const work = edges.map(e => ({ ...e }));
  const removed = [];

  // 限制最大删边数，防止意外死循环（理论上删 |edges| 条必无环，这里留余量）
  const MAX_REMOVE = edges.length + 10;

  for (let iter = 0; iter < MAX_REMOVE; iter++) {
    // 每轮重建邻接表、节点集合、度数表
    const adj = new Map(); // prerequisiteId → [topicId]
    const nodes = new Set();
    const inDeg = new Map();  // topicId 入度
    const outDeg = new Map(); // prerequisiteId 出度
    const edgeMap = new Map(); // key → work edge

    for (const e of work) {
      const k = edgeKey(e);
      edgeMap.set(k, e);
      if (!adj.has(e.prerequisiteId)) adj.set(e.prerequisiteId, []);
      adj.get(e.prerequisiteId).push(e.topicId);
      nodes.add(e.topicId);
      nodes.add(e.prerequisiteId);
      inDeg.set(e.topicId, (inDeg.get(e.topicId) || 0) + 1);
      outDeg.set(e.prerequisiteId, (outDeg.get(e.prerequisiteId) || 0) + 1);
    }

    // 度数表（degree = inDeg + outDeg，按 edge key 存）
    const degreeMap = new Map();
    for (const e of work) {
      const k = edgeKey(e);
      const d = (inDeg.get(e.topicId) || 0) + (outDeg.get(e.prerequisiteId) || 0);
      degreeMap.set(k, d);
    }

    const sccs = tarjanSCC([...nodes], adj);
    const cyclic = sccs.filter(c => c.length > 1);
    if (cyclic.length === 0) break; // DAG 达成

    // 选当前最大 SCC 内评分最高的边删除
    // （按 size 降序排，找第一个能选到边的 SCC）
    cyclic.sort((a, b) => b.length - a.length);
    const compSet = new Set();
    let chosenEdge = null;
    let chosenScore = -Infinity;

    for (const comp of cyclic) {
      compSet.clear();
      for (const n of comp) compSet.add(n);
      // 候选边：两端都在这个 SCC 内
      let bestEdge = null;
      let bestScore = -Infinity;
      for (const e of work) {
        if (compSet.has(e.topicId) && compSet.has(e.prerequisiteId)) {
          const s = scoreEdge(e, degreeMap);
          if (s > bestScore || (s === bestScore && bestEdge && edgeKey(e) < edgeKey(bestEdge))) {
            bestScore = s;
            bestEdge = e;
          }
        }
      }
      if (bestEdge && bestScore > chosenScore) {
        chosenScore = bestScore;
        chosenEdge = bestEdge;
      }
      if (chosenEdge) break; // 已在最大 SCC 选到，删它后重算
    }

    if (!chosenEdge) {
      // 理论上不会发生（SCC size>1 必有内部边），防御性退出
      break;
    }

    // 删边
    const idx = work.indexOf(chosenEdge);
    if (idx >= 0) work.splice(idx, 1);
    removed.push({ ...chosenEdge, removedReason: removedReasonFor(chosenEdge) });
  }

  return { kept: work, removed };
}

// ========== CLI 辅助：统计 ==========
// 反平行对数：同时存在 A→B 和 B→A 的无序对数。
// 这是破环删边数的硬下界（每对至少删 1 条），比"含环 SCC 数"更准。
function computeAntiparallelPairs(edges) {
  const fwd = new Set(edges.map(e => `${e.topicId}->${e.prerequisiteId}`));
  const seen = new Set();
  let count = 0;
  for (const e of edges) {
    const a = `${e.topicId}->${e.prerequisiteId}`;
    const b = `${e.prerequisiteId}->${e.topicId}`;
    if (fwd.has(b) && !seen.has(a) && !seen.has(b)) {
      count++;
      seen.add(a);
      seen.add(b);
    }
  }
  return count;
}

function computeStats(edges) {
  const adj = new Map();
  const nodes = new Set();
  for (const e of edges) {
    if (!adj.has(e.prerequisiteId)) adj.set(e.prerequisiteId, []);
    adj.get(e.prerequisiteId).push(e.topicId);
    nodes.add(e.topicId);
    nodes.add(e.prerequisiteId);
  }
  const sccs = tarjanSCC([...nodes], adj);
  const cyclic = sccs.filter(c => c.length > 1);
  return {
    nodeCount: nodes.size,
    edgeCount: edges.length,
    density: nodes.size > 0 ? edges.length / nodes.size : 0,
    cyclicSccCount: cyclic.length,
    nodesInCycles: cyclic.reduce((s, c) => s + c.length, 0),
    largestScc: cyclic.length > 0 ? Math.max(...cyclic.map(c => c.length)) : 1,
  };
}

// ========== CLI ==========
async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');

  const data = JSON.parse(readFileSync(DEPS_PATH, 'utf8'));
  const edges = data.dependencies || [];

  const before = computeStats(edges);
  const antiparallelLB = computeAntiparallelPairs(edges);
  console.log('=== 破环前 ===');
  console.log(`  节点数: ${before.nodeCount}`);
  console.log(`  边数: ${before.edgeCount}`);
  console.log(`  密度: ${before.density.toFixed(3)} 边/节点`);
  console.log(`  含环 SCC 数: ${before.cyclicSccCount}`);
  console.log(`  环内节点数: ${before.nodesInCycles}`);
  console.log(`  最大 SCC: ${before.largestScc}`);
  console.log(`  反平行对数 (A→B 且 B→A): ${antiparallelLB} ← 删边数理论下界`);

  const t0 = Date.now();
  const { kept, removed } = breakCycles(edges);
  const dt = ((Date.now() - t0) / 1000).toFixed(2);

  const after = computeStats(kept);
  console.log(`\n=== 破环后 (${dt}s) ===`);
  console.log(`  边数: ${after.edgeCount}（删 ${removed.length}）`);
  console.log(`  密度: ${after.density.toFixed(3)} 边/节点`);
  console.log(`  含环 SCC 数: ${after.cyclicSccCount}`);
  console.log(`  最大 SCC: ${after.largestScc}`);

  // 按 removedReason 分类统计
  const reasonStats = {};
  for (const e of removed) {
    reasonStats[e.removedReason] = (reasonStats[e.removedReason] || 0) + 1;
  }
  console.log(`\n=== 删边按 removedReason 分类 ===`);
  for (const [r, c] of Object.entries(reasonStats).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r}: ${c}`);
  }

  console.log(`\n=== 前 20 条删边 ===`);
  for (const e of removed.slice(0, 20)) {
    const reason = e.reason ? (e.reason.length > 40 ? e.reason.slice(0, 40) + '…' : e.reason) : '(无 reason)';
    console.log(`  ${e.prerequisiteId} -> ${e.topicId}  [${e.strength}] [${e.removedReason}]  ${reason}`);
  }

  if (removed.length === 0) {
    console.log('\n✓ 图已无环（幂等：0 删边）');
  }

  if (dryRun) {
    console.log('\n（--dry-run 模式，未写盘）');
    return;
  }

  // 写盘前检查验收阈值
  // 说明：最小删边数 ≠ 含环 SCC 数。稠密 SCC 内部需要删多条边才能破开，
  // 且反平行对（A→B 且 B→A）每对至少删 1 条。实测下界 = 反平行对数（见 dry-run 输出）。
  // 因此阈值用「反平行对下界 × 1.6」作为上界 buffer，密度下限放到 1.35。
  const antiparallelLowerBound = computeAntiparallelPairs(edges);
  const removeUpperBound = Math.max(antiparallelLowerBound * 1.6, 320);
  if (removed.length > removeUpperBound) {
    console.error(`✗ 警告：删边数 ${removed.length} > 上界 ${removeUpperBound.toFixed(0)}（反平行对下界 ${antiparallelLowerBound} × 1.6）`);
    console.error('  停止写盘，请人工检查评分函数权重。');
    process.exit(2);
  }
  if (after.density < 1.35 || after.density > 1.55) {
    console.error(`✗ 警告：破环后密度 ${after.density.toFixed(3)} 不在 [1.35, 1.55] 范围内`);
    console.error('  停止写盘，请人工检查。');
    process.exit(2);
  }
  if (after.cyclicSccCount !== 0) {
    console.error(`✗ 警告：破环后仍有 ${after.cyclicSccCount} 个含环 SCC`);
    console.error('  停止写盘，请人工检查。');
    process.exit(2);
  }

  // 备份
  const ts = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${ts.getFullYear()}${pad(ts.getMonth() + 1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}${pad(ts.getSeconds())}`;
  const snapshotDir = resolve(DATA, '.snapshots', `${stamp}-breakcycles`);
  mkdirSync(snapshotDir, { recursive: true });
  copyFileSync(DEPS_PATH, resolve(snapshotDir, 'cn-dependencies.json'));
  console.log(`\n✓ 已备份原文件到 ${resolve(snapshotDir, 'cn-dependencies.json')}`);

  // 写盘：保留顶层结构，只改 dependencies 和 edgeCount
  const output = {
    ...data,
    edgeCount: kept.length,
    dependencies: kept,
  };
  writeFileSync(DEPS_PATH, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log(`✓ 已写 data/cn-dependencies.json（${kept.length} 边）`);
  console.log('下一步: node scripts/validate.mjs');
}

// 只在直接运行（非被 import）时执行 CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(e => { console.error('Fatal:', e); process.exit(1); });
}
