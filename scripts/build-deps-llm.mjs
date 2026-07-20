#!/usr/bin/env node
/**
 * build-deps-llm.mjs — 用 LLM 给 mtc_ 主题桶内节点建立语义先修依赖。
 *
 * 动机：旧版 build-cn-dependencies.mjs 只在桶内按 ageRange 连相邻节点（线性链），
 *   漏掉桶内非相邻但语义上有先修关系的节点。密度只有 0.96 边/主题（上游 2.03）。
 *   本脚本让 LLM 在桶内"看到全部节点"，补出规则漏掉的语义边。
 *
 * 三层建图（保留旧版结构，LLM 替换第 1/2 层）：
 *   L1+L2  桶内语义边（LLM）：同 subject|domain|stage 内，让模型判断先修关系
 *   L3     跨 domain 先修链（规则，沿用 DOMAIN_PREREQ_CHAINS）
 *
 * 三种运行模式：
 *   --plan      只输出分桶统计 + 前 3 桶完整 prompt，不调模型（首次必跑，审 prompt）
 *   --dry-run   调模型，raw 响应写 data/.llm-deps-work/raw/，不合并不写 cn-deps
 *   （默认）    调模型 → 合并去重 → 与规则边合并 → 全局破环 → 写 cn-dependencies.json
 *
 * 破环：三层边最终合并后，调用 break-cycles.mjs 的 breakCycles() 做全局 SCC 破环。
 *   旧版的 removeCycles 有 3 个 bug（_weak 字段未赋值/pass<10 上限/先破环后合并导致重新成环），
 *   已删除，改为只在 finalEdges 产生后破一次。
 *
 * 可选：
 *   --only-bucket <name>   只重跑指定桶（name = 桶 slug，见 --plan 输出）
 *   --concurrency <n>      并发数（默认 8）
 *
 * 环境变量（.env 或 process.env）：
 *   LLM_BASE_URL   OpenAI 兼容接口地址（如 https://open.bigmodel.cn/api/paas/v4）
 *   LLM_API_KEY    API key
 *   LLM_MODEL      模型名（如 glm-4-plus / qwen-plus / doubao-pro / moonshot-v1-32k）
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const WORK = resolve(DATA, '.llm-deps-work');

// --- 解析命令行 ---
const argv = process.argv.slice(2);
const mode = argv.includes('--plan') ? 'plan'
  : argv.includes('--dry-run') ? 'dry-run'
  : 'write';
const onlyBucketIdx = argv.indexOf('--only-bucket');
const onlyBucket = onlyBucketIdx !== -1 ? argv[onlyBucketIdx + 1] : null;
const concIdx = argv.indexOf('--concurrency');
const concurrency = concIdx !== -1 ? parseInt(argv[concIdx + 1], 10) : 8;
// --model <name> 临时覆盖 LLM_MODEL（不影响 .env）；raw 缓存按模型分目录
const modelIdx = argv.indexOf('--model');
const modelOverride = modelIdx !== -1 ? argv[modelIdx + 1] : null;
// --buckets-file <path> 批量指定要跑的桶（每行一个 slug，# 注释）
const bucketFilter = new Set();
const bfIdx = argv.indexOf('--buckets-file');
if (bfIdx !== -1 && argv[bfIdx + 1]) {
  const content = readFileSync(argv[bfIdx + 1], 'utf8');
  for (const line of content.split('\n')) {
    const s = line.trim();
    if (s && !s.startsWith('#')) bucketFilter.add(s);
  }
}

// --- 加载 .env（若存在）---
loadEnv();
const ACTIVE_MODEL = modelOverride || process.env.LLM_MODEL;
// raw 按模型分子目录，避免 glm-4-flash 和 glm-5.2 的缓存互相污染
const RAW = resolve(DATA, '.llm-deps-work', 'raw-' + (ACTIVE_MODEL || 'default').replace(/[^A-Za-z0-9.-]/g, '_'));

const cnData = JSON.parse(readFileSync(resolve(DATA, 'cn-topics.json'), 'utf8'));
const topics = cnData.topics;

// ========== 滑窗参数 ==========
const WINDOW = 25;   // 单次喂给 LLM 的最大节点数
const STEP = 15;     // 滑窗步长
const BIG_BUCKET_THRESHOLD = 30; // 超过此值触发滑窗

// ========== 分桶 ==========
// 一级 subject|domain（已归一化）→ 二级 stage → 节点列表（按 age 排序）
function buildBuckets() {
  const map = new Map(); // "subject|domain|stage" → [topics]
  for (const t of topics) {
    const key = `${t.subject}|${t.domain}|${t.stage}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  // 按 age 排序
  for (const arr of map.values()) {
    arr.sort((a, b) => (a.ageRangeStart || 0) - (b.ageRangeStart || 0)
      || (a.ageRangeEnd || 0) - (b.ageRangeEnd || 0));
  }
  return map;
}

// 把大桶切成滑窗子任务
// 返回 [{ bucket, slug, nodes, windowInfo }]
function buildTasks(buckets) {
  const tasks = [];
  let idx = 0;
  for (const [bucketKey, nodes] of buckets) {
    idx++;
    const slug = bucketKey.replace(/[|&]/g, '_').replace(/\s+/g, '-');
    // --only-bucket 单桶 / --buckets-file 多桶（每行一个 slug，支持 # 注释）
    // 匹配桶基础名（不含 __wN 后缀），前缀匹配命中所有滑窗子任务
    if (onlyBucket || bucketFilter.size > 0) {
      const candidates = onlyBucket
        ? [onlyBucket.replace(/__w\d+$/, '')]
        : [...bucketFilter];
      const matches = candidates.some(b =>
        slug === b || slug === b.replace(/__w\d+$/, '') || String(idx) === b);
      if (!matches) continue;
    }

    if (nodes.length <= BIG_BUCKET_THRESHOLD) {
      // 不滑窗，整桶一个任务（但只有 1 个节点时无法建边，跳过）
      if (nodes.length >= 2) {
        tasks.push({ bucket: bucketKey, slug: `${slug}__w0`, nodes, windowInfo: null });
      }
      continue;
    }
    // 滑窗
    let w = 0;
    for (let start = 0; start < nodes.length; start += STEP) {
      const window = nodes.slice(start, start + WINDOW);
      if (window.length < 2) break;
      tasks.push({
        bucket: bucketKey,
        slug: `${slug}__w${w}`,
        nodes: window,
        windowInfo: { windowIdx: w, start, end: start + WINDOW, total: nodes.length },
      });
      w++;
    }
  }
  return tasks;
}

// ========== Prompt 构造 ==========
function buildPrompt(task) {
  const { bucket, nodes, windowInfo } = task;
  const [subject, domain, stage] = bucket.split('|');
  const scopeHint = windowInfo
    ? `（大桶滑窗第 ${windowInfo.windowIdx + 1} 段，共 ${Math.ceil(windowInfo.total / STEP)} 段，本段 ${nodes.length}/${windowInfo.total} 个节点，按年龄已排序）`
    : `（共 ${nodes.length} 个节点，按年龄已排序）`;

  const nodeList = nodes.map((t, i) => {
    const ev = (t.evidence || []).slice(0, 2).join('；');
    return `${i + 1}. [${t.id}] ${t.name}（age ${t.ageRangeStart}-${t.ageRangeEnd}）\n   ${(t.description || '').slice(0, 120)}${ev ? '\n   证据: ' + ev : ''}`;
  }).join('\n');

  return `# 任务：判断中国 K12 微主题之间的先修依赖关系

## 背景
你是中国 ${stage}（${subjectZh(subject)}）的${domainZh(subject, domain)}课程专家。
下面给出同一知识领域、同学段的一组微主题，请判断它们之间的"先修关系"：
**学 topicId 这个主题前，需要先掌握 prerequisiteId 这个主题。**

## 关键区分（最重要）
- **先修关系 ≠ 相关关系**。两者都相关，但只有"不学 A 就没法学 B"或"教学顺序上 A 必然在前"才是先修。
- 反例（相关但【不】是先修，不要连线）：
  - "加法运算" ↔ "减法运算"（互逆，可平行学习）
  - "分数运算" ↔ "小数运算"（都是运算技能，无严格先后）
  - "古诗阅读" ↔ "现代诗阅读"（文体并列，无先修）
- 正例（是先修，应连线）：
  - "分数概念" → "分数运算"（不先理解分数是什么，没法做分数运算）
  - "声母韵母" → "拼音拼读"（先认字母才能拼读）
  - "力的概念" → "牛顿第二定律"（概念是定律的基础）

## 方向规则
- prerequisiteId = 基础的、在前学的、更简单的
- topicId = 进阶的、在后学的、更复杂的
- 通常 age 小的、抽象程度低的更靠前

## 节点列表${scopeHint}
${nodeList}

## 输出要求
输出**严格 JSON**（不要 markdown 代码块、不要多余文字）：
\`\`\`json
{
  "edges": [
    {"topicId": "mtc_xxx", "prerequisiteId": "mtc_yyy", "strength": "hard", "reason": "简短说明为什么是先修（一句话）"}
  ]
}
\`\`\`
- strength: "hard" = 必须先学否则无法进行；"soft" = 建议先学有助理解
- 只输出你有把握的边，宁缺毋滥。没有先修关系就输出 {"edges": []}
- 两个 id 都必须来自上面节点列表
- 不要输出自依赖（topicId === prerequisiteId）`;
}

function subjectZh(s) {
  try { return require(resolve(DATA, 'domains.zh.json')).subjects[s] || s; } catch { return s; }
}
function domainZh(s, d) {
  try { return require(resolve(DATA, 'domains.zh.json')).domains[`${s} / ${d}`] || d; } catch { return d; }
}

// ========== LLM 调用 ==========
async function callLLM(prompt, slug) {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = ACTIVE_MODEL;
  if (!baseUrl || !apiKey || !model) {
    throw new Error('缺少 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL 环境变量');
  }
  const url = baseUrl.replace(/\/$/, '') + '/chat/completions';
  const lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
      }
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      // 保存原始响应
      mkdirSync(RAW, { recursive: true });
      writeFileSync(resolve(RAW, `${slug}.json`), JSON.stringify({
        slug, model, prompt, response: content, raw: data, ts: new Date().toISOString(),
      }, null, 2));
      return parseEdges(content, slug);
    } catch (e) {
      const isLast = attempt === 2;
      console.error(`  ✗ ${slug} 第 ${attempt + 1} 次失败: ${e.message}${isLast ? '（放弃）' : '，重试...'}`);
      if (isLast) throw e;
      await sleep(1000 * Math.pow(2, attempt));
    }
  }
  return [];
}

// 从 LLM 响应解析边
function parseEdges(content, slug) {
  let parsed;
  try {
    // 容错：有些模型即便要求 json_object 也会包 ```json
    const cleaned = content.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error(`  ✗ ${slug} JSON 解析失败，跳过。原始: ${content.slice(0, 150)}`);
    return [];
  }
  const arr = parsed.edges || parsed.dependencies || [];
  return arr.filter(e => e.topicId && e.prerequisiteId && e.topicId !== e.prerequisiteId);
}

// ========== 并发控制 ==========
async function runAll(tasks, mode) {
  if (mode === 'plan') return {}; // plan 模式不调模型
  const results = {}; // slug → edges[]
  let done = 0;
  const total = tasks.length;
  // 简单分批并发
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const outcomes = await Promise.allSettled(batch.map(async (t) => {
      const rawPath = resolve(RAW, `${t.slug}.json`);
      // dry-run 且已有缓存则复用（支持断点续跑）
      if (existsSync(rawPath)) {
        try {
          const cached = JSON.parse(readFileSync(rawPath, 'utf8'));
          return { slug: t.slug, edges: parseEdges(cached.response, t.slug), cached: true };
        } catch { /* 缓存损坏，重跑 */ }
      }
      const edges = await callLLM(buildPrompt(t), t.slug);
      return { slug: t.slug, edges };
    }));
    for (const o of outcomes) {
      done++;
      if (o.status === 'fulfilled') {
        results[o.value.slug] = o.value.edges;
        const cnt = o.value.edges.length;
        process.stdout.write(`  [${done}/${total}] ${o.value.slug}: ${cnt} 边${o.value.cached ? ' (缓存)' : ''}\n`);
      } else {
        results[batch[outcomes.indexOf(o)].slug] = [];
        process.stdout.write(`  [${done}/${total}] ${batch[outcomes.indexOf(o)].slug}: 失败 0 边\n`);
      }
    }
  }
  return results;
}

