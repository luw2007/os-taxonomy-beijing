#!/usr/bin/env node
/**
 * serve.mjs — 零依赖本地知识浏览器。
 *
 * 启动一个 HTTP 服务，把上游结构数据（topics/dependencies/clusters）和
 * 中文翻译（topics.zh/dependencies.zh/clusters.zh/cn-curriculum-standards）
 * 按 mt_ ID 合并后，通过 JSON API + 单页 HTML 提供给浏览器。
 *
 *   node scripts/serve.mjs [--port 3000] [--upstream ../os-taxonomy]
 *
 * 打开 http://localhost:3000 即可浏览知识图谱。
 */

import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { createResolver } from './llm-resolve.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const VIEWER = resolve(ROOT, 'viewer');

// --- 解析参数 -------------------------------------------------------------
let port = 3000;
const portIdx = process.argv.indexOf('--port');
if (portIdx !== -1 && process.argv[portIdx + 1]) port = parseInt(process.argv[portIdx + 1], 10);

let upstreamPath = resolve(ROOT, '..', 'os-taxonomy');
const upIdx = process.argv.indexOf('--upstream');
if (upIdx !== -1 && process.argv[upIdx + 1]) upstreamPath = process.argv[upIdx + 1];

const UPSTREAM_DATA = resolve(upstreamPath, 'data');
const hasUpstream = existsSync(resolve(UPSTREAM_DATA, 'topics.json'));

// --- 加载数据 -------------------------------------------------------------
const load = (dir, name, required = true) => {
  const p = resolve(dir, name);
  if (!existsSync(p)) {
    if (required) throw new Error(`找不到文件: ${p}`);
    return null;
  }
  return JSON.parse(readFileSync(p, 'utf8'));
};

const zhTopics = load(DATA, 'topics.zh.json');
const zhDeps = load(DATA, 'dependencies.zh.json');
const zhClusters = load(DATA, 'clusters.zh.json');
const cnStandards = load(DATA, 'cn-curriculum-standards.json');

// 中国特有微主题（mtc_ 前缀，无上游对应，自带完整结构字段）
const cnOriginTopics = existsSync(resolve(DATA, 'cn-topics.json'))
  ? load(DATA, 'cn-topics.json')
  : null;

// 中国特有微主题的依赖关系（mtc_ 之间的知识 DAG）
const cnDeps = existsSync(resolve(DATA, 'cn-dependencies.json'))
  ? load(DATA, 'cn-dependencies.json')
  : null;

// 上游 mt_ 与中国 mtc_ 之间的桥接依赖（人工精选）
const cnBridgeDeps = existsSync(resolve(DATA, 'cn-bridge-dependencies.json'))
  ? load(DATA, 'cn-bridge-dependencies.json')
  : null;

// 维度切换配置(可选文件——缺失时只有默认 us 维度)
const dimensionsConfig = existsSync(resolve(DATA, 'dimensions.json'))
  ? load(DATA, 'dimensions.json')
  : { dimensions: { us: { label: '美版', filter: 'all' } }, defaultDimension: 'us' };

// 学科/领域中文映射
const domainMap = existsSync(resolve(DATA, 'domains.zh.json'))
  ? load(DATA, 'domains.zh.json') : { subjects: {}, domains: {} };
const subjectZh = (s) => domainMap.subjects[s] || s;
const domainZh = (s, d) => domainMap.domains[`${s} / ${d}`] || d;

const upstreamTopics = hasUpstream ? load(UPSTREAM_DATA, 'topics.json') : null;
const upstreamDeps = hasUpstream ? load(UPSTREAM_DATA, 'dependencies.json') : null;
const upstreamClusters = hasUpstream ? load(UPSTREAM_DATA, 'clusters.json') : null;

// --- 课本目录对比报告(textbook-gap-report.csv) ----------------------------
// 容错 CSV 解析:支持引号包裹字段(本文件无引号,但防后续数据变化)。
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  // 末行(无换行结尾)
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];
  const header = rows[0];
  return rows.slice(1)
    .filter(r => r.length === header.length && r.some(v => v !== ''))
    .map(r => Object.fromEntries(header.map((h, i) => [h.trim(), r[i]])));
}

