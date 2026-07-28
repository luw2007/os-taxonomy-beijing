#!/usr/bin/env node
/**
 * export-review-packet.mjs — 导出待审 machine 边的确定性审阅包，不修改数据。
 *
 *   node scripts/export-review-packet.mjs --subject Mathematics --limit 50 --out /tmp/math-review.json
 *   node scripts/export-review-packet.mjs --generation-batch split-relations-20260721-historical --offset 100 --limit 50
 *
 * 包不含任何审核结论或 reviewer 声明。AI 共识只能由独立 consensus-review 命令处理与应用。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { edgeContentFingerprint, projectPacketTopic } from './consensus-roles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const FORMAT = 'beijing-skill-taxonomy-edge-review-packet/v1';

const load = (name) => JSON.parse(readFileSync(resolve(DATA, name), 'utf8'));
const option = (args, flag, fallback = null) => {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1] || null;
};

function nonNegativeInteger(value, flag) {
  if (!/^\d+$/.test(value)) throw new Error(`${flag} 必须为非负整数`);
  return Number(value);
}

function normalizedOptions(options = {}) {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('limit 必须为正整数');
  if (!Number.isInteger(offset) || offset < 0) throw new Error('offset 必须为非负整数');
  return {
    subject: options.subject ?? null,
    domain: options.domain ?? null,
    generationBatchId: options.generationBatchId ?? null,
    offset,
    limit,
  };
}

export function assertPacketSourceChecksums({ manifest, cnTopicsBytes, cnDependenciesBytes }) {
  const actualTopics = createHash('sha256').update(cnTopicsBytes).digest('hex');
  const actualDependencies = createHash('sha256').update(cnDependenciesBytes).digest('hex');
  if (manifest.files?.['cn-topics.json']?.sha256 !== actualTopics) throw new Error('checksum mismatch: cn-topics.json；先运行 node scripts/checksum.mjs');
  if (manifest.files?.['cn-dependencies.json']?.sha256 !== actualDependencies) throw new Error('checksum mismatch: cn-dependencies.json；先运行 node scripts/checksum.mjs');
}

/** Builds a deterministic, read-only packet of unreviewed cn-origin dependency candidates. */
export function buildReviewPacket({ topics, dependencies, source, options }) {
  const selection = normalizedOptions(options);
  const topicById = new Map(topics.topics.map(topic => [topic.id, topic]));
  const batchById = new Map((dependencies.generationBatches ?? []).map(batch => [batch.id, batch]));
  const machineEdges = dependencies.dependencies
    .filter(edge => edge.reviewStatus === 'machine')
    .filter(edge => edge.ageRegression === undefined && edge.rescopeRequired === undefined && edge.previousReviewStatus === undefined)
    .filter(edge => !selection.subject || topicById.get(edge.topicId)?.subject === selection.subject)
    .filter(edge => !selection.domain || topicById.get(edge.topicId)?.domain === selection.domain)
    .filter(edge => !selection.generationBatchId || edge.generationBatchId === selection.generationBatchId)
    .sort((a, b) => `${a.topicId}\u0000${a.prerequisiteId}`.localeCompare(`${b.topicId}\u0000${b.prerequisiteId}`));

  const edges = machineEdges.slice(selection.offset, selection.offset + selection.limit).map(edge => {
    const topic = topicById.get(edge.topicId);
    const prerequisite = topicById.get(edge.prerequisiteId);
    if (!topic || !prerequisite) throw new Error(`missing topic context for ${edge.topicId}<-${edge.prerequisiteId}`);
    const generationBatch = edge.generationBatchId === undefined ? null : batchById.get(edge.generationBatchId);
    if (edge.generationBatchId !== undefined && !generationBatch) {
      throw new Error(`missing generation batch ${edge.generationBatchId} for ${edge.topicId}<-${edge.prerequisiteId}`);
    }
    return {
      topicId: edge.topicId,
      prerequisiteId: edge.prerequisiteId,
      strength: edge.strength,
      reason: edge.reason ?? null,
      contentFingerprint: edgeContentFingerprint(edge),
      ...(edge.generationBatchId === undefined ? {} : { generationBatchId: edge.generationBatchId, generationBatch }),
      topic: projectPacketTopic(topic),
      prerequisite: projectPacketTopic(prerequisite),
    };
  });

  return {
    format: FORMAT,
    source,
    selection,
    totalMachineEdges: machineEdges.length,
    edges,
  };
}

function main() {
  const args = process.argv.slice(2);
  const out = resolve(ROOT, option(args, '--out', 'exports/review-packet.json'));
  const limit = nonNegativeInteger(option(args, '--limit', '50'), '--limit');
  const offset = nonNegativeInteger(option(args, '--offset', '0'), '--offset');
  if (limit === 0) throw new Error('--limit 必须为正整数');

  const manifest = load('manifest.json');
  const cnTopicsBytes = readFileSync(resolve(DATA, 'cn-topics.json'));
  const cnDependenciesBytes = readFileSync(resolve(DATA, 'cn-dependencies.json'));
  assertPacketSourceChecksums({ manifest, cnTopicsBytes, cnDependenciesBytes });
  const packet = buildReviewPacket({
    topics: JSON.parse(cnTopicsBytes),
    dependencies: JSON.parse(cnDependenciesBytes),
    source: {
      taxonomyVersion: manifest.taxonomyVersion,
      generatedAt: manifest.generatedAt,
      cnTopicsSha256: manifest.files['cn-topics.json'].sha256,
      cnDependenciesSha256: manifest.files['cn-dependencies.json'].sha256,
    },
    options: {
      subject: option(args, '--subject'),
      domain: option(args, '--domain'),
      generationBatchId: option(args, '--generation-batch'),
      limit,
      offset,
    },
  });
  if (packet.edges.length === 0) throw new Error('所选条件没有 machine 边；不写空审阅包');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(packet, null, 2) + '\n');
  console.log(`✓ ${out}: ${packet.edges.length} / ${packet.totalMachineEdges} machine edges`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(`Fatal: ${error.message}`); process.exit(1); }
}
