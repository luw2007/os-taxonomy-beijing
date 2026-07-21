#!/usr/bin/env node
/**
 * validate.mjs — 依赖零的完整性检查。
 *
 * 校验内容：
 *   1. 各文件的声明计数与实际长度一致
 *   2. topics.zh.json 的每个 mt_ ID 都存在于上游 topics.json
 *   3. evidence 数组长度与上游对齐（逐条翻译，不能增减）
 *   4. cnStandards 引用必须能在 cn-curriculum-standards.json 中解析
 *   5. dependencies.zh.json 的每个 topicId/prerequisiteId 存在于上游
 *   6. 课标文件的 codes-only 不变量（textIncluded 必须为 false，无 data 字段）
 *   7. manifest.json 的 SHA-256 校验和
 *   8. cn-dependencies 的 DAG 不变量（无环）—— 默认开启，硬约束
 *   9. cn-dependencies 的 reviewStatus 字段合法性 + 覆盖率报告
 *
 *   node scripts/validate.mjs [--upstream <path>] [--no-dag]
 *     --upstream  上游 os-taxonomy 仓库的路径（默认 ../os-taxonomy）
 *     --no-dag    跳过 DAG 断言（仅紧急情况，正常不应使用）
 */

import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { publicationProblems } from './publication-safety.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');

// --- 解析 --upstream / --no-dag / --publish 参数 -------------------------
let upstreamPath = resolve(ROOT, '..', 'os-taxonomy');
const upIdx = process.argv.indexOf('--upstream');
if (upIdx !== -1 && process.argv[upIdx + 1]) upstreamPath = process.argv[upIdx + 1];
const skipDag = process.argv.includes('--no-dag');
const publishMode = process.argv.includes('--publish');

const UPSTREAM_DATA = resolve(upstreamPath, 'data');
const hasUpstream = existsSync(resolve(UPSTREAM_DATA, 'topics.json'));

const load = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
const bytesOf = (dir, name) => readFileSync(resolve(dir, name));

const errors = [];
const check = (cond, msg) => { if (!cond) errors.push(msg); };

// --- 加载中文数据 ---------------------------------------------------------
const topicsZh = load(DATA, 'topics.zh.json');
const depsZh = load(DATA, 'dependencies.zh.json');
const clustersZh = load(DATA, 'clusters.zh.json');
const cnStandards = load(DATA, 'cn-curriculum-standards.json');
const manifest = load(DATA, 'manifest.json');

// 中国特有微主题（可选文件——不存在则跳过校验）
const cnOriginPath = resolve(DATA, 'cn-topics.json');
const cnOriginTopics = existsSync(cnOriginPath) ? load(DATA, 'cn-topics.json') : null;

// 中国特有微主题依赖（可选文件）
const cnDepsPath = resolve(DATA, 'cn-dependencies.json');
const cnDeps = existsSync(cnDepsPath) ? load(DATA, 'cn-dependencies.json') : null;

// --- 加载上游（如可用） ---------------------------------------------------
let upstreamTopics = null;
let upstreamTopicIds = new Set();
let upstreamEvidenceLens = new Map();
if (hasUpstream) {
  upstreamTopics = load(UPSTREAM_DATA, 'topics.json');
  for (const t of upstreamTopics.topics) {
    upstreamTopicIds.add(t.id);
    upstreamEvidenceLens.set(t.id, t.evidence.length);
  }
}

// --- 1. 声明计数 ----------------------------------------------------------
check(topicsZh.topicCount === topicsZh.topics.length,
  `topics.zh: topicCount ${topicsZh.topicCount} != ${topicsZh.topics.length}`);
check(depsZh.edgeCount === depsZh.dependencies.length,
  `dependencies.zh: edgeCount ${depsZh.edgeCount} != ${depsZh.dependencies.length}`);
check(clustersZh.clusterCount === clustersZh.clusters.length,
  `clusters.zh: clusterCount ${clustersZh.clusterCount} != ${clustersZh.clusters.length}`);