const textbookGapPath = resolve(ROOT, 'docs', 'reports', 'textbook-gap-report.csv');
const textbookGaps = existsSync(textbookGapPath)
  ? parseCsv(readFileSync(textbookGapPath, 'utf8'))
  : [];

// 全量 summary(不受请求筛选影响,供概览页/页头展示总数)
const textbookGapSummary = (() => {
  const byGapType = {}, bySubject = {}, byGrade = {};
  for (const g of textbookGaps) {
    byGapType[g.gap_type] = (byGapType[g.gap_type] || 0) + 1;
    bySubject[g.subject] = (bySubject[g.subject] || 0) + 1;
    byGrade[g.grade] = (byGrade[g.grade] || 0) + 1;
  }
  return { total: textbookGaps.length, byGapType, bySubject, byGrade };
})();

// --- 构建合并视图 ---------------------------------------------------------
// 上游 topic 提供结构字段（subject/domain/ageRange/type/centrality），
// 中文翻译覆盖文本字段（name/description/evidence/assessmentPrompt）。
const zhById = new Map();
for (const t of zhTopics.topics) zhById.set(t.id, t);

const upstreamById = new Map();
if (upstreamTopics) {
  for (const t of upstreamTopics.topics) upstreamById.set(t.id, t);
}

// 合并后的 topic 列表：如果同时有上游和中文，则合并；只有上游则用英文原文并标记未翻译
const mergedTopics = [];
const allIds = new Set([...zhById.keys(), ...(upstreamTopics ? upstreamById.keys() : [])]);

for (const id of allIds) {
  const up = upstreamById.get(id);
  const zh = zhById.get(id);
  if (up && zh) {
    // 优先中文，结构字段来自上游
    mergedTopics.push({
      ...up,
      name: zh.name,
      description: zh.description,
      evidence: zh.evidence,
      assessmentPrompt: zh.assessmentPrompt,
      cnStandards: zh.cnStandards ?? [],
      translationStatus: zh.translationStatus ?? 'untranslated',
      translated: true,
      subjectZh: subjectZh(up.subject),
      domainZh: domainZh(up.subject, up.domain),
    });
  } else if (up) {
    // 只有上游——未翻译
    mergedTopics.push({
      ...up,
      cnStandards: [],
      translationStatus: 'untranslated',
      translated: false,
      subjectZh: subjectZh(up.subject),
      domainZh: domainZh(up.subject, up.domain),
    });
  } else if (zh) {
    // 只有中文（上游已删除的孤儿）
    mergedTopics.push({ ...zh, translated: true, orphaned: true });
  }
}

// 中国特有微主题（mtc_）：自带完整结构字段，直接加入合并视图
if (cnOriginTopics) {
  for (const t of cnOriginTopics.topics) {
    mergedTopics.push({
      ...t,
      translated: true,
      translationStatus: 'cn-origin',
      subjectZh: subjectZh(t.subject),
      domainZh: domainZh(t.subject, t.domain),
      cnOrigin: true, // 标记为中国特有，供维度过滤识别
    });
  }
}

// 合并依赖（中文 reason 优先，上游 fallback）
const zhDepMap = new Map();
for (const d of zhDeps.dependencies) {
  zhDepMap.set(`${d.topicId}->${d.prerequisiteId}`, d);
}
const mergedDeps = [];
if (upstreamDeps) {
  // 上游全量依赖 + 中文翻译覆盖
  for (const d of upstreamDeps.dependencies) {
    const key = `${d.topicId}->${d.prerequisiteId}`;
    const zh = zhDepMap.get(key);
    mergedDeps.push(zh ? { ...d, reason: zh.reason } : d);
  }
} else {
  mergedDeps.push(...zhDeps.dependencies);
}
// 中国特有微主题的依赖（mtc_ 之间）
if (cnDeps) {
  mergedDeps.push(...cnDeps.dependencies);
}
// 上游 mt_ → 中国 mtc_ 桥接依赖
if (cnBridgeDeps) {
  mergedDeps.push(...cnBridgeDeps.dependencies);
}

