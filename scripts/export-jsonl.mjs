#!/usr/bin/env node
/**
 * export-jsonl.mjs — 把发布图导出为 JSONL（互操作格式）。
 *
 *   node scripts/export-jsonl.mjs                                  # 上游默认 ../os-taxonomy
 *   node scripts/export-jsonl.mjs --upstream /path/to/os-taxonomy --out exports
 *
 * 产物（gitignore）：
 *   exports/nodes.jsonl          {id, labels, properties}
 *   exports/relationships.jsonl  {type, from, to, properties}
 *   exports/manifest.json        版本 / 计数 / 许可证署名（ODbL 1.0 + CC BY-SA 4.0）
 *
 * 只导出发布图（review-policy.publishedGraph）：非 covered 节点 + reviewed 且非 rescope 的边。
 * machine / rejected 边永远不进导出；属性走白名单，内部审核簿记（rescopeRequired /
 * previousReviewStatus / reviewNote / splitFrom / coveredBy / generationBatchId 等）一律不透传。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mergeDependencies, publishedGraph, PUBLISHED_EDGE_PROPS } from './review-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');

// README.md「许可证 > 署名」原文（使用上游 Marble 数据/文本时必须保留）。
// 版本号取自 data/manifest.json，避免发版后此处漂移。
const attribution = (version) => `Beijing Skill Taxonomy (zh-CN, v${version}) · 衍生自 Marble Skill Taxonomy (v1)，`
  + '© Generative Spark, Inc. (Marble) · https://withmarble.com · '
  + '数据库 ODbL 1.0，项目原创及有权许可的文本 CC BY-SA 4.0，代码 MIT。';

// 节点属性白名单：图结构 + 教学定位字段。evidence/assessmentPrompt 是教学载荷，
// 留在 data/*.json，不进互操作契约。
const NODE_PROPS = ['name', 'subject', 'domain', 'ageRangeStart', 'ageRangeEnd', 'type',
  'nodeKind', 'centrality', 'translationStatus', 'cnStandards', 'description'];
// 边属性白名单与 HTTP API 共用 review-policy.PUBLISHED_EDGE_PROPS：绝不透传
// rescopeRequired / previousReviewStatus / reviewNote / splitFrom / coveredBy / generationBatchId 等内部审核簿记。
const EDGE_PROPS = PUBLISHED_EDGE_PROPS;

const load = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));

export function toNodeRow(topic) {
  const properties = {};
  for (const key of NODE_PROPS) {
    if (topic[key] !== undefined) properties[key] = topic[key];
  }
  return {
    id: topic.id,
    labels: ['MicroTopic', topic.id.startsWith('mtc_') ? 'ChinaOrigin' : 'Upstream'],
    properties,
  };
}

export function toRelationshipRow(edge) {
  const properties = {};
  for (const key of EDGE_PROPS) {
    if (edge[key] !== undefined) properties[key] = edge[key];
  }
  return { type: 'PREREQUISITE_OF', from: edge.prerequisiteId, to: edge.topicId, properties };
}

// topic 合并语义与 serve.mjs「构建合并视图」段手工同步；改任一处必须同步另一处。
// 上游提供结构字段，中文翻译覆盖文本字段；中国特有微主题（mtc_）自带完整结构字段，直接加入。
export function mergeTopics({ upstreamTopics, zhTopics, cnTopics }) {
  const zhById = new Map(zhTopics.topics.map(topic => [topic.id, topic]));
  const upstreamById = new Map((upstreamTopics?.topics ?? []).map(topic => [topic.id, topic]));
  const allIds = new Set([...zhById.keys(), ...upstreamById.keys()]);

  const topics = [];
  for (const id of allIds) {
    const up = upstreamById.get(id);
    const zh = zhById.get(id);
    if (up && zh) {
      topics.push({
        ...up,
        name: zh.name,
        description: zh.description,
        cnStandards: zh.cnStandards ?? [],
        translationStatus: zh.translationStatus ?? 'untranslated',
      });
    } else if (up) {
      topics.push({ ...up, cnStandards: [], translationStatus: 'untranslated' });
    } else if (zh) {
      topics.push({ ...zh });
    }
  }
  for (const topic of cnTopics?.topics ?? []) topics.push({ ...topic, translationStatus: 'cn-origin' });
  return topics;
}

export function buildExport({ upstreamTopics, zhTopics, cnTopics, upstreamDeps, zhDeps, cnDeps, bridgeDeps }) {
  const topics = mergeTopics({ upstreamTopics, zhTopics, cnTopics });
  const dependencies = mergeDependencies({ upstreamDeps, zhDeps, cnDeps, bridgeDeps });
  const graph = publishedGraph(topics, dependencies);
  return { nodes: graph.topics.map(toNodeRow), relationships: graph.dependencies.map(toRelationshipRow) };
}

const opt = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

function main() {
  const upstreamData = resolve(opt('--upstream', resolve(ROOT, '..', 'os-taxonomy')), 'data');
  if (!existsSync(resolve(upstreamData, 'topics.json'))) {
    throw new Error(`找不到上游 ${upstreamData}/topics.json —— 导出发布图需要完整上游结构，请用 --upstream 指定路径`);
  }
  const outDir = resolve(ROOT, opt('--out', 'exports'));
  const manifest = load(DATA, 'manifest.json');
  const { nodes, relationships } = buildExport({
    upstreamTopics: load(upstreamData, 'topics.json'),
    zhTopics: load(DATA, 'topics.zh.json'),
    cnTopics: load(DATA, 'cn-topics.json'),
    upstreamDeps: load(upstreamData, 'dependencies.json'),
    zhDeps: load(DATA, 'dependencies.zh.json'),
    cnDeps: load(DATA, 'cn-dependencies.json'),
    bridgeDeps: load(DATA, 'cn-bridge-dependencies.json'),
  });

  mkdirSync(outDir, { recursive: true });
  const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  writeFileSync(resolve(outDir, 'nodes.jsonl'), jsonl(nodes));
  writeFileSync(resolve(outDir, 'relationships.jsonl'), jsonl(relationships));
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify({
    version: manifest.taxonomyVersion,
    generatedAt: new Date().toISOString(),
    counts: { nodes: nodes.length, relationships: relationships.length },
    attribution: attribution(manifest.taxonomyVersion),
  }, null, 2) + '\n');

  console.log(`✓ ${outDir}: ${nodes.length} nodes / ${relationships.length} relationships`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(`Fatal: ${error.message}`); process.exit(1); }
}
