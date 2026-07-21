#!/usr/bin/env node
/**
 * audit-granularity.mjs — 微主题粒度审计与拆分（初中/高中笼统主题优化机制）。
 *
 * 背景：小学 mtc_ 已优化；初中/高中 mtc_ 来自课本目录，很多一条实为一章内容。
 * 准绳：一个微主题 = 普通学生 1 课时（45 分钟）内可达成其掌握证据。
 *   超过 45 分钟 → 拆分为 2~5 个子主题；不足 45 分钟 → 不处理（不合并）。
 *
 * 两阶段：
 *   审计（默认）：按 subject|stage 分桶调 LLM，评估每条 estimateMinutes + verdict，
 *     拆分草案写 data/.granularity-work/<bucket>.json（人工可改后再 apply）。
 *   应用（--apply）：读 work 文件执行拆分，写回 cn-topics.json + cn-dependencies.json。
 *
 * 用法：
 *   node scripts/audit-granularity.mjs --plan                     # 只看分桶 + prompt 样本
 *   node scripts/audit-granularity.mjs --subject History --stage 初中   # 审计单桶
 *   node scripts/audit-granularity.mjs                            # 审计全部初中+高中
 *   node scripts/audit-granularity.mjs --report                   # 汇总已审计结果
 *   node scripts/audit-granularity.mjs --apply --subject History --stage 初中 [--dry-run]
 *
 * LLM：deepseek-v4-flash（DEEPSEEK_API_KEY），raw 缓存断点续跑。
 * 写回约定（沿用 split-compound-topics.mjs）：
 *   原条目保留 id 改写为第一个子主题；其余子主题分配新 mtc_ 递增 id，splitFrom 记来源；
 *   子主题链加 reviewStatus=machine 顺序依赖；原条目出边移到链尾，入边留链头。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const WORK = resolve(DATA, '.granularity-work');
const RAW = resolve(WORK, 'raw');

// --- CLI ---
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f) => { const i = argv.indexOf(f); return i !== -1 ? argv[i + 1] : null; };
const mode = has('--plan') ? 'plan' : has('--report') ? 'report' : has('--apply') ? 'apply' : 'audit';
const dryRun = has('--dry-run');
const filterSubject = opt('--subject');
const filterStage = opt('--stage');
const concurrency = parseInt(opt('--concurrency') || '4', 10);

// --- LLM 配置：固定 deepseek-v4-flash ---
const API_KEY = process.env.DEEPSEEK_API_KEY;
const MODEL = 'deepseek-v4-flash';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';

// --- 数据 ---
const cnPath = resolve(DATA, 'cn-topics.json');
const depPath = resolve(DATA, 'cn-dependencies.json');
const cnData = JSON.parse(readFileSync(cnPath, 'utf8'));
const domainMap = JSON.parse(readFileSync(resolve(DATA, 'domains.zh.json'), 'utf8'));
const subjectZh = (s) => domainMap.subjects[s] || s;

// ========== 分桶：subject|stage，默认只审初中/高中 ==========
function buildBuckets() {
  const map = new Map();
  for (const t of cnData.topics) {
    if (t.stage === '小学' && !filterStage) continue; // 小学已优化，默认跳过
    if (filterSubject && t.subject !== filterSubject) continue;
    if (filterStage && t.stage !== filterStage) continue;
    const key = `${t.subject}|${t.stage}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(t);
  }
  return map;
}
const slugOf = (key) => key.replace(/[|&]/g, '_').replace(/\s+/g, '-');

// 桶内按 20 条一批切分（评估是逐条独立判断，批次只为控制 prompt 长度）
const BATCH = 20;
function buildTasks(buckets) {
  const tasks = [];
  for (const [key, nodes] of buckets) {
    const slug = slugOf(key);
    for (let i = 0; i < nodes.length; i += BATCH) {
      tasks.push({ bucket: key, slug: `${slug}__b${i / BATCH}`, nodes: nodes.slice(i, i + BATCH) });
    }
  }
  return tasks;
}

// ========== Prompt ==========
function buildPrompt(task) {
  const [subject, stage] = task.bucket.split('|');
  const list = task.nodes.map(t => {
    const ev = (t.evidence || []).map(e => `  - ${e}`).join('\n');
    return `### ${t.id} ${t.name}\n${t.description || ''}\n掌握证据:\n${ev}`;
  }).join('\n\n');
  return `# 任务：评估中国${stage}${subjectZh(subject)}微主题的粒度

微主题是知识图谱的最小学习单元。准绳：**一名普通${stage}学生在 1 课时（45 分钟）内能否达成该主题的全部掌握证据**。
课本章节名常被误当微主题（如「百家争鸣」实为一章，含多学派思想+历史意义，远超 1 课时）。

对下面每个微主题独立判断：

${list}

输出 JSON：
\`\`\`json
{
  "results": [
    {
      "id": "mtc_xxx",
      "estimateMinutes": 90,
      "verdict": "split",
      "children": [
        {"name": "子主题名", "description": "一句话描述学什么", "evidence": ["可观察的掌握证据1", "证据2"]}
      ]
    },
    {"id": "mtc_yyy", "estimateMinutes": 30, "verdict": "ok"}
  ]
}
\`\`\`

规则：
- estimateMinutes：普通学生达成全部掌握证据的粗估分钟数
- verdict："ok"（≤45 分钟，含不足 45 分钟的，一律不动）或 "split"（明显超过 45 分钟）
- split 时 children 给 2~5 个子主题，按学习先后顺序排列，每个子主题自身必须 ≤45 分钟
- 子主题 name 具体可考（「孔子与儒家思想」而非「思想流派一」）；evidence 是可观察行为
- 拿不准的判 ok，宁缺毋滥
- 每个输入 id 都必须出现在 results 中`;
}

// ========== LLM 调用（raw 缓存断点续跑） ==========
async function callLLM(prompt, slug) {
  const rawPath = resolve(RAW, `${slug}.json`);
  if (existsSync(rawPath)) {
    try {
      const cached = JSON.parse(readFileSync(rawPath, 'utf8'));
      return { results: parseResults(cached.response, slug), cached: true };
    } catch { /* 缓存损坏，重跑 */ }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${API_KEY}` },
        body: JSON.stringify({
          model: MODEL,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      mkdirSync(RAW, { recursive: true });
      writeFileSync(rawPath, JSON.stringify({ slug, model: MODEL, prompt, response: content, ts: new Date().toISOString() }, null, 2));
      return { results: parseResults(content, slug), cached: false };
    } catch (e) {
      if (attempt === 2) throw e;
      console.error(`  ✗ ${slug} 第 ${attempt + 1} 次失败: ${e.message}，重试...`);
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

function parseResults(content, slug) {
  let parsed;
  try {
    parsed = JSON.parse(content.replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim());
  } catch {
    console.error(`  ✗ ${slug} JSON 解析失败: ${content.slice(0, 120)}`);
    return [];
  }
  const byId = new Map(cnData.topics.map(t => [t.id, t]));
  const out = [];
  for (const r of parsed.results || []) {
    if (!r.id || !byId.has(r.id)) continue;
    if (r.verdict === 'split') {
      const kids = (r.children || []).filter(c => c.name);
      if (kids.length < 2 || kids.length > 5) { r.verdict = 'ok'; r.children = undefined; } // 拆分不合规 → 降级 ok
      else r.children = kids;
    }
    out.push({ id: r.id, name: byId.get(r.id).name, estimateMinutes: r.estimateMinutes ?? null, verdict: r.verdict === 'split' ? 'split' : 'ok', children: r.children });
  }
  return out;
}

// ========== 审计主流程 ==========
async function audit(buckets) {
  if (!API_KEY) { console.error('✗ 缺少 DEEPSEEK_API_KEY'); process.exit(1); }
  const tasks = buildTasks(buckets);
  console.log(`审计 ${buckets.size} 桶 / ${tasks.length} 批（模型 ${MODEL}，并发 ${concurrency}）`);
  const byBucket = new Map(); // bucket key → results[]
  let done = 0;
  for (let i = 0; i < tasks.length; i += concurrency) {
    const batch = tasks.slice(i, i + concurrency);
    const outcomes = await Promise.allSettled(batch.map(t => callLLM(buildPrompt(t), t.slug)));
    outcomes.forEach((o, j) => {
      done++;
      const t = batch[j];
      if (o.status === 'fulfilled') {
        if (!byBucket.has(t.bucket)) byBucket.set(t.bucket, []);
        byBucket.get(t.bucket).push(...o.value.results);
        const splits = o.value.results.filter(r => r.verdict === 'split').length;
        console.log(`  [${done}/${tasks.length}] ${t.slug}: ${o.value.results.length} 评估 / ${splits} 需拆${o.value.cached ? ' (缓存)' : ''}`);
      } else {
        console.log(`  [${done}/${tasks.length}] ${t.slug}: 失败 — ${o.reason.message}`);
      }
    });
  }
  mkdirSync(WORK, { recursive: true });
  for (const [key, results] of byBucket) {
    const nodes = buckets.get(key);
    const missing = nodes.filter(n => !results.some(r => r.id === n.id)).map(n => n.id);
    writeFileSync(resolve(WORK, `${slugOf(key)}.json`), JSON.stringify({
      bucket: key, model: MODEL, auditedAt: new Date().toISOString(),
      total: nodes.length, evaluated: results.length, missing,
      splitCount: results.filter(r => r.verdict === 'split').length,
      results,
    }, null, 2));
  }
  report();
}

// ========== 汇总报告 ==========
function report() {
  if (!existsSync(WORK)) { console.log('无审计结果（先跑审计）'); return; }
  const files = readdirSync(WORK).filter(f => f.endsWith('.json'));
  if (!files.length) { console.log('无审计结果（先跑审计）'); return; }
  console.log('\n=== 粒度审计汇总 ===');
  let totalSplit = 0, totalEval = 0;
  const top = [];
  for (const f of files.sort()) {
    const w = JSON.parse(readFileSync(resolve(WORK, f), 'utf8'));
    totalSplit += w.splitCount; totalEval += w.evaluated;
    const miss = w.missing?.length ? ` (漏评 ${w.missing.length})` : '';
    console.log(`  ${w.bucket}: ${w.splitCount}/${w.evaluated} 需拆${miss}`);
    for (const r of w.results) if (r.verdict === 'split') top.push({ ...r, bucket: w.bucket });
  }
  top.sort((a, b) => (b.estimateMinutes || 0) - (a.estimateMinutes || 0));
  console.log(`\n合计: ${totalSplit}/${totalEval} 需拆分。Top 10 超标:`);
  for (const r of top.slice(0, 10)) {
    console.log(`  ${r.id} ${r.name} (${r.bucket}, 约${r.estimateMinutes}min → ${r.children.length} 子主题)`);
  }
  console.log(`\n人工审核: 编辑 data/.granularity-work/<bucket>.json 改 verdict/children 后 --apply`);
}

// ========== 应用拆分 ==========
function apply(buckets) {
  const files = readdirSync(WORK).filter(f => f.endsWith('.json'));
  const wanted = new Set([...buckets.keys()].map(slugOf));
  const splits = []; // { topic, children }
  for (const f of files) {
    const w = JSON.parse(readFileSync(resolve(WORK, f), 'utf8'));
    if (!wanted.has(slugOf(w.bucket))) continue;
    for (const r of w.results) {
      if (r.verdict !== 'split') continue;
      const topic = cnData.topics.find(t => t.id === r.id);
      if (!topic) continue;
      if (topic.splitFrom) { console.log(`  跳过 ${r.id}（已是拆分产物）`); continue; }
      splits.push({ topic, children: r.children });
    }
  }
  if (!splits.length) { console.log('无待应用的拆分（检查 --subject/--stage 与 work 文件）'); return; }

  let nextId = Math.max(...cnData.topics.map(t => +(/^mtc_(\d+)$/.exec(t.id)?.[1] || 0))) + 1;
  const depData = JSON.parse(readFileSync(depPath, 'utf8'));
  const newTopics = [], newDeps = [], idRemap = new Map(); // 原 id → 链尾 id（出边重接用）

  for (const { topic, children } of splits) {
    const chain = [];
    children.forEach((c, i) => {
      const isFirst = i === 0;
      const id = isFirst ? topic.id : `mtc_${nextId++}`;
      if (isFirst) {
        // 原条目改写为第一个子主题
        topic.name = c.name;
        topic.description = c.description || topic.description;
        topic.evidence = c.evidence?.length ? c.evidence : topic.evidence;
        topic.assessmentPrompt = `让 {{name}} 展示：${(c.evidence || topic.evidence || [])[0] || c.name}`;
        topic.granularity = 'split-45min';
      } else {
        newTopics.push({
          ...topic, id, name: c.name,
          description: c.description || '',
          evidence: c.evidence || [],
          assessmentPrompt: `让 {{name}} 展示：${(c.evidence || [])[0] || c.name}`,
          splitFrom: topic.id, granularity: 'split-45min',
        });
      }
      chain.push(id);
    });
    // 链内顺序依赖
    for (let i = 1; i < chain.length; i++) {
      newDeps.push({
        topicId: chain[i], prerequisiteId: chain[i - 1], strength: 'hard',
        reason: `粒度拆分链: ${children[i - 1].name} → ${children[i].name}`,
        reviewStatus: 'machine',
      });
    }
    idRemap.set(topic.id, chain[chain.length - 1]);
    console.log(`  拆分 ${topic.id} → ${chain.length} 子主题: ${children.map(c => c.name).join(' / ')}`);
  }

  // 原条目的出边（作为他人先修）移到链尾；入边（自身的先修）留在链头（id 未变，无需动）
  let rewired = 0;
  for (const d of depData.dependencies) {
    const tail = idRemap.get(d.prerequisiteId);
    if (tail && tail !== d.prerequisiteId) { d.prerequisiteId = tail; rewired++; }
  }
  depData.dependencies.push(...newDeps);
  cnData.topics.push(...newTopics);

  console.log(`\n拆分 ${splits.length} 条 → 新增 ${newTopics.length} 主题、${newDeps.length} 链内依赖，重接出边 ${rewired} 条`);
  if (dryRun) { console.log('（--dry-run，未写盘）'); return; }
  depData.edgeCount = depData.dependencies.length;
  if (typeof cnData.topicCount === 'number') cnData.topicCount = cnData.topics.length;
  writeFileSync(cnPath, JSON.stringify(cnData, null, 2) + '\n');
  writeFileSync(depPath, JSON.stringify(depData, null, 2) + '\n');
  console.log(`已写盘。后续: node scripts/validate.mjs && node scripts/checksum.mjs`);
}

// ========== 入口 ==========
const buckets = buildBuckets();
if (mode === 'plan') {
  console.log(`分桶（subject|stage，共 ${buckets.size} 桶）:`);
  for (const [key, nodes] of [...buckets].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${key}: ${nodes.length} 条 (${Math.ceil(nodes.length / BATCH)} 批)`);
  }
  const tasks = buildTasks(buckets);
  if (tasks.length) {
    console.log(`\n--- Prompt 样本（${tasks[0].slug}，截断） ---`);
    console.log(buildPrompt(tasks[0]).slice(0, 1500));
  }
} else if (mode === 'report') {
  report();
} else if (mode === 'apply') {
  apply(buckets);
} else {
  await audit(buckets);
}