// --- 审核状态(reviewStatus)规范化 -----------------------------------------
// 三态: machine(LLM/规则产出,未人工审核) / reviewed(人工通过) / rejected(人工拒绝)
// 字段缺失(老数据)按 machine 处理。rejected 永不返回给前端。
const REVIEW_DEFAULT = 'machine';
const reviewStatus = (d) => (d && (d.reviewStatus === 'machine' || d.reviewStatus === 'reviewed' || d.reviewStatus === 'rejected'))
  ? d.reviewStatus
  : REVIEW_DEFAULT;

// 审核覆盖率统计(用于启动日志)
const reviewCounts = { reviewed: 0, machine: 0, rejected: 0 };
for (const d of mergedDeps) reviewCounts[reviewStatus(d)]++;

// 按审核状态过滤依赖:
//   review === 'all'      → 返回所有非 rejected 边(reviewed + machine)
//   其他(默认/缺省/'reviewed') → 只返回 reviewed
// rejected 在任何模式下都不返回。
function filterDepsByReview(deps, reviewParam) {
  if (reviewParam === 'all') return deps.filter(d => reviewStatus(d) !== 'rejected');
  return deps.filter(d => reviewStatus(d) === 'reviewed');
}

// 把单条依赖规范化为对外 API 的形态(带 reviewStatus,缺失补 machine)
const withReviewStatus = (d) => ({ ...d, reviewStatus: reviewStatus(d) });

// --- 「知识脉络」页数据(紧凑格式,一次性喂给前端) ----------------------------
// 只是 mergedTopics/mergedDeps 的序列化视图,不含任何新逻辑。
// nodes: id → [name, subject, ageRangeStart];  edges: {f,t,r,x,m}
//   x=1 跨学科边  m=1 未审核(machine)边  rejected 边不输出
const pathData = (() => {
  const nodes = {};
  const subjMap = new Map();
  for (const t of mergedTopics) {
    nodes[t.id] = [t.name, t.subject, t.ageRangeStart ?? -1];
    subjMap.set(t.id, t.subject);
  }
  const edges = [];
  for (const d of mergedDeps) {
    const rs = reviewStatus(d);
    if (rs === 'rejected') continue;
    const s1 = subjMap.get(d.prerequisiteId), s2 = subjMap.get(d.topicId);
    if (!s1 || !s2) continue;
    edges.push({ f: d.prerequisiteId, t: d.topicId, r: d.reason || '', x: s1 !== s2 ? 1 : 0, m: rs === 'reviewed' ? 0 : 1 });
  }
  // preset 入口: 跨学科度最高的节点(排除 Learning to Learn 的元技能噪音)
  const xdeg = new Map();
  for (const e of edges) {
    if (!e.x) continue;
    if (subjMap.get(e.f) === 'Learning to Learn' || subjMap.get(e.t) === 'Learning to Learn') continue;
    xdeg.set(e.f, (xdeg.get(e.f) || 0) + 1);
    xdeg.set(e.t, (xdeg.get(e.t) || 0) + 1);
  }
  const presets = [...xdeg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([id]) => id);
  return { subjects: domainMap.subjects, nodes, edges, presets };
})();

// --- AI 标记解析(实验功能,DEEPSEEK_API_KEY 缺失时自动禁用) -----------------
const llmResolve = createResolver(
  mergedTopics.map(t => ({ id: t.id, name: t.name, subject: t.subject, age: t.ageRangeStart })),
  subjectZh
);