// ========== 合并 + 去重 + 环检测 ==========
function mergeAndDedupe(results, validIds) {
  // key: "topicId->prerequisiteId" → { votes: {hard:n, soft:n}, reasons: [] }
  // validIds: Set，端点不在集合里的边是 LLM 幻觉，直接丢弃
  let hallucinated = 0;
  const agg = new Map();
  for (const [slug, edges] of Object.entries(results)) {
    for (const e of edges) {
      if (validIds && (!validIds.has(e.topicId) || !validIds.has(e.prerequisiteId))) {
        hallucinated++;
        continue;
      }
      const key = `${e.topicId}->${e.prerequisiteId}`;
      if (!agg.has(key)) agg.set(key, { topicId: e.topicId, prerequisiteId: e.prerequisiteId, votes: { hard: 0, soft: 0 }, reasons: [] });
      const entry = agg.get(key);
      entry.votes[e.strength] = (entry.votes[e.strength] || 0) + 1;
      if (e.reason) entry.reasons.push(e.reason);
    }
  }
  if (hallucinated > 0) {
    console.log(`  幻觉过滤: 丢弃 ${hallucinated} 条端点不存在的边`);
  }
  const merged = [];
  for (const entry of agg.values()) {
    const strength = entry.votes.hard >= entry.votes.soft ? 'hard' : 'soft';
    merged.push({
      topicId: entry.topicId,
      prerequisiteId: entry.prerequisiteId,
      strength,
      reason: entry.reasons[0] || null,
    });
  }
  return merged;
}

