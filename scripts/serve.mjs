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
import { gzipSync } from 'node:zlib';
import { createResolver } from './llm-resolve.mjs';
import { createChatResponder, createSlidingWindowLimiter, validateChatRequest } from './llm-chat.mjs';
import { createAssessmentResponder, validateAssessmentRequest } from './llm-assessment.mjs';
import { filterPublishedDependencies, filterPublishedTopics, mergeDependencies, mergeTopics, publishedEdge, publishedGraph, publishedPathEdge, publishedTopic } from './review-policy.mjs';
import { parseHost } from './serve-config.mjs';
import { cachePolicyForRequest, staticPathForRequest } from './cache-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const VIEWER = resolve(ROOT, 'viewer');

// --- 解析参数 -------------------------------------------------------------
let port = 3000;
const portIdx = process.argv.indexOf('--port');
if (portIdx !== -1 && process.argv[portIdx + 1]) port = parseInt(process.argv[portIdx + 1], 10);

const host = parseHost(process.argv.slice(2));

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
// mergeTopics 统一上游结构与中文文本；viewer 在 enrich 阶段补展示字段。
const mergedTopics = mergeTopics({
  upstreamTopics,
  zhTopics,
  cnTopics: cnOriginTopics,
  enrich: (topic) => ({ ...topic, subjectZh: subjectZh(topic.subject), domainZh: domainZh(topic.subject, topic.domain) }),
});

// 合并依赖（中文 reason 优先，上游 fallback；上游边贴 reviewProvenance: upstream）
const mergedDeps = mergeDependencies({ upstreamDeps, zhDeps, cnDeps, bridgeDeps: cnBridgeDeps });

// 发布图（reviewed 且非 rescope、两端都是可发布 topic 的边）：/api/path-data 与
// /api/summary.publishedDeps 同源计算，避免两处过滤逻辑漂移。
const publishedGraphData = publishedGraph(mergedTopics, mergedDeps);

// --- 审核状态(reviewStatus)规范化 -----------------------------------------
// 三态: machine(未经任何审核) / reviewed(已通过审核) / rejected(已拒绝)。
// reviewed 不等于人工审核——证据等级看 reviewProvenance:
//   upstream=上游发布态 / rule=确定性规则脚本 / ai-consensus=授权的 AI 复审 / human=人工审核
// 字段缺失(老数据)按 machine 处理。rejected 永不返回给前端。
const REVIEW_DEFAULT = 'machine';
const reviewStatus = (d) => (d && (d.reviewStatus === 'machine' || d.reviewStatus === 'reviewed' || d.reviewStatus === 'rejected'))
  ? d.reviewStatus
  : REVIEW_DEFAULT;

// 审核覆盖率统计(用于启动日志)
const reviewCounts = { reviewed: 0, machine: 0, rejected: 0 };
for (const d of mergedDeps) reviewCounts[reviewStatus(d)]++;

// 内部边（cn + bridge）审核覆盖率——README/BACKLOG 的口径；上游边不计入
const internalReview = { reviewed: 0, machine: 0, rejected: 0 };
for (const d of [...(cnDeps?.dependencies ?? []), ...(cnBridgeDeps?.dependencies ?? [])]) internalReview[reviewStatus(d)]++;

// 儿童 API 只返回 reviewed、非 rescope 边；machine 仅供离线审核工具使用。
const filterDepsByReview = filterPublishedDependencies;

// nodes: id → [name, subject, ageRangeStart]; edges: {f,t,r,x,p}
// x=1 跨学科边；p=审核证据等级（upstream/rule/ai-consensus/human）。
const withReviewStatus = (d) => {
  return publishedEdge({ ...d, reviewStatus: reviewStatus(d) });
};