// 合并 cluster（中文 summary 优先）
const zhClusterMap = new Map();
for (const c of zhClusters.clusters) {
  zhClusterMap.set(`${c.subject}|${c.domain}|${c.ageRangeStart}`, c);
}
const mergedClusters = [];
if (upstreamClusters) {
  for (const c of upstreamClusters.clusters) {
    const key = `${c.subject}|${c.domain}|${c.ageRangeStart}`;
    const zh = zhClusterMap.get(key);
    mergedClusters.push(zh ? { ...c, summary: zh.summary, domainZh: zh.domainZh } : c);
  }
} else {
  mergedClusters.push(...zhClusters.clusters);
}

// 统计
const subjectCounts = {};
for (const t of mergedTopics) {
  const s = t.subject || '(unknown)';
  subjectCounts[s] = (subjectCounts[s] || 0) + 1;
}
const translatedCount = mergedTopics.filter(t => t.translated).length;

// --- 维度(dimensions)过滤 ------------------------------------------------
// 维度是展示层概念:在已合并的 mergedTopics 上做白名单过滤,不改数据文件。
// 每个 topic 预计算它在每个维度下的可见性,供 API 和详情页快速标注。
function isTopicVisibleInDimension(topic, dim) {
  // 中国特有主题（mtc_）：按 stage 归属到对应维度
  if (topic.cnOrigin) {
    if (!dim || dim.filter === 'all') return false;      // 美版：隐藏所有中国特有主题
    if (!dim.filter || dim.filter !== 'whitelist') return false;
    // whitelist 维度：有 cnStage 标注的按学段过滤，无标注的(小学 bj-primary)全可见
    if (dim.cnStage) {
      return topic.stage === dim.cnStage;
    }
    // bj-primary 没有 cnStage → 显示所有无 stage 标注的(旧小学主题) + stage='小学'
    return !topic.stage || topic.stage === '小学';
  }
  // 上游翻译主题（mt_）：美版全可见
  if (!dim || dim.filter === 'all') return true;
  if (dim.filter !== 'whitelist') return true;
  // whitelist 维度下的上游主题：bj-primary 按 subjects 白名单过滤；
  // bj-junior / bj-senior 只含中国特有主题，上游主题一律隐藏
  if (dim.cnStage) return false;
  const subjCfg = dim.subjects && dim.subjects[topic.subject];
  if (!subjCfg) return false;
  if (subjCfg.mode === 'include') return true;
  if (subjCfg.mode === 'exclude-domains') {
    const excluded = subjCfg.excludedDomains || [];
    return !excluded.includes(topic.domain);
  }
  return true;
}

// 预计算 topic → { dimensionId: visible } 映射,避免每次请求重复算
const topicVisibility = new Map(); // id -> { dimId: bool }
for (const t of mergedTopics) {
  const vis = {};
  for (const [dimId, dim] of Object.entries(dimensionsConfig.dimensions)) {
    vis[dimId] = isTopicVisibleInDimension(t, dim);
  }
  topicVisibility.set(t.id, vis);
}

// 按维度过滤 topic 数组
function filterTopicsByDimension(topics, dimension) {
  const dim = dimensionsConfig.dimensions[dimension];
  if (!dim || dim.filter === 'all') {
    // 美版（all）维度：排除中国特有主题（mtc_）
    return topics.filter(t => !t.cnOrigin);
  }
  return topics.filter(t => {
    const vis = topicVisibility.get(t.id);
    return vis ? vis[dimension] : isTopicVisibleInDimension(t, dim);
  });
}

// 解析请求里的 dimension 参数,缺省回退到默认维度
function resolveDimension(params) {
  const dim = params.get('dimension') || dimensionsConfig.defaultDimension;
  return dimensionsConfig.dimensions[dim] ? dim : dimensionsConfig.defaultDimension;
}