// ========== 跨子领域错边过滤 ==========
// 问题：部分 domain 桶把不同艺术/体育门类塞进同桶（如 Art/Appreciation 混了
// 音乐和美术节点），LLM 忠实地在桶内建边，产出跨门类的伪先修（如"美术→音乐"）。
// 这些是 domain 分类的缺陷，不是 LLM 的错；此处用 name prefix 精确剔除。
//
// name prefix = 中文"·"前的子领域标记（如"音乐·""美术·""体操·""球类·"）
// 平行子领域对：两端分属这些对之一，则判定为跨门类伪先修，剔除。
const PARALLEL_SUBFIELD_PAIRS = [
  // 艺术门类互不先修
  ['美术', '音乐'], ['美术', '戏曲'], ['美术', '舞蹈'],
  ['音乐', '戏曲'], ['音乐', '舞蹈'],
  // 体育项目互不先修
  ['体操', '球类'], ['体操', '田径'], ['球类', '田径'],
  ['武术', '球类'], ['武术', '体操'], ['武术', '田径'],
  ['游泳', '球类'], ['游泳', '体操'], ['游泳', '田径'],
];
const PARALLEL_SET = new Set(PARALLEL_SUBFIELD_PAIRS.flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));

function getNamePrefix(name) {
  if (!name) return null;
  const m = name.match(/^([^·\[（(]+)[·]/);
  return m ? m[1].trim() : null;
}

function filterCrossSubfieldEdges(edges, idToName) {
  const kept = [];
  const removed = [];
  for (const e of edges) {
    const pa = getNamePrefix(idToName.get(e.topicId));
    const pb = getNamePrefix(idToName.get(e.prerequisiteId));
    if (pa && pb && pa !== pb && PARALLEL_SET.has(`${pa}|${pb}`)) {
      removed.push({ ...e, removedReason: `跨平行子领域 ${pb}↔${pa}` });
    } else {
      kept.push(e);
    }
  }
  return { kept, removed };
}

// ========== 规则边（L1/L2 ageRange 相邻链 + L3 跨 domain 先修链）==========
import { DOMAIN_PREREQ_CHAINS, buildRuleEdges, buildAgeChainEdges } from './_rule-deps.mjs';
import { breakCycles } from './break-cycles.mjs';

// ========== 主流程 ==========
async function main() {
  const buckets = buildBuckets();
  const tasks = buildTasks(buckets);

  console.log('=== 分桶统计 ===');
  console.log(`  一级桶 (subject|domain): ${new Set([...buckets.keys()].map(k => k.split('|').slice(0, 2).join('|'))).size}`);
  console.log(`  二级桶 (subject|domain|stage): ${buckets.size}`);
  const bigBuckets = [...buckets.entries()].filter(([_, n]) => n.length > BIG_BUCKET_THRESHOLD);
  console.log(`  大桶 (>${BIG_BUCKET_THRESHOLD} 节点，触发滑窗): ${bigBuckets.length}`);
  console.log(`  总任务数 (含滑窗子任务): ${tasks.length}`);
  console.log(`  模式: ${mode}${onlyBucket ? ` | --only-bucket ${onlyBucket}` : ''}\n`);

  if (mode === 'plan') {
    // 只打印前 3 个任务的完整 prompt
    console.log('=== 前 3 个任务的 prompt 预览 ===\n');
    for (const t of tasks.slice(0, 3)) {
      console.log(`──────── 桶: ${t.bucket} (${t.nodes.length} 节点) slug=${t.slug} ────────`);
      console.log(buildPrompt(t));
      console.log('\n');
    }
    console.log('（--plan 模式，未调模型。审查 prompt 后用 --dry-run 跑全量）');
    return;
  }

  // 检查环境变量
  if (!process.env.LLM_BASE_URL || !process.env.LLM_API_KEY || !ACTIVE_MODEL) {
    console.error('✗ 缺少环境变量。请在 .env 或环境里设置 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL');
    console.error('  参考 .env.example');
    process.exit(1);
  }
  console.log(`模型: ${ACTIVE_MODEL} @ ${process.env.LLM_BASE_URL}${modelOverride ? ' (--model 覆盖)' : ''}`);
  console.log(`并发: ${concurrency}\n`);

  const t0 = Date.now();
  const results = await runAll(tasks, mode);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);

  // 合并（含幻觉过滤：LLM 可能编造 prompt 里没有的 id）
  const validIds = new Set(topics.map(t => t.id));
  const llmEdges = mergeAndDedupe(results, validIds);
  console.log(`\n=== LLM 建图结果 (${dt}s) ===`);
  console.log(`  raw 任务: ${Object.keys(results).length}`);
  let rawEdgeCount = 0;
  for (const e of Object.values(results)) rawEdgeCount += e.length;
  console.log(`  raw 边总数(含滑窗重复): ${rawEdgeCount}`);
  console.log(`  去重后 LLM 边: ${llmEdges.length}`);

  // 跨子领域错边过滤：剔除 LLM 硬凑的跨门类伪先修（如美术→音乐、体操→球类）
  // 这些是 domain 分类把不同门类塞进同桶导致的，先于环检测处理
  const idToName = new Map(topics.map(t => [t.id, t.name]));
  const { kept: filteredEdges, removed: crossRemoved } = filterCrossSubfieldEdges(llmEdges, idToName);
  console.log(`  跨子领域过滤: 丢弃 ${crossRemoved.length} 条`);

  // 规则边 L1+L2：桶内 ageRange 相邻链（教学顺序，与 LLM 语义边互补）
  const ageChainEdges = buildAgeChainEdges(topics);
  console.log(`  ageRange 链规则边(L1+L2): ${ageChainEdges.length}`);

  // 规则边 L3：跨 domain 先修链
  const ruleEdges = buildRuleEdges(topics);
  console.log(`  跨 domain 规则边(L3): ${ruleEdges.length}`);

  // 合并三层：LLM 语义边 + ageRange 链 + 跨 domain 链
  // 优先级：LLM > L3 > L1/L2（同一条边若多源都有，保留 reason 最详细的）
  const all = [...ageChainEdges, ...ruleEdges, ...filteredEdges];
  const finalMap = new Map();
  for (const e of all) {
    const key = `${e.topicId}->${e.prerequisiteId}`;
    if (!finalMap.has(key)) finalMap.set(key, e);
  }
  let finalEdges = [...finalMap.values()];
  console.log(`  合并后(破环前): ${finalEdges.length} (密度 ${(finalEdges.length / topics.length).toFixed(2)} 边/主题)`);

  // 全局破环（必须在三层边最终合并后执行，旧版先破环再合并会导致重新成环）
  const { kept: acyclicEdges, removed: cycleRemoved } = breakCycles(finalEdges);
  finalEdges = acyclicEdges;
  console.log(`  全局破环: 丢弃 ${cycleRemoved.length} 条（最终 ${finalEdges.length} 边，密度 ${(finalEdges.length / topics.length).toFixed(2)}）`);

  if (mode === 'dry-run') {
    // 给每条边标注来源，便于审查
    const llmKeys = new Set(filteredEdges.map(e => `${e.topicId}->${e.prerequisiteId}`));
    const annotated = finalEdges.map(e => {
      const key = `${e.topicId}->${e.prerequisiteId}`;
      const sources = [];
      if (llmKeys.has(key)) sources.push('LLM');
      if (ageChainEdges.some(a => `${a.topicId}->${a.prerequisiteId}` === key)) sources.push('L1/L2');
      if (ruleEdges.some(r => `${r.topicId}->${r.prerequisiteId}` === key)) sources.push('L3');
      return { ...e, sources };
    });
    mkdirSync(WORK, { recursive: true });
    writeFileSync(resolve(WORK, 'dry-run-summary.json'), JSON.stringify({
      mode, model: ACTIVE_MODEL, ts: new Date().toISOString(),
      taskCount: tasks.length, rawEdgeCount, llmEdgesAfterDedupe: llmEdges.length,
      cycleRemoved: cycleRemoved.length,
      ageChainEdges: ageChainEdges.length, ruleEdges: ruleEdges.length,
      finalEdges: finalEdges.length,
      density: +(finalEdges.length / topics.length).toFixed(3),
      // 存全量边（带来源标注），便于写盘前审查
      edges: annotated,
    }, null, 2));
    console.log(`\n（--dry-run 模式，已写 ${WORK}/dry-run-summary.json（含全量 ${annotated.length} 边），未覆盖 cn-dependencies.json）`);
    return;
  }

  // 写盘
  const output = {
    version: '1.2.0-zh.0',
    upstreamVersion: 'v1',
    locale: 'zh-CN',
    edgeCount: finalEdges.length,
    note: 'mtc_ 主题知识依赖 DAG。LLM 逐桶语义建图(桶内先修) + 规则跨domain先修链。详见 scripts/build-deps-llm.mjs。',
    dependencies: finalEdges,
  };
  writeFileSync(resolve(DATA, 'cn-dependencies.json'), JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log('\n✓ 已写 data/cn-dependencies.json');
  console.log('下一步: node scripts/checksum.mjs && node scripts/validate.mjs');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function loadEnv() {
  const envPath = resolve(ROOT, '.env');
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