// --- 「知识脉络」页数据(紧凑格式,一次性喂给前端) ----------------------------
// 只是发布图的序列化视图，不含新的推荐逻辑。
// nodes: id → [name, subject, ageRangeStart]; edges: {f,t,r,x,p,q}
// x=1 跨学科边；p=审核证据等级；q=可公开显示的审核角色（teacher/curator）。
const pathData = (() => {
  const nodes = {};
  const subjMap = new Map();
  for (const t of publishedGraphData.topics) {
    nodes[t.id] = [t.name, t.subject, t.ageRangeStart ?? -1];
    subjMap.set(t.id, t.subject);
  }
  const edges = [];
  for (const d of publishedGraphData.dependencies) {
    const s1 = subjMap.get(d.prerequisiteId), s2 = subjMap.get(d.topicId);
    if (!s1 || !s2) continue;
    edges.push(publishedPathEdge(d, s1 !== s2));
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
const llmChat = createChatResponder();
const llmAssessment = createAssessmentResponder();
const allowChat = createSlidingWindowLimiter({ limit: 10, windowMs: 60_000 });
const topicById = new Map(mergedTopics.map(topic => [topic.id, topic]));

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

// 按维度过滤 topic 数组；covered 父主题不进入儿童可见列表。
function filterTopicsByDimension(topics, dimension) {
  const published = filterPublishedTopics(topics);
  const dim = dimensionsConfig.dimensions[dimension];
  if (!dim || dim.filter === 'all') return published.filter(topic => !topic.cnOrigin);
  return published.filter(topic => {
    const visibility = topicVisibility.get(topic.id);
    return visibility ? visibility[dimension] : isTopicVisibleInDimension(topic, dim);
  });
}

// 解析请求里的 dimension 参数,缺省回退到默认维度
function resolveDimension(params) {
  const dim = params.get('dimension') || dimensionsConfig.defaultDimension;
  return dimensionsConfig.dimensions[dim] ? dim : dimensionsConfig.defaultDimension;
}

// --- JSON API 响应 --------------------------------------------------------
export function apiResponse(pathname, search) {
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
      publishedDeps: publishedGraphData.dependencies.length,
      totalClusters: mergedClusters.length,
      cnCurricula: cnStandards.curricula.length,
      topicIds: topics.map(t => t.id),
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

    return { count: result.length, topics: result.map(publishedTopic) };
  }

  // GET /api/topic/:id — 单个可发布 topic 详情 + reviewed 依赖关系
  const topicMatch = pathname.match(/^\/api\/topic\/(.+)$/);
  if (topicMatch) {
    const id = decodeURIComponent(topicMatch[1]);
    const topic = mergedTopics.find(t => t.id === id);
    if (!topic) return { error: 'topic not found', id };
    if (topic.status === 'covered') return { error: 'topic covered by finer topics', id };

    const dimCfg = dimensionsConfig.dimensions[dimension];
    // 关联 topic 标注当前维度可见性
    const annotate = (t) => t ? {
      id: t.id, name: t.name, subject: t.subject, domain: t.domain, translated: t.translated,
      dimensionVisible: dimCfg ? isTopicVisibleInDimension(t, dimCfg) : true,
    } : null;

    const publishedIds = new Set(filterPublishedTopics(mergedTopics).map(item => item.id));
    const prerequisites = filterDepsByReview(
      mergedDeps.filter(dependency => dependency.topicId === id && publishedIds.has(dependency.prerequisiteId))
    ).map(dependency => ({ ...withReviewStatus(dependency), prerequisiteTopic: annotate(mergedTopics.find(item => item.id === dependency.prerequisiteId)) }));

    const dependents = filterDepsByReview(
      mergedDeps.filter(dependency => dependency.prerequisiteId === id && publishedIds.has(dependency.topicId))
    ).map(dependency => ({ ...withReviewStatus(dependency), dependentTopic: annotate(mergedTopics.find(item => item.id === dependency.topicId)) }));

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
      topic: { ...publishedTopic(topic), dimensionVisible: dimCfg ? isTopicVisibleInDimension(topic, dimCfg) : true },
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
  const filePath = pathname.replace(/^\/static\//, '/');
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
  const cachePolicy = cachePolicyForRequest({ method: req.method, pathname });
  res.setHeader('Cache-Control', cachePolicy.cacheControl);

  if (req.method === 'GET' && pathname === '/service-worker.js') {
    const worker = serveStatic('/static/service-worker.js');
    if (!worker) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': worker.mime,
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
    });
    res.end(worker.body);
    return;
  }

  // POST /api/chat — 匿名 AI 学习伙伴。会话不落盘，按 IP 限流。
  if (req.method === 'POST' && pathname === '/api/chat') {
    if (!llmChat) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'AI 学习伙伴未启用' }));
      return;
    }
    const ip = req.socket.remoteAddress || 'unknown';
    if (!allowChat(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' });
      res.end(JSON.stringify({ error: '提问太频繁，请稍后再试' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 32 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const input = validateChatRequest(JSON.parse(body));
        const topic = topicById.get(input.topicId);
        if (!topic) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '知识点不存在' }));
          return;
        }
        const result = await llmChat(topic, input);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(result));
      } catch (error) {
        const invalid = error instanceof SyntaxError || /invalid (request|topicId|message|history)/.test(error.message);
        res.writeHead(invalid ? 400 : 502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: invalid ? '请求格式不正确' : 'AI 暂时无法回答，请稍后重试' }));
      }
    });
    return;
  }

  // POST /api/assessment — 形成性作答评分。与匿名 AI 共用按 IP 限流，不读写学习档案。
  if (req.method === 'POST' && pathname === '/api/assessment') {
    if (!llmAssessment) {
      res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'AI 评分未启用' }));
      return;
    }
    const ip = req.socket.remoteAddress || 'unknown';
    if (!allowChat(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json; charset=utf-8', 'Retry-After': '60' });
      res.end(JSON.stringify({ error: '提交太频繁，请稍后再试' }));
      return;
    }
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 32 * 1024) req.destroy(); });
    req.on('end', async () => {
      try {
        const input = validateAssessmentRequest(JSON.parse(body));
        const topic = topicById.get(input.topicId);
        if (!topic) {
          res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ error: '知识点不存在' }));
          return;
        }
        const result = await llmAssessment(topic, input);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(result));
      } catch (error) {
        const invalid = error instanceof SyntaxError || /invalid (request|topicId|answer)/.test(error.message);
        res.writeHead(invalid ? 400 : 502, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: invalid ? '请求格式不正确' : 'AI 暂时无法评分，请稍后重试' }));
      }
    });
    return;
  }

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
      const isPathData = pathname === '/api/path-data';
      const body = JSON.stringify(data);
      const acceptsGzip = req.headers['accept-encoding']?.includes('gzip');
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': cachePolicy.cacheControl,
        ...(isPathData ? { Vary: 'Accept-Encoding' } : {}),
        ...(isPathData && acceptsGzip ? { 'Content-Encoding': 'gzip' } : {}),
      });
      res.end(isPathData && acceptsGzip ? gzipSync(body) : body);
      return;
    }

    // 静态文件
    const staticPath = staticPathForRequest(pathname);
    const file = staticPath && serveStatic(staticPath);
    if (file) {
      res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': pathname === '/' ? 'no-cache' : cachePolicy.cacheControl });
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

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(port, host, () => {
    console.log('');
    console.log('  ╔══════════════════════════════════════════════╗');
    console.log('  ║   Beijing Skill Taxonomy · 知识浏览器      ║');
    console.log('  ╚══════════════════════════════════════════════╝');
    console.log('');
    console.log(`  ▸ 浏览器打开:  http://${host}:${port}`);
    console.log('');
    console.log(`  ▸ 知识总量:    ${mergedTopics.length} 个微主题`);
    console.log(`  ▸ 已翻译:      ${translatedCount} 个`);
    console.log(`  ▸ 依赖关系:    ${mergedDeps.length} 条`);
    console.log(`  ▸ 发布图边:    ${publishedGraphData.dependencies.length} 条（reviewed 且两端可发布）`);
    console.log(`  ▸ 审核覆盖率:  内部边 reviewed ${internalReview.reviewed} / machine ${internalReview.machine} / rejected ${internalReview.rejected}（全图含上游 reviewed ${reviewCounts.reviewed} / machine ${reviewCounts.machine} / rejected ${reviewCounts.rejected}）`);
    console.log(`  ▸ 领域聚类:    ${mergedClusters.length} 个`);
    console.log(`  ▸ 中国课标:    ${cnStandards.curricula.length} 套`);
    console.log(`  ▸ 维度切换:    ${Object.values(dimensionsConfig.dimensions).map(d => d.label).join(' / ')}（默认 ${dimensionsConfig.dimensions[dimensionsConfig.defaultDimension]?.label}）`);
    console.log(`  ▸ AI 标记解析: ${llmResolve ? '✓ 已启用(deepseek-v4-flash)' : '✗ 未启用(缺 DEEPSEEK_API_KEY)'}`);
    console.log(`  ▸ AI 学习伙伴: ${llmChat ? '✓ 匿名可用(deepseek-v4-flash)' : '✗ 未启用(缺 DEEPSEEK_API_KEY)'}`);
    console.log(`  ▸ AI 作答评分: ${llmAssessment ? '✓ 匿名可用(deepseek-v4-flash)' : '✗ 未启用(缺 DEEPSEEK_API_KEY)'}`);
    console.log(`  ▸ 上游数据:    ${hasUpstream ? '✓ 已加载' : '✗ 未找到（仅显示中文数据）'}`);
    if (hasUpstream) console.log(`                ${upstreamPath}`);
    console.log('');
    console.log('  按 Ctrl+C 停止服务。');
    console.log('');
  });
}