// --- JSON API 响应 --------------------------------------------------------
function apiResponse(pathname, search) {
  const params = new URLSearchParams(search);
  const dimension = resolveDimension(params);

  // GET /api/dimensions — 维度配置(供前端渲染切换器)
  if (pathname === '/api/dimensions') {
    return {
      defaultDimension: dimensionsConfig.defaultDimension,
      dimensions: Object.fromEntries(
        Object.entries(dimensionsConfig.dimensions).map(([id, dim]) => [
          id,
          { label: dim.label, labelEn: dim.labelEn || '', description: dim.description || '', filter: dim.filter },
        ])
      ),
    };
  }

  // GET /api/summary — 全局统计(支持 ?dimension= 按维度统计)
  if (pathname === '/api/summary') {
    const topics = filterTopicsByDimension(mergedTopics, dimension);
    const subjectCountsDim = {};
    for (const t of topics) {
      const s = t.subject || '(unknown)';
      subjectCountsDim[s] = (subjectCountsDim[s] || 0) + 1;
    }
    return {
      dimension,
      upstreamVersion: upstreamTopics?.version ?? null,
      zhVersion: zhTopics.version,
      hasUpstream,
      upstreamPath: hasUpstream ? upstreamPath : null,
      totalTopics: topics.length,
      translatedTopics: topics.filter(t => t.translated).length,
      totalDeps: mergedDeps.length,
      totalClusters: mergedClusters.length,
      cnCurricula: cnStandards.curricula.length,
      subjectCounts: subjectCountsDim,
    };
  }

  // GET /api/topics — 所有 topic（支持 ?dimension=&subject=&domain=&age=&ageRange=&translated=&q= 筛选）
  if (pathname === '/api/topics') {
    // 先按维度白名单过滤,再叠加 subject/domain/age/translated/q 筛选
    let result = filterTopicsByDimension(mergedTopics, dimension);
    const subject = params.get('subject');
    const domain = params.get('domain');
    const age = params.get('age');
    const ageRange = params.get('ageRange'); // 形如 "4-7",按 ageRangeStart 落入区间
    const translated = params.get('translated');
    const q = params.get('q');

    if (subject) result = result.filter(t => t.subject === subject);
    if (domain) result = result.filter(t => t.domain === domain);
    if (age) result = result.filter(t => t.ageRangeStart === parseInt(age, 10));
    if (ageRange) {
      const [lo, hi] = ageRange.split('-').map(Number);
      if (!Number.isNaN(lo) && !Number.isNaN(hi)) {
        result = result.filter(t => t.ageRangeStart != null && t.ageRangeStart >= lo && t.ageRangeStart <= hi);
      }
    }
    if (translated === '1') result = result.filter(t => t.translated);
    if (translated === '0') result = result.filter(t => !t.translated);
    if (q) {
      const ql = q.toLowerCase();
      result = result.filter(t =>
        (t.name && t.name.toLowerCase().includes(ql)) ||
        (t.description && t.description.toLowerCase().includes(ql)) ||
        t.id.toLowerCase().includes(ql)
      );
    }

    return { count: result.length, topics: result };
  }

  // GET /api/topic/:id — 单个 topic 详情 + 依赖关系(详情页本身不过滤,可查看任意 topic)
  //   ?review=all       返回所有非 rejected 边(含 machine)
  //   其他(默认)        只返回 reviewed(rejected 永不返回)
  const topicMatch = pathname.match(/^\/api\/topic\/(.+)$/);
  if (topicMatch) {
    const id = decodeURIComponent(topicMatch[1]);
    const topic = mergedTopics.find(t => t.id === id);
    if (!topic) return { error: 'topic not found', id };

    const reviewParam = params.get('review'); // 'all' 看全部非 rejected,缺省只看 reviewed
    const dimCfg = dimensionsConfig.dimensions[dimension];
    // 关联 topic 标注当前维度可见性
    const annotate = (t) => t ? {
      id: t.id, name: t.name, subject: t.subject, domain: t.domain, translated: t.translated,
      dimensionVisible: dimCfg ? isTopicVisibleInDimension(t, dimCfg) : true,
    } : null;

    // 找该 topic 的前置依赖和被依赖(按 review 过滤,带 reviewStatus,rejected 永不返回)
    const prerequisites = filterDepsByReview(
      mergedDeps.filter(d => d.topicId === id),
      reviewParam
    ).map(d => withReviewStatus({ ...d, prerequisiteTopic: annotate(mergedTopics.find(t => t.id === d.prerequisiteId)) }));

    const dependents = filterDepsByReview(
      mergedDeps.filter(d => d.prerequisiteId === id),
      reviewParam
    ).map(d => withReviewStatus({ ...d, dependentTopic: annotate(mergedTopics.find(t => t.id === d.topicId)) }));

    // 课标详情
    const standards = (topic.cnStandards ?? []).map(key => {
      for (const c of cnStandards.curricula) {
        const found = c.topics.find(s => s.key === key);
        if (found) return found;
      }
      return { key, note: '(未收录)' };
    });

    return {
      dimension,
      topic: { ...topic, dimensionVisible: dimCfg ? isTopicVisibleInDimension(topic, dimCfg) : true },
      prerequisites, dependents, standards,
    };
  }

  // GET /api/clusters — 所有 cluster
  if (pathname === '/api/clusters') {
    return { count: mergedClusters.length, clusters: mergedClusters };
  }

  // GET /api/standards — 中国课标条目
  if (pathname === '/api/standards') {
    return cnStandards;
  }

  // GET /api/subjects — 学科 + 领域目录树(支持 ?dimension= 按维度过滤)
  if (pathname === '/api/subjects') {
    const topics = filterTopicsByDimension(mergedTopics, dimension);
    const tree = {};
    for (const t of topics) {
      if (!tree[t.subject]) tree[t.subject] = { count: 0, translated: 0, subjectZh: subjectZh(t.subject), domains: {} };
      tree[t.subject].count++;
      if (t.translated) tree[t.subject].translated++;
      if (!tree[t.subject].domains[t.domain]) {
        tree[t.subject].domains[t.domain] = { count: 0, translated: 0, domainZh: domainZh(t.subject, t.domain), ages: new Set() };
      }
      tree[t.subject].domains[t.domain].count++;
      if (t.translated) tree[t.subject].domains[t.domain].translated++;
      tree[t.subject].domains[t.domain].ages.add(t.ageRangeStart);
    }
    // Set → array
    for (const s of Object.values(tree)) {
      for (const d of Object.values(s.domains)) d.ages = [...d.ages].sort((a, b) => a - b);
    }
    return tree;
  }

  // GET /api/path-data — 「知识脉络」页全量紧凑数据(nodes/edges/presets)
  if (pathname === '/api/path-data') {
    return pathData;
  }

  // GET /api/graph — 3D 力导向图数据（nodes + links）
  //   ?review=all  返回所有非 rejected 边(含 machine);默认只返回 reviewed。
  //   rejected 永不返回。每条 link 带 reviewStatus(缺失补 machine)。
  if (pathname === '/api/graph') {
    const reviewParam = params.get('review');
    const nodeById = new Map();
    for (const t of mergedTopics) {
      nodeById.set(t.id, {
        id: t.id,
        name: t.name,
        subject: t.subject,
        subjectZh: t.subjectZh || subjectZh(t.subject),
        domain: t.domain,
        domainZh: t.domainZh || domainZh(t.subject, t.domain),
        age: t.ageRangeStart,
        ageEnd: t.ageRangeEnd,
        val: (t.centrality || 0.01) * 100 + 1, // 节点大小
      });
    }
    const nodes = [...nodeById.values()];
    const links = filterDepsByReview(
      mergedDeps.filter(d => nodeById.has(d.topicId) && nodeById.has(d.prerequisiteId)),
      reviewParam
    ).map(d => ({
      source: d.prerequisiteId,
      target: d.topicId,
      strength: d.strength,
      reviewStatus: reviewStatus(d),
    }));
    return {
      nodes,
      links,
      subjects: domainMap.subjects,
    };
  }

  // GET /api/textbook-gaps — 课本目录对比(支持 ?stage=&subject=&gap_type=&grade=&q=)
  if (pathname === '/api/textbook-gaps') {
    if (textbookGaps.length === 0) {
      return { total: 0, count: 0, summary: textbookGapSummary, gaps: [] };
    }
    let result = textbookGaps;
    const stage = params.get('stage');
    const subject = params.get('subject');
    const gapType = params.get('gap_type');
    const grade = params.get('grade');
    const q = params.get('q');
    if (stage) result = result.filter(g => g.stage === stage);
    if (subject) result = result.filter(g => g.subject === subject);
    if (gapType) result = result.filter(g => g.gap_type === gapType);
    if (grade) result = result.filter(g => g.grade === grade);
    if (q) {
      const ql = q.toLowerCase();
      result = result.filter(g =>
        (g.topic && g.topic.toLowerCase().includes(ql)) ||
        (g.path && g.path.toLowerCase().includes(ql)) ||
        (g.textbook && g.textbook.toLowerCase().includes(ql))
      );
    }
    return { total: textbookGaps.length, count: result.length, summary: textbookGapSummary, gaps: result };
  }

  return null;
}

