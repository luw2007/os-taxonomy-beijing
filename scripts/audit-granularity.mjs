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
import { createHash } from 'node:crypto';

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
const normalizeTopicName = (s) => String(s || '')
  .replace(/[·：:（）()《》“”"'、，,\s]/g, '')
  .replace(/的|与|和/g, '');
const topicIdsByName = new Map();
for (const t of cnData.topics) {
  const key = normalizeTopicName(t.name);
  if (!topicIdsByName.has(key)) topicIdsByName.set(key, []);
  topicIdsByName.get(key).push(t.id);
}

// ========== 分桶：subject|stage，默认只审初中/高中 ==========
function buildBuckets() {
  const map = new Map();
  for (const t of cnData.topics) {
    if (t.granularity === 'split-45min') continue; // 已拆节点不重复审计
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
    return `### ${t.id} ${t.name}\n来源: ${t.origin || 'unknown'}；领域: ${t.domain || 'unknown'}\n${t.description || ''}\n掌握证据:\n${ev}`;
  }).join('\n\n');
  const taskIds = new Set(task.nodes.map(t => t.id));
  const catalog = cnData.topics
    .filter(t => t.subject === subject && t.granularity !== 'split-45min' && !taskIds.has(t.id))
    .map(t => `${t.id}|${t.stage}|${t.name}`)
    .join('\n');
  return `# 任务：评估中国${stage}${subjectZh(subject)}微主题的粒度

微主题是知识图谱的最小学习单元。准绳：**一名普通${stage}学生在 1 课时（45 分钟）内能否达成该主题的全部掌握证据**。
课本章节名常被误当微主题。你必须评估掌握全部证据所需的真实教学与练习时间，不能把每条主题机械估为 30 或 45 分钟。

# 决策顺序
1. 先根据标题界定学习范围。标题若是明确的单一概念、技能、过程或作品（如「模拟信号」「结构的功能」「坚持党的全面领导」），即使描述模板化，也应根据该标题在本学段的通常教学深度评估 ok 或 split；不要自动判 review。
2. 标题若明显是章名、集合或跨多个独立目标，再检查下方目录：若**同学科、同学段**已有多个微主题完整覆盖 → covered，并列出 coveredBy；不要再创建重名子主题。
3. 未被覆盖且全部掌握证据在 45 分钟内可完成 → ok。
4. 未被覆盖、明显超过 45 分钟，且能拆成 2~5 个互不重叠、各自不超过 45 分钟的同学段学习单元 → split。
5. 只有标题本身也无法界定范围，或是否包含实操/项目无法判断时 → review。宁可送人工复核，不要伪造确定性。

# 跨年龄约束
- 其他学段目录仅用于辨别已有基础。高中主题不得拆成初中已有概念的简单复刻；子主题必须体现高中层次的深化目标。
- 只有同学段现有主题才能用于 coveredBy。其他学段节点应作为先修或跨年龄关联，不是替代品。

# 当前待评估主题
${list}

# ${subjectZh(subject)}现有主题目录（用于查重；格式 id|学段|名称）
${catalog}

# 输出 JSON
\`\`\`json
{
  "results": [
    {"id":"mtc_a","estimateMinutes":30,"verdict":"ok","reason":"为何一课时可完成"},
    {"id":"mtc_b","estimateMinutes":90,"verdict":"split","reason":"为何超时", "children":[
      {"name":"具体可考的子主题","description":"一句话学习范围","estimateMinutes":40,"evidence":["可观察证据1","证据2"]}
    ]},
    {"id":"mtc_c","estimateMinutes":90,"verdict":"covered","reason":"现有细主题已完整覆盖","coveredBy":["mtc_x","mtc_y"]},
    {"id":"mtc_d","estimateMinutes":null,"verdict":"review","reason":"描述模板化，无法可靠确定范围"}
  ]
}
\`\`\`

# 硬规则
- 每个输入 id 必须恰好出现一次。
- verdict 只能是 ok / split / covered / review。
- split 必须满足父 estimateMinutes > 45；children 为 2~5 个；每个 child 的 estimateMinutes 必须为 1~45。
- children 的 name、description、evidence 必须具体，不得使用「第一部分」「基础知识」「相关应用」等空名。
- coveredBy 必须有至少 2 个 id，且都来自上方目录、与父主题同学段；只覆盖一部分时不能判 covered。
- 不因标题含「和/与」自动拆分；判断全部掌握证据是否真的超过一课时。
- 不合并不足 45 分钟的主题。`;
}

// ========== LLM 调用（raw 缓存断点续跑） ==========
async function callLLM(prompt, slug, fingerprint) {
  const rawPath = resolve(RAW, `${slug}.json`);
  if (existsSync(rawPath)) {
    try {
      const cached = JSON.parse(readFileSync(rawPath, 'utf8'));
      if (cached.fingerprint === fingerprint && cached.model === MODEL) {
        return { results: parseResults(cached.response, slug), cached: true };
      }
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
      writeFileSync(rawPath, JSON.stringify({ slug, model: MODEL, fingerprint, prompt, response: content, ts: new Date().toISOString() }, null, 2));
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
    let verdict = ['ok', 'split', 'covered', 'review'].includes(r.verdict) ? r.verdict : 'review';
    let reason = r.reason || '';
    let children;
    if (verdict === 'split') {
      children = (r.children || []).filter(c => c.name && Number.isFinite(c.estimateMinutes)
        && c.estimateMinutes > 0 && c.estimateMinutes <= 45);
      if (!(r.estimateMinutes > 45) || children.length < 2 || children.length > 5) {
        verdict = 'review';
        reason = `协议不合规：${reason}`;
      }
      const duplicateChild = verdict === 'split' && children.find(c =>
        (topicIdsByName.get(normalizeTopicName(c.name)) || []).some(id => id !== r.id));
      if (duplicateChild) {
        verdict = 'review';
        reason = `子主题「${duplicateChild.name}」与现有节点重名，需复用或建立关联，不能重复创建。`;
      }
    }
    let coveredBy;
    if (verdict === 'covered') {
      const parent = byId.get(r.id);
      coveredBy = [...new Set(r.coveredBy || [])].filter(id => {
        const t = byId.get(id);
        return t && t.id !== parent.id && t.subject === parent.subject && t.stage === parent.stage;
      });
      if (coveredBy.length < 2) {
        verdict = 'review';
        reason = `coveredBy 不足 2 个有效同学段节点：${reason}`;
      }
    }
    out.push({
      id: r.id,
      name: byId.get(r.id).name,
      estimateMinutes: Number.isFinite(r.estimateMinutes) ? r.estimateMinutes : null,
      verdict,
      reason,
      children: verdict === 'split' ? children : undefined,
      coveredBy: verdict === 'covered' ? coveredBy : undefined,
    });
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
    const outcomes = await Promise.allSettled(batch.map(t => {
      const prompt = buildPrompt(t);
      const fingerprint = createHash('sha256').update(`${MODEL}\n${prompt}`).digest('hex');
      return callLLM(prompt, t.slug, fingerprint);
    }));
    outcomes.forEach((o, j) => {
      done++;
      const t = batch[j];
      if (o.status === 'fulfilled') {
        if (!byBucket.has(t.bucket)) byBucket.set(t.bucket, []);
        byBucket.get(t.bucket).push(...o.value.results);
        const counts = Object.fromEntries(['split', 'covered', 'review'].map(v => [v, o.value.results.filter(r => r.verdict === v).length]));
        console.log(`  [${done}/${tasks.length}] ${t.slug}: ${o.value.results.length} 评估 / ${counts.split} 需拆 / ${counts.covered} 已覆盖 / ${counts.review} 待复核${o.value.cached ? ' (缓存)' : ''}`);
      } else {
        console.log(`  [${done}/${tasks.length}] ${t.slug}: 失败 — ${o.reason.message}`);
      }
    });
  }
  mkdirSync(WORK, { recursive: true });
  for (const [key, results] of byBucket) {
    const nodes = buckets.get(key);
    const missing = nodes.filter(n => !results.some(r => r.id === n.id)).map(n => n.id);
    if (missing.length) {
      console.error(`  ✗ ${key}: 本轮漏评 ${missing.length} 条，保留已有 work 文件，不覆盖`);
      continue;
    }
    const proposedNames = new Set();
    for (const r of results) {
      if (r.verdict !== 'split') continue;
      const duplicate = r.children.find(c => proposedNames.has(normalizeTopicName(c.name)));
      if (duplicate) {
        r.verdict = 'review';
        r.reason = `同轮另一拆分已提出子主题「${duplicate.name}」，需人工决定复用关系。`;
        delete r.children;
        continue;
      }
      for (const child of r.children) proposedNames.add(normalizeTopicName(child.name));
    }
    writeFileSync(resolve(WORK, `${slugOf(key)}.json`), JSON.stringify({
      bucket: key, model: MODEL, auditedAt: new Date().toISOString(),
      total: nodes.length, evaluated: results.length, missing,
      splitCount: results.filter(r => r.verdict === 'split').length,
      coveredCount: results.filter(r => r.verdict === 'covered').length,
      reviewCount: results.filter(r => r.verdict === 'review').length,
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
  let totalSplit = 0, totalCovered = 0, totalReview = 0, totalEval = 0;
  const top = [];
  for (const f of files.sort()) {
    const w = JSON.parse(readFileSync(resolve(WORK, f), 'utf8'));
    totalSplit += w.splitCount; totalCovered += w.coveredCount || 0;
    totalReview += w.reviewCount || 0; totalEval += w.evaluated;
    const miss = w.missing?.length ? ` (漏评 ${w.missing.length})` : '';
    console.log(`  ${w.bucket}: ${w.splitCount}/${w.evaluated} 需拆，${w.coveredCount || 0} 已覆盖，${w.reviewCount || 0} 待复核${miss}`);
    for (const r of w.results) if (r.verdict === 'split') top.push({ ...r, bucket: w.bucket });
  }
  top.sort((a, b) => (b.estimateMinutes || 0) - (a.estimateMinutes || 0));
  console.log(`\n合计: ${totalSplit}/${totalEval} 需拆分，${totalCovered} 已被现有节点覆盖，${totalReview} 待人工复核。Top 10 超标:`);
  for (const r of top.slice(0, 10)) {
    console.log(`  ${r.id} ${r.name} (${r.bucket}, 约${r.estimateMinutes}min → ${r.children?.length ?? 0} 子主题)`);
  }
  console.log(`\n人工审核: 编辑 data/.granularity-work/<bucket>.json 改 verdict/children 后 --apply`);
}

// ========== 应用拆分 ==========
function apply(buckets) {
  const files = readdirSync(WORK).filter(f => f.endsWith('.json'));
  const wanted = new Set([...buckets.keys()].map(slugOf));
  const splits = []; // { topic, children }
  const appliedNames = new Set();
  for (const f of files) {
    const w = JSON.parse(readFileSync(resolve(WORK, f), 'utf8'));
    if (!wanted.has(slugOf(w.bucket))) continue;
    for (const r of w.results) {
      if (r.verdict !== 'split') continue;
      const validChildren = Array.isArray(r.children) && r.children.length >= 2 && r.children.length <= 5
        && r.children.every(c => c?.name && Number.isFinite(c.estimateMinutes)
          && c.estimateMinutes > 0 && c.estimateMinutes <= 45);
      if (!(r.estimateMinutes > 45) || !validChildren) {
        console.error(`  跳过 ${r.id}（work 文件中的拆分不满足父级 >45 分钟、2~5 子主题且各 ≤45 分钟）`);
        continue;
      }
      const topic = cnData.topics.find(t => t.id === r.id);
      if (!topic) continue;
      if (topic.splitFrom || topic.granularity === 'split-45min') {
        console.log(`  跳过 ${r.id}（已是拆分产物）`);
        continue;
      }
      const normalizedChildren = r.children.map(c => normalizeTopicName(c.name));
      if (normalizedChildren.some(name =>
        (topicIdsByName.get(name) || []).some(id => id !== r.id) || appliedNames.has(name))) {
        console.error(`  跳过 ${r.id}（work 文件中的子主题与现有节点或本次拆分重名）`);
        continue;
      }
      for (const name of normalizedChildren) appliedNames.add(name);
      splits.push({ topic, children: r.children });
    }
  }
  if (!splits.length) { console.log('无待应用的拆分（检查 --subject/--stage 与 work 文件）'); return; }

  let nextId = Math.max(...cnData.topics.map(t => +(/^mtc_(\d+)$/.exec(t.id)?.[1] || 0))) + 1;
  const depData = JSON.parse(readFileSync(depPath, 'utf8'));
  const newTopics = [];

  for (const { topic, children } of splits) {
    const splitIds = [];
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
      splitIds.push(id);
    });
    console.log(`  拆分 ${topic.id} → ${splitIds.length} 子主题: ${children.map(c => c.name).join(' / ')}`);
  }

  // 不臆造子主题间先修。原节点依赖保留在复用原 id 的首个子主题；
  // 其他子主题只通过 splitFrom 记录来源，后续由关系审计单独补边。
  cnData.topics.push(...newTopics);

  console.log(`\n拆分 ${splits.length} 条 → 新增 ${newTopics.length} 主题；依赖关系保持不变`);
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