check(cnStandards.curriculumCount === cnStandards.curricula.length,
  `cn-curriculum: curriculumCount != length`);

// --- 2/3. 中文 topic 完整性 -----------------------------------------------
const zhTopicIds = new Set();
for (const t of topicsZh.topics) {
  check(typeof t.id === 'string' && t.id.startsWith('mt_'), `topic id malformed: ${t.id}`);
  check(typeof t.description === 'string' && t.description.length > 0, `topic ${t.id}: empty description`);
  check(Array.isArray(t.evidence), `topic ${t.id}: evidence must be array`);
  if (zhTopicIds.has(t.id)) errors.push(`duplicate zh topic id: ${t.id}`);
  zhTopicIds.add(t.id);

  // 上游对齐检查
  if (hasUpstream) {
    check(upstreamTopicIds.has(t.id),
      `topic ${t.id}: not found in upstream topics.json — ID 漂移，请检查同步`);
    const upLen = upstreamEvidenceLens.get(t.id);
    if (upLen !== undefined) {
      check(t.evidence.length === upLen,
        `topic ${t.id}: evidence length ${t.evidence.length} != upstream ${upLen}（逐条翻译，数量必须一致）`);
    }
  }
}

// --- 4. cnStandards 引用完整性 --------------------------------------------
const cnStandardKeys = new Set();
for (const c of cnStandards.curricula) {
  check(c.textIncluded === false,
    `curriculum ${c.slug}: textIncluded must be false（codes-only 不变量）`);
  check(c.topicCount === c.topics.length,
    `curriculum ${c.slug}: topicCount != length`);
  check(cnStandards.codesOnlySources.includes(c.slug),
    `curriculum ${c.slug}: missing from codesOnlySources`);
  for (const s of c.topics) {
    check(s.key === `${c.slug}:${s.code}`, `standard key mismatch: ${s.key}`);
    check(!('data' in s),
      `codes-only source ${c.slug} leaks verbatim text at ${s.key}（禁止收录课标原文）`);
    if (cnStandardKeys.has(s.key)) errors.push(`duplicate cn standard key: ${s.key}`);
    cnStandardKeys.add(s.key);
  }
}

let danglingCnRefs = 0;
for (const t of topicsZh.topics) {
  for (const key of (t.cnStandards ?? [])) {
    if (!cnStandardKeys.has(key)) {
      danglingCnRefs++;
      if (danglingCnRefs <= 5) errors.push(`topic ${t.id} references unknown cnStandard ${key}`);
    }
  }
}
if (danglingCnRefs > 5) errors.push(`…and ${danglingCnRefs - 5} more unknown cnStandard references`);