// --- 静态文件服务 ---------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function serveStatic(pathname) {
  // 默认 index.html
  let filePath = pathname === '/' ? '/index.html' : pathname;
  const abs = resolve(VIEWER, '.' + filePath);
  // 防止目录穿越
  if (!abs.startsWith(VIEWER)) return null;
  if (!existsSync(abs)) return null;
  const body = readFileSync(abs);
  const mime = MIME[extname(abs)] || 'application/octet-stream';
  return { body, mime };
}

// --- HTTP 服务 ------------------------------------------------------------
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = url.pathname;

  // POST /api/resolve — AI 标记解析(实验)。同源无需 CORS。
  if (req.method === 'POST' && pathname === '/api/resolve') {
    if (!llmResolve) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'AI 解析未启用(缺少 DEEPSEEK_API_KEY)' }));
      return;
    }
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 64 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const { text, profile } = JSON.parse(body);
        if (!text || typeof text !== 'string') throw new Error('缺少 text');
        const result = await llmResolve(text.slice(0, 500), profile);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  try {
    // API 路由
    if (pathname.startsWith('/api/')) {
      const data = apiResponse(pathname, url.search);
      if (data === null) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'not found' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(data, null, 2));
      return;
    }

    // 静态文件
    const file = serveStatic(pathname);
    if (file) {
      res.writeHead(200, { 'Content-Type': file.mime });
      res.end(file.body);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: err.message }));
  }
});

