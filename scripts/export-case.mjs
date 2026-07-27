#!/usr/bin/env node
/**
 * export-case.mjs — 导出发布图为 1EdTech CASE v1.1 CFPackage。
 *
 *   node scripts/export-case.mjs --base-url https://example.org/taxonomy
 *   node scripts/export-case.mjs --base-url https://example.org/taxonomy --upstream /path/to/os-taxonomy --out exports/case-v1.1.json
 *
 * CASE 结构依据：https://purl.imsglobal.org/spec/case/v1p1/schema/json/
 * - CFDocument / CFItem / CFAssociation 的 identifier、uri、lastChangeDateTime 为必填。
 * - 先修边用 precedes，方向 prerequisite → topic。
 *
 * 不含 reviewNote/reviewBy 等内部审核簿记；该文件是离线交换包，不是 CASE REST 服务。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mergeDependencies, mergeTopics, publishedGraph } from './review-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const NAMESPACE = Buffer.from('4b6f5c55c9c64b2da5d8bf17f9b53e20', 'hex');

const load = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
const option = (args, name, fallback = null) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] || null;
};
const link = (baseUrl, pathKind, id, title, idKind = pathKind) => ({ identifier: stableUuid(`${idKind}:${id}`), uri: uriFor(baseUrl, pathKind, id), title });
export function stableUuid(name) {
  const bytes = createHash('sha1').update(NAMESPACE).update(name).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const uriFor = (baseUrl, kind, id) => `${baseUrl.replace(/\/$/, '')}/case/${kind}/${encodeURIComponent(id)}`;

export function buildCasePackage({ topics, dependencies, baseUrl, version, generatedAt }) {
  if (!baseUrl || !URL.canParse(baseUrl)) throw new Error('--base-url 必须是绝对 URL');
  const documentId = 'beijing-skill-taxonomy';
  const documentLink = link(baseUrl, 'documents', documentId, 'Beijing Skill Taxonomy');
  const topicById = new Map(topics.map(topic => [topic.id, topic]));

  const CFItems = topics.map(topic => ({
    CFDocumentURI: documentLink,
    identifier: stableUuid(`item:${topic.id}`),
    fullStatement: topic.name,
    alternativeLabel: topic.description || undefined,
    CFItemType: topic.nodeKind || topic.type || 'Competency',
    uri: uriFor(baseUrl, 'items', topic.id),
    humanCodingScheme: topic.id,
    subject: topic.subject ? [topic.subject] : undefined,
    language: 'zh',
    educationLevel: topic.ageRangeStart == null ? undefined : [`age-${topic.ageRangeStart}`],
    lastChangeDateTime: generatedAt,
  }));
  for (const item of CFItems) for (const key of Object.keys(item)) if (item[key] === undefined) delete item[key];

  const CFAssociations = dependencies.map(edge => {
    const prerequisite = topicById.get(edge.prerequisiteId);
    const topic = topicById.get(edge.topicId);
    if (!prerequisite || !topic) throw new Error(`published dependency has missing topic: ${edge.prerequisiteId}->${edge.topicId}`);
    return {
      identifier: stableUuid(`association:${edge.prerequisiteId}->${edge.topicId}`),
      associationType: 'precedes',
      uri: uriFor(baseUrl, 'associations', `${edge.prerequisiteId}->${edge.topicId}`),
      originNodeURI: link(baseUrl, 'items', prerequisite.id, prerequisite.name, 'item'),
      destinationNodeURI: link(baseUrl, 'items', topic.id, topic.name, 'item'),
    };
  });
  for (const association of CFAssociations) if (association.notes === undefined) delete association.notes;

  return {
    CFDocument: {
      identifier: documentLink.identifier,
      uri: documentLink.uri,
      creator: 'Beijing Skill Taxonomy contributors',
      title: 'Beijing Skill Taxonomy (zh-CN)',
      description: 'A Chinese K-12 micro-topic prerequisite graph aligned to Ministry of Education curriculum mapping identifiers.',
      language: 'zh',
      version,
      caseVersion: '1.1',
      lastChangeDateTime: generatedAt,
    },
    CFItems,
    CFAssociations,
  };
}

function main() {
  const args = process.argv.slice(2);
  const baseUrl = option(args, '--base-url');
  const upstreamRoot = option(args, '--upstream', resolve(ROOT, '..', 'os-taxonomy'));
  const out = resolve(ROOT, option(args, '--out', 'exports/case-v1.1.json'));
  const upstreamData = resolve(upstreamRoot, 'data');
  if (!existsSync(resolve(upstreamData, 'topics.json'))) throw new Error(`找不到上游 ${upstreamData}/topics.json`);

  const manifest = load(DATA, 'manifest.json');
  const topics = mergeTopics({
    upstreamTopics: load(upstreamData, 'topics.json'), zhTopics: load(DATA, 'topics.zh.json'), cnTopics: load(DATA, 'cn-topics.json'),
  });
  const dependencies = mergeDependencies({
    upstreamDeps: load(upstreamData, 'dependencies.json'), zhDeps: load(DATA, 'dependencies.zh.json'),
    cnDeps: load(DATA, 'cn-dependencies.json'), bridgeDeps: load(DATA, 'cn-bridge-dependencies.json'),
  });
  const graph = publishedGraph(topics, dependencies);
  const output = buildCasePackage({
    topics: graph.topics, dependencies: graph.dependencies, baseUrl, version: manifest.taxonomyVersion,
    generatedAt: manifest.generatedAt,
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(output, null, 2) + '\n');
  console.log(`✓ ${out}: ${output.CFItems.length} CFItems / ${output.CFAssociations.length} CFAssociations`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(`Fatal: ${error.message}`); process.exit(1); }
}
