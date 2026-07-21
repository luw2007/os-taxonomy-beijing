#!/usr/bin/env node
/**
 * backfill-split-relations.mjs — 为粒度拆分产生的零度子主题增量回填关系（实验用）。
 *
 * 只处理 splitFrom 子主题；DeepSeek 只在父节点邻居、兄弟、同桶近邻和相邻学段
 * 候选中判断 prerequisite / related / none。核心 DAG 只追加 prerequisite，绝不覆盖、
 * 改写或删除旧边；related 仅保留在 gitignored work 文件。
 *
 *   node scripts/backfill-split-relations.mjs --plan [--subject Biology] [--stage 高中]
 *   node scripts/backfill-split-relations.mjs [--subject Biology] [--limit 10]
 *   node scripts/backfill-split-relations.mjs --apply --subject Biology --dry-run
 *   node scripts/backfill-split-relations.mjs --apply --subject Biology
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const WORK = resolve(DATA, '.split-relations-work');
const RAW = resolve(WORK, 'raw');
const MODEL = 'deepseek-v4-flash';
const API_URL = 'https://api.deepseek.com/v1/chat/completions';
const MIN_CONFIDENCE = 0.8;
const STAGE_ORDER = new Map([['小学', 0], ['初中', 1], ['高中', 2]]);

const grams = (value) => {
  const text = String(value || '').replace(/[\s（）()·、,，。:：；;《》“”"']/g, '');
  const out = new Set();
  for (let i = 0; i < text.length - 1; i++) out.add(text.slice(i, i + 2));
  return out;
};
const similarity = (a, b) => {
  const ga = grams(`${a.name}${a.description || ''}`);
  const gb = grams(`${b.name}${b.description || ''}`);
  if (!ga.size || !gb.size) return 0;
  let common = 0;
  for (const g of ga) if (gb.has(g)) common++;
  return common / Math.sqrt(ga.size * gb.size);
};

export function buildCandidates(target, topics, dependencies, options = {}) {
  const localLimit = options.localLimit ?? 8;
  const crossStageLimit = options.crossStageLimit ?? 4;
  const byId = new Map(topics.map(t => [t.id, t]));
  const found = new Map();
  const add = (id, source, score = 1) => {
    if (!id || id === target.id || !byId.has(id)) return;
    if (!found.has(id)) found.set(id, { id, sources: [], score: 0 });
    const item = found.get(id);
    if (!item.sources.includes(source)) item.sources.push(source);
    item.score = Math.max(item.score, score);
  };

  const parent = byId.get(target.splitFrom);
  const validParent = parent && parent.subject === target.subject && parent.stage === target.stage;
  if (validParent) add(target.splitFrom, 'split-parent');
  if (validParent) {
    for (const edge of dependencies) {
      if (edge.topicId === target.splitFrom) add(edge.prerequisiteId, 'parent-edge');
      if (edge.prerequisiteId === target.splitFrom) add(edge.topicId, 'parent-edge');
    }
  }
  for (const topic of topics) {
    if (topic.splitFrom === target.splitFrom && topic.id !== target.id
      && topic.subject === target.subject && topic.stage === target.stage) add(topic.id, 'sibling');
  }

  const local = topics
    .filter(t => t.id !== target.id && t.subject === target.subject
      && t.domain === target.domain && t.stage === target.stage)
    .map(t => ({ id: t.id, score: similarity(target, t) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, localLimit);
  for (const item of local) add(item.id, 'local', item.score);

  const targetStage = STAGE_ORDER.get(target.stage);
  const crossStage = topics
    .filter(t => t.id !== target.id && t.subject === target.subject && t.domain === target.domain
      && STAGE_ORDER.has(t.stage) && Math.abs(STAGE_ORDER.get(t.stage) - targetStage) === 1)
    .map(t => ({ id: t.id, score: similarity(target, t) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, crossStageLimit);
  for (const item of crossStage) add(item.id, 'cross-stage', item.score);

  return [...found.values()]
    .map(item => ({ ...item, topic: byId.get(item.id) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

export function parseRelations(content, allowedPairs, validIds, minConfidence = MIN_CONFIDENCE) {
  let parsed;
  try {
    parsed = JSON.parse(String(content).replace(/^```json?\s*/i, '').replace(/```\s*$/, '').trim());
  } catch {
    return { prerequisites: [], related: [], rejected: [{ reason: 'invalid-json' }] };
  }
  const prerequisites = [], related = [], rejected = [];
  for (const relation of parsed.relations || []) {
    const pair = `${relation.topicId}|${relation.prerequisiteId}`;
    const valid = relation.topicId && relation.prerequisiteId
      && relation.topicId !== relation.prerequisiteId
      && validIds.has(relation.topicId) && validIds.has(relation.prerequisiteId)
      && allowedPairs.has(pair);
    if (!valid) { rejected.push({ ...relation, rejectedReason: 'outside-candidates' }); continue; }
    if (relation.type === 'related') {
      related.push(relation);
      continue;
    }
    if (relation.type !== 'prerequisite' || !(relation.confidence >= minConfidence) || !relation.reason) {
      if (relation.type !== 'none') rejected.push({ ...relation, rejectedReason: 'low-confidence-or-invalid' });
      continue;
    }
    prerequisites.push({
      topicId: relation.topicId,
      prerequisiteId: relation.prerequisiteId,
      strength: relation.strength === 'hard' ? 'hard' : 'soft',
      confidence: relation.confidence,
      reason: relation.reason,
    });
  }
  return { prerequisites, related, rejected };
}

const edgeKey = e => `${e.topicId}|${e.prerequisiteId}`;
const reachable = (from, to, edges) => {
  const adj = new Map();
  for (const edge of edges) {
    if (!adj.has(edge.prerequisiteId)) adj.set(edge.prerequisiteId, []);
    adj.get(edge.prerequisiteId).push(edge.topicId);
  }
  const seen = new Set([from]), stack = [from];
  while (stack.length) {
    const node = stack.pop();
    if (node === to) return true;
    for (const next of adj.get(node) || []) if (!seen.has(next)) { seen.add(next); stack.push(next); }
  }
  return false;
};

export function selectAppendableEdges(existingEdges, proposals, validIds) {
  const appended = [], rejected = [];
  const current = existingEdges.map(edge => ({ ...edge }));
  const keys = new Set(current.map(edgeKey));
  for (const proposal of proposals) {
    const key = edgeKey(proposal);
    const reverse = `${proposal.prerequisiteId}|${proposal.topicId}`;
    if (!validIds.has(proposal.topicId) || !validIds.has(proposal.prerequisiteId)
      || proposal.topicId === proposal.prerequisiteId) {
      rejected.push({ ...proposal, rejectedReason: 'invalid-endpoint' });
    } else if (keys.has(key)) {
      rejected.push({ ...proposal, rejectedReason: 'duplicate' });
    } else if (keys.has(reverse)) {
      rejected.push({ ...proposal, rejectedReason: 'reverse-conflict' });
    } else if (reachable(proposal.topicId, proposal.prerequisiteId, current)) {
      rejected.push({ ...proposal, rejectedReason: 'cycle' });
    } else {
      const edge = {
        topicId: proposal.topicId,
        prerequisiteId: proposal.prerequisiteId,
        strength: proposal.strength === 'hard' ? 'hard' : 'soft',
        reason: proposal.reason,
        reviewStatus: 'machine',
      };
      appended.push(edge);
      current.push(edge);
      keys.add(key);
    }
  }
  return { appended, rejected, finalEdges: [...existingEdges, ...appended] };
}

function buildPrompt(target, candidates) {
  const candidateText = candidates.map(({ topic, sources }) =>
    `- ${topic.id} | ${topic.stage} | ${topic.name} | 来源:${sources.join(',')}\n  ${topic.description || ''}`)
    .join('\n');
  return `# 任务：只判断一个新增微主题与候选节点的关系

目标节点：
${target.id} | ${target.stage} | ${target.name}\n${target.description || ''}
掌握证据：${(target.evidence || []).join('；')}

候选节点：
${candidateText}

输出 JSON：{"relations":[{"topicId":"后学节点","prerequisiteId":"先学节点","type":"prerequisite|related|none","strength":"hard|soft","confidence":0.0,"reason":"一句话"}]}

硬规则：
- 只能使用目标节点和候选节点的 id，且每条关系必须包含目标节点。
- prerequisite 表示不掌握先学节点，会无法或明显难以达成后学节点的掌握证据；教材顺序、同章、相似、同父拆分都不等于先修。
- hard 仅用于缺少先学节点就无法完成后学节点核心证据的情况；只是提供背景、比较对象或帮助理解时必须标 soft。
- 兄弟节点默认 related 或 none；只有能说清具体知识障碍时才输出 prerequisite。比较两个平行类别不代表其中一个是另一个的先修。
- 低把握输出 none。related 仅用于实验记录，不进入依赖 DAG。
- 不要为凑数量输出关系；可以返回空数组。`;
}

async function callDeepSeek(prompt, slug, apiKey) {
  const fingerprint = createHash('sha256').update(`${MODEL}\n${prompt}`).digest('hex');
  const rawPath = resolve(RAW, `${slug}.json`);
  if (existsSync(rawPath)) {
    try {
      const cached = JSON.parse(readFileSync(rawPath, 'utf8'));
      if (cached.fingerprint === fingerprint && cached.model === MODEL) return { content: cached.response, cached: true };
    } catch { /* rerun corrupt cache */ }
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0, response_format: { type: 'json_object' } }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || '';
      mkdirSync(RAW, { recursive: true });
      writeFileSync(rawPath, JSON.stringify({ slug, model: MODEL, fingerprint, prompt, response: content, ts: new Date().toISOString() }, null, 2));
      return { content, cached: false };
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 1000 * 2 ** attempt));
    }
  }
}

function parseArgs(argv) {
  const opt = flag => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  return {
    mode: argv.includes('--plan') ? 'plan' : argv.includes('--apply') ? 'apply' : 'audit',
    dryRun: argv.includes('--dry-run'), subject: opt('--subject'), stage: opt('--stage'),
    limit: Number(opt('--limit') || 0), concurrency: Number(opt('--concurrency') || 4),
  };
}

function loadData() {
  return {
    topicsDoc: JSON.parse(readFileSync(resolve(DATA, 'cn-topics.json'), 'utf8')),
    depsDoc: JSON.parse(readFileSync(resolve(DATA, 'cn-dependencies.json'), 'utf8')),
  };
}

function targetNodes(topics, dependencies, args) {
  const degree = new Map(topics.map(t => [t.id, 0]));
  for (const edge of dependencies) {
    degree.set(edge.topicId, (degree.get(edge.topicId) || 0) + 1);
    degree.set(edge.prerequisiteId, (degree.get(edge.prerequisiteId) || 0) + 1);
  }
  let targets = topics.filter(t => t.splitFrom && (degree.get(t.id) || 0) === 0
    && (!args.subject || t.subject === args.subject) && (!args.stage || t.stage === args.stage));
  targets.sort((a, b) => a.subject.localeCompare(b.subject) || a.stage.localeCompare(b.stage) || a.id.localeCompare(b.id));
  if (args.limit > 0) targets = targets.slice(0, args.limit);
  return targets;
}

async function audit(topics, dependencies, args) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('缺少 DEEPSEEK_API_KEY');
  const targets = targetNodes(topics, dependencies, args);
  const validIds = new Set(topics.map(t => t.id));
  const grouped = new Map();
  let done = 0;
  for (let i = 0; i < targets.length; i += args.concurrency) {
    const batch = targets.slice(i, i + args.concurrency);
    const outcomes = await Promise.allSettled(batch.map(async target => {
      const candidates = buildCandidates(target, topics, dependencies);
      const allowed = new Set();
      for (const candidate of candidates) {
        allowed.add(`${target.id}|${candidate.id}`);
        allowed.add(`${candidate.id}|${target.id}`);
      }
      const prompt = buildPrompt(target, candidates);
      const raw = await callDeepSeek(prompt, target.id, apiKey);
      return { target, candidates, ...parseRelations(raw.content, allowed, validIds), cached: raw.cached };
    }));
    outcomes.forEach((outcome, index) => {
      done++;
      const target = batch[index];
      if (outcome.status !== 'fulfilled') {
        console.error(`  [${done}/${targets.length}] ${target.id} 失败: ${outcome.reason.message}`);
        return;
      }
      const result = outcome.value;
      const key = `${target.subject}|${target.stage}`;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push(result);
      console.log(`  [${done}/${targets.length}] ${target.id} ${target.name}: ${result.prerequisites.length} 先修 / ${result.related.length} 相关${result.cached ? ' (缓存)' : ''}`);
    });
  }
  mkdirSync(WORK, { recursive: true });
  const allTargets = targetNodes(topics, dependencies, { ...args, limit: 0 });
  for (const [bucket, results] of grouped) {
    const expected = targets.filter(t => `${t.subject}|${t.stage}` === bucket);
    if (results.length !== expected.length) {
      console.error(`  ✗ ${bucket}: 结果不完整，保留旧 work 文件`);
      continue;
    }
    const slug = bucket.replace(/[|&]/g, '_').replace(/\s+/g, '-');
    const workPath = resolve(WORK, `${slug}.json`);
    let priorTargets = [];
    if (existsSync(workPath)) {
      try { priorTargets = JSON.parse(readFileSync(workPath, 'utf8')).targets || []; } catch { /* replace corrupt work */ }
    }
    const currentTargets = results.map(r => ({
      id: r.target.id, name: r.target.name,
      candidates: r.candidates.map(c => ({ id: c.id, name: c.topic.name, stage: c.topic.stage, sources: c.sources })),
      prerequisites: r.prerequisites, related: r.related, rejected: r.rejected,
    }));
    const currentIds = new Set(currentTargets.map(t => t.id));
    const mergedTargets = [...priorTargets.filter(t => !currentIds.has(t.id)), ...currentTargets]
      .sort((a, b) => a.id.localeCompare(b.id));
    const allBucketIds = new Set(allTargets.filter(t => `${t.subject}|${t.stage}` === bucket).map(t => t.id));
    const complete = allBucketIds.size > 0 && [...allBucketIds].every(id => mergedTargets.some(t => t.id === id));
    writeFileSync(workPath, JSON.stringify({
      bucket, model: MODEL, auditedAt: new Date().toISOString(), complete, targets: mergedTargets,
    }, null, 2));
  }
  console.log(`\n审计完成：${targets.length} 个零度 splitFrom 节点；work=${WORK}`);
}

export function missingTargetIds(expectedTargets, works) {
  const covered = new Set(works.flatMap(work => (work.targets || []).map(target => target.id)));
  return expectedTargets.map(target => target.id).filter(id => !covered.has(id)).sort();
}

function apply(topics, depsDoc, args) {
  if (!existsSync(WORK)) throw new Error('无 work 目录，请先运行审计');
  const expectedTargets = targetNodes(topics, depsDoc.dependencies, { ...args, limit: 0 });
  const selectedWorks = [];
  const proposals = [];
  for (const file of readdirSync(WORK).filter(f => f.endsWith('.json'))) {
    const work = JSON.parse(readFileSync(resolve(WORK, file), 'utf8'));
    const [subject, stage] = work.bucket.split('|');
    if ((args.subject && subject !== args.subject) || (args.stage && stage !== args.stage)) continue;
    selectedWorks.push(work);
    for (const target of work.targets || []) {
      for (const proposal of target.prerequisites || []) {
        if (proposal.topicId === target.id || proposal.prerequisiteId === target.id) proposals.push(proposal);
        else console.error(`  跳过 ${edgeKey(proposal)}（不包含 work 目标 ${target.id}）`);
      }
    }
  }
  if (!args.dryRun) {
    const missing = missingTargetIds(expectedTargets, selectedWorks);
    if (missing.length) throw new Error(`筛选范围 work 缺少 ${missing.length} 个目标；先完成审计（如 ${missing.slice(0, 3).join(', ')}）`);
  }
  const selected = selectAppendableEdges(depsDoc.dependencies, proposals, new Set(topics.map(t => t.id)));
  console.log(`候选先修 ${proposals.length}：可追加 ${selected.appended.length}，拒绝 ${selected.rejected.length}`);
  const reasons = {};
  for (const item of selected.rejected) reasons[item.rejectedReason] = (reasons[item.rejectedReason] || 0) + 1;
  if (Object.keys(reasons).length) console.log('拒绝原因:', reasons);
  if (args.dryRun) { console.log('（--dry-run，未写盘）'); return; }
  if (!selected.appended.length) { console.log('无新边，不写盘'); return; }
  depsDoc.dependencies = selected.finalEdges;
  depsDoc.edgeCount = selected.finalEdges.length;
  writeFileSync(resolve(DATA, 'cn-dependencies.json'), JSON.stringify(depsDoc, null, 2) + '\n');
  console.log(`✓ 仅在尾部追加 ${selected.appended.length} 条 machine 边；旧 ${selected.finalEdges.length - selected.appended.length} 条边未改动`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { topicsDoc, depsDoc } = loadData();
  const targets = targetNodes(topicsDoc.topics, depsDoc.dependencies, args);
  if (args.mode === 'plan') {
    const byBucket = {};
    for (const target of targets) {
      const key = `${target.subject}|${target.stage}`;
      byBucket[key] = (byBucket[key] || 0) + 1;
    }
    console.log(`待回填零度 splitFrom 节点: ${targets.length}`);
    for (const [bucket, count] of Object.entries(byBucket)) console.log(`  ${bucket}: ${count}`);
    for (const target of targets.slice(0, 3)) {
      const candidates = buildCandidates(target, topicsDoc.topics, depsDoc.dependencies);
      console.log(`\n${target.id} ${target.name}: ${candidates.length} 候选`);
      console.log(candidates.map(c => `  ${c.id} ${c.topic.name} [${c.sources.join(',')}]`).join('\n'));
    }
  } else if (args.mode === 'apply') {
    apply(topicsDoc.topics, depsDoc, args);
  } else {
    await audit(topicsDoc.topics, depsDoc.dependencies, args);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Fatal: ${error.message}`); process.exit(1); });
}