server.listen(port, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════╗');
  console.log('  ║   Beijing Skill Taxonomy · 知识浏览器      ║');
  console.log('  ╚══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  ▸ 浏览器打开:  http://localhost:${port}`);
  console.log('');
  console.log(`  ▸ 知识总量:    ${mergedTopics.length} 个微主题`);
  console.log(`  ▸ 已翻译:      ${translatedCount} 个`);
  console.log(`  ▸ 依赖关系:    ${mergedDeps.length} 条`);
  console.log(`  ▸ 审核覆盖率:  reviewed ${reviewCounts.reviewed} / machine ${reviewCounts.machine} / rejected ${reviewCounts.rejected}`);
  console.log(`  ▸ 领域聚类:    ${mergedClusters.length} 个`);
  console.log(`  ▸ 中国课标:    ${cnStandards.curricula.length} 套`);
  console.log(`  ▸ 维度切换:    ${Object.values(dimensionsConfig.dimensions).map(d => d.label).join(' / ')}（默认 ${dimensionsConfig.dimensions[dimensionsConfig.defaultDimension]?.label}）`);
  console.log(`  ▸ AI 标记解析: ${llmResolve ? '✓ 已启用(deepseek-v4-flash)' : '✗ 未启用(缺 DEEPSEEK_API_KEY)'}`);
  console.log(`  ▸ 上游数据:    ${hasUpstream ? '✓ 已加载' : '✗ 未找到（仅显示中文数据）'}`);
  if (hasUpstream) console.log(`                ${upstreamPath}`);
  console.log('');
  console.log('  按 Ctrl+C 停止服务。');
  console.log('');
});