// --- 4b. 中国特有微主题（cn-origin）完整性 --------------------------------
const VALID_TYPES = new Set(['CONCEPTUAL', 'PROCEDURAL', 'REPRESENTATIONAL', 'LANGUAGE', 'META']);
const VALID_NODE_KINDS = new Set(['concept', 'text', 'skill']);
const VALID_REVIEW_STATUS = new Set(['machine', 'reviewed', 'rejected']);
const VALID_ORIGINS = new Set(['cn_only', 'cross_domain', 'upstream_adapt', 'progression', 'textbook']);
const cnOriginIds = new Set();
if (cnOriginTopics) {
  check(cnOriginTopics.topicCount === cnOriginTopics.topics.length,
    `cn-topics: topicCount ${cnOriginTopics.topicCount} != ${cnOriginTopics.topics.length}`);
  for (const t of cnOriginTopics.topics) {
    check(typeof t.id === 'string' && t.id.startsWith('mtc_'), `cn-origin topic id malformed: ${t.id}`);
    check(VALID_TYPES.has(t.type), `cn-origin topic ${t.id}: invalid type "${t.type}"`);
    // nodeKind 必须合法（缺失不报错但统计，便于渐进回填）
    if (t.nodeKind !== undefined) {
      check(VALID_NODE_KINDS.has(t.nodeKind),
        `cn-origin topic ${t.id}: invalid nodeKind "${t.nodeKind}"（合法值：concept/text/skill）`);
    }
    // centrality 校验：concept/skill 应有数值；text 应为 null
    if (t.centrality !== null && t.centrality !== undefined) {
      check(typeof t.centrality === 'number' && t.centrality >= 0 && t.centrality <= 1,
        `cn-origin topic ${t.id}: centrality ${t.centrality} must be in [0,1] or null`);
    }
    check(VALID_ORIGINS.has(t.origin), `cn-origin topic ${t.id}: invalid origin "${t.origin}"`);
    check(typeof t.subject === 'string' && t.subject.length > 0, `cn-origin topic ${t.id}: empty subject`);
    check(typeof t.domain === 'string' && t.domain.length > 0, `cn-origin topic ${t.id}: empty domain`);
    check(typeof t.description === 'string' && t.description.length > 0, `cn-origin topic ${t.id}: empty description`);
    check(Array.isArray(t.evidence) && t.evidence.length > 0, `cn-origin topic ${t.id}: evidence must be non-empty array`);
    check(typeof t.ageRangeStart === 'number' && typeof t.ageRangeEnd === 'number',
      `cn-origin topic ${t.id}: ageRange must be numbers`);
    check(t.ageRangeStart <= t.ageRangeEnd, `cn-origin topic ${t.id}: ageRangeStart > ageRangeEnd`);
    if (cnOriginIds.has(t.id)) errors.push(`duplicate cn-origin topic id: ${t.id}`);
    cnOriginIds.add(t.id);
    // cnStandards 引用必须能解析（不校验上游对齐——设计上无上游对应）
    for (const key of (t.cnStandards ?? [])) {
      check(cnStandardKeys.has(key),
        `cn-origin topic ${t.id} references unknown cnStandard ${key}`);
    }
    if (t.status === 'covered') {
      check(Array.isArray(t.coveredBy) && t.coveredBy.length >= 2,
        `cn-origin topic ${t.id}: covered status requires at least two coveredBy ids`);
      for (const id of (t.coveredBy || [])) check(cnOriginIds.has(id) || cnOriginTopics.topics.some(topic => topic.id === id),
        `cn-origin topic ${t.id}: coveredBy references unknown topic ${id}`);
    }
  }
}

// --- 4c. 中国特有微主题依赖（cn-dependencies）完整性 ----------------------
if (cnDeps) {
  check(cnDeps.edgeCount === cnDeps.dependencies.length,
    `cn-dependencies: edgeCount ${cnDeps.edgeCount} != ${cnDeps.dependencies.length}`);
  const cnDepSeen = new Set();
  const reviewCounts = { machine: 0, reviewed: 0, rejected: 0 };
  // DAG 校验用的邻接表（仅当 !skipDag）
  const dagAdj = new Map();
  const dagNodes = new Set();
  const batchIds = new Set((cnDeps.generationBatches || []).map(batch => batch.id));
  for (const d of cnDeps.dependencies) {
    check(typeof d.topicId === 'string' && d.topicId.startsWith('mtc_'),
      `cn-dep: topicId malformed: ${d.topicId}`);
    check(typeof d.prerequisiteId === 'string' && d.prerequisiteId.startsWith('mtc_'),
      `cn-dep: prerequisiteId malformed: ${d.prerequisiteId}`);
    check(d.topicId !== d.prerequisiteId, `cn-dep: self-dependency on ${d.topicId}`);
    check(d.strength === 'hard' || d.strength === 'soft', `cn-dep: bad strength ${d.strength}`);
    // reviewStatus 合法性（缺失视为 machine，向后兼容）
    const rs = d.reviewStatus ?? 'machine';
    check(VALID_REVIEW_STATUS.has(d.reviewStatus || 'machine'),
      `cn-dep ${d.topicId}->${d.prerequisiteId}: illegal reviewStatus "${d.reviewStatus}"`);
    check(!(d.reviewStatus === 'reviewed' && d.rescopeRequired === true),
      `cn-dep ${d.topicId}->${d.prerequisiteId}: reviewed edge cannot have rescopeRequired`);
    reviewCounts[rs] = (reviewCounts[rs] || 0) + 1;
    // 两端必须在 cn-topics 中存在
    check(cnOriginIds.has(d.topicId), `cn-dep: topicId ${d.topicId} not in cn-topics`);
    check(cnOriginIds.has(d.prerequisiteId), `cn-dep: prerequisiteId ${d.prerequisiteId} not in cn-topics`);
    if (d.rescopeRequired === true) {
      check(rs === 'machine', `cn-dep ${d.topicId}->${d.prerequisiteId}: rescopeRequired edge must be machine`);
      check(typeof d.rescopeBatchId === 'string' && d.rescopeBatchId.length > 0,
        `cn-dep ${d.topicId}->${d.prerequisiteId}: rescopeRequired edge missing rescopeBatchId`);
    }
    if (d.previousReviewStatus !== undefined) {
      check(d.previousReviewStatus === 'reviewed' && d.rescopeRequired === true,
        `cn-dep ${d.topicId}->${d.prerequisiteId}: previousReviewStatus requires active rescopeRequired`);
    }
    if (d.generationBatchId !== undefined) {
      check(batchIds.has(d.generationBatchId),
        `cn-dep ${d.topicId}->${d.prerequisiteId}: unknown generationBatchId ${d.generationBatchId}`);
    }
    if (d.ageRegression === true) {
      const topic = cnOriginTopics?.topics.find(item => item.id === d.topicId);
      const prerequisite = cnOriginTopics?.topics.find(item => item.id === d.prerequisiteId);
      check(rs === 'machine' && topic?.stage === prerequisite?.stage && prerequisite?.ageRangeStart > topic?.ageRangeStart,
        `cn-dep ${d.topicId}->${d.prerequisiteId}: invalid ageRegression flag`);
    }
    const hasReviewAudit = d.reviewedBy !== undefined || d.reviewedAt !== undefined || d.reviewNote !== undefined;
    if (hasReviewAudit) {
      check((rs === 'reviewed' || rs === 'rejected') && typeof d.reviewedBy === 'string' && d.reviewedBy.length > 0
        && typeof d.reviewedAt === 'string' && d.reviewedAt.length > 0,
      `cn-dep ${d.topicId}->${d.prerequisiteId}: incomplete human review audit metadata`);
    }
    const key = `${d.topicId}->${d.prerequisiteId}`;
    if (cnDepSeen.has(key)) errors.push(`cn-dep: duplicate edge ${key}`);
    cnDepSeen.add(key);
    // 收集 DAG 结构（rejected 边不计入图，因为它们不会展示）
    if (rs !== 'rejected') {
      if (!dagAdj.has(d.prerequisiteId)) dagAdj.set(d.prerequisiteId, []);
      dagAdj.get(d.prerequisiteId).push(d.topicId);
      dagNodes.add(d.topicId);
      dagNodes.add(d.prerequisiteId);
    }
  }

  // --- 4c-2. DAG 不变量：cn-dependencies 必须无环 --------------------------
  // 用 Kahn 拓扑排序独立验证（不依赖 break-cycles.mjs，防止实现 bug 自欺）
  if (!skipDag) {
    const indeg = new Map();
    for (const n of dagNodes) indeg.set(n, 0);
    for (const [, succ] of dagAdj) for (const w of succ) indeg.set(w, (indeg.get(w) || 0) + 1);
    const queue = [];
    for (const n of dagNodes) if (indeg.get(n) === 0) queue.push(n);
    let sorted = 0;
    while (queue.length) {
      const v = queue.shift();
      sorted++;
      for (const w of dagAdj.get(v) || []) {
        indeg.set(w, indeg.get(w) - 1);
        if (indeg.get(w) === 0) queue.push(w);
      }
    }
    const inCycle = dagNodes.size - sorted;
    check(inCycle === 0,
      `cn-deps DAG 破坏：${inCycle} 个节点处于环中（拓扑排序无法排出）。运行 node scripts/break-cycles.mjs 修复。`);
  }

  // 审核覆盖率（信息性，不阻断）
  const total = cnDeps.dependencies.length;
  const reviewedPct = total > 0 ? (100 * reviewCounts.reviewed / total).toFixed(1) : '0';
  console.log(`  📋 审核覆盖率: reviewed ${reviewCounts.reviewed} / machine ${reviewCounts.machine} / rejected ${reviewCounts.rejected}（已审核 ${reviewedPct}%）`);
}

// --- 4d. 上游 mt_ → 中国 mtc_ 桥接依赖完整性 -----------------------------
const cnBridgeDepsPath = resolve(DATA, 'cn-bridge-dependencies.json');
const cnBridgeDeps = existsSync(cnBridgeDepsPath) ? load(DATA, 'cn-bridge-dependencies.json') : null;
if (cnBridgeDeps) {
  check(cnBridgeDeps.edgeCount === cnBridgeDeps.dependencies.length,
    `cn-bridge: edgeCount ${cnBridgeDeps.edgeCount} != ${cnBridgeDeps.dependencies.length}`);
  const bridgeSeen = new Set();
  for (const d of cnBridgeDeps.dependencies) {
    check(d.topicId !== d.prerequisiteId, `cn-bridge: self-dependency on ${d.topicId}`);
    check(d.strength === 'hard' || d.strength === 'soft', `cn-bridge: bad strength ${d.strength}`);
    // reviewStatus 合法性（与 cn-deps 一致）
    if (d.reviewStatus !== undefined) {
      check(VALID_REVIEW_STATUS.has(d.reviewStatus),
        `cn-bridge ${d.topicId}->${d.prerequisiteId}: illegal reviewStatus "${d.reviewStatus}"`);
    }
    const bridgeReviewStatus = d.reviewStatus ?? 'machine';
    check(!(d.reviewStatus === 'reviewed' && d.rescopeRequired === true),
      `cn-bridge ${d.topicId}->${d.prerequisiteId}: reviewed edge cannot have rescopeRequired`);
    if (d.rescopeRequired === true) {
      check(bridgeReviewStatus === 'machine',
        `cn-bridge ${d.topicId}->${d.prerequisiteId}: rescopeRequired edge must be machine`);
      check(typeof d.rescopeBatchId === 'string' && d.rescopeBatchId.length > 0,
        `cn-bridge ${d.topicId}->${d.prerequisiteId}: rescopeRequired edge missing rescopeBatchId`);
    }
    if (d.previousReviewStatus !== undefined) {
      check(d.previousReviewStatus === 'reviewed' && d.rescopeRequired === true,
        `cn-bridge ${d.topicId}->${d.prerequisiteId}: previousReviewStatus requires active rescopeRequired`);
    }
    const hasBridgeReviewAudit = d.reviewedBy !== undefined || d.reviewedAt !== undefined || d.reviewNote !== undefined;
    if (hasBridgeReviewAudit) {
      check((bridgeReviewStatus === 'reviewed' || bridgeReviewStatus === 'rejected')
        && typeof d.reviewedBy === 'string' && d.reviewedBy.length > 0
        && typeof d.reviewedAt === 'string' && d.reviewedAt.length > 0,
      `cn-bridge ${d.topicId}->${d.prerequisiteId}: incomplete human review audit metadata`);
    }
    // topicId 必须是 mtc_ 且在 cn-topics 中存在
    check(typeof d.topicId === 'string' && d.topicId.startsWith('mtc_'),
      `cn-bridge: topicId must be mtc_, got ${d.topicId}`);
    check(cnOriginIds.has(d.topicId), `cn-bridge: topicId ${d.topicId} not in cn-topics`);
    // prerequisiteId 必须是 mt_ 且在上游中存在
    check(typeof d.prerequisiteId === 'string' && d.prerequisiteId.startsWith('mt_'),
      `cn-bridge: prerequisiteId must be mt_, got ${d.prerequisiteId}`);
    if (hasUpstream) {
      check(upstreamTopicIds.has(d.prerequisiteId),
        `cn-bridge: prerequisiteId ${d.prerequisiteId} not in upstream topics`);
    }
    const key = `${d.topicId}->${d.prerequisiteId}`;
    if (bridgeSeen.has(key)) errors.push(`cn-bridge: duplicate edge ${key}`);
    bridgeSeen.add(key);
  }
}
if (publishMode && cnOriginTopics && cnDeps) {
  for (const problem of publicationProblems(
    cnOriginTopics.topics, cnDeps.dependencies, cnBridgeDeps?.dependencies,
  )) errors.push(`publish: ${problem}`);
}

// --- 5. 依赖引用完整性 ----------------------------------------------------
for (const d of depsZh.dependencies) {
  check(d.topicId !== d.prerequisiteId, `self-dependency on ${d.topicId}`);
  check(d.strength === 'hard' || d.strength === 'soft', `bad strength ${d.strength}`);
  if (hasUpstream) {
    check(upstreamTopicIds.has(d.topicId),
      `dependency references unknown upstream topicId ${d.topicId}`);
    check(upstreamTopicIds.has(d.prerequisiteId),
      `dependency references unknown upstream prerequisiteId ${d.prerequisiteId}`);
  }
}

// --- 6. 上游版本一致性 ----------------------------------------------------
if (hasUpstream) {
  const upstreamVersion = upstreamTopics.version;
  check(topicsZh.upstreamVersion === upstreamVersion,
    `upstreamVersion mismatch: zh says "${topicsZh.upstreamVersion}", upstream is "${upstreamVersion}"`);
  check(depsZh.upstreamVersion === upstreamVersion,
    `dependencies.zh upstreamVersion != upstream (${depsZh.upstreamVersion} vs ${upstreamVersion})`);
}

// --- 7. manifest 校验和 ---------------------------------------------------
for (const [name, meta] of Object.entries(manifest.files ?? {})) {
  const bytes = bytesOf(DATA, name);
  const actual = createHash('sha256').update(bytes).digest('hex');
  // manifest 中的 bytes/sha256 可能为空（首次未生成），跳过空值
  if (meta.sha256) {
    check(actual === meta.sha256, `checksum mismatch for ${name}`);
  }
  if (meta.bytes) {
    check(bytes.length === meta.bytes, `byte size mismatch for ${name}: ${bytes.length} != ${meta.bytes}`);
  }
}

// --- 报告 -----------------------------------------------------------------
if (errors.length) {
  console.error(`✗ ${errors.length} problem(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
const upstreamNote = hasUpstream ? ' + upstream alignment OK' : ' (上游未找到，跳过对齐检查)';
const cnOriginNote = cnOriginTopics ? `, ${cnOriginTopics.topics.length} cn-origin topics` : '';
const cnDepsNote = cnDeps ? `, ${cnDeps.dependencies.length} cn-deps` : '';
console.log(
  `✓ valid — ${topicsZh.topics.length} zh topics${cnOriginNote}, ${depsZh.dependencies.length} zh deps${cnDepsNote}, ` +
  `${clustersZh.clusters.length} zh clusters, ${cnStandardKeys.size} cn standards${upstreamNote}.`,
);
if (!hasUpstream) {
  console.log(`  💡 上游路径: ${upstreamPath} 不存在。克隆 os-taxonomy 到此路径以启用对齐检查。`);
}
