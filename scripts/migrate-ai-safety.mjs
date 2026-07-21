#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { migrateExistingRescopes } from './granularity-safety.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const HISTORICAL_BATCH_ID = 'split-relations-20260721-historical';
const RESCOPE_BATCH_ID = 'granularity-rescope-20260721';

export function migrateAiSafetyData({ topicsDoc, depsDoc, bridgeDepsDoc, coveredResults = [], historicalBackfillStart, migratedAt }) {
  const nextTopicsDoc = structuredClone(topicsDoc);
  const nextDepsDoc = structuredClone(depsDoc);
  const nextBridgeDepsDoc = bridgeDepsDoc ? structuredClone(bridgeDepsDoc) : null;
  const byId = new Map(nextTopicsDoc.topics.map(topic => [topic.id, topic]));

  let coveredTopics = 0;
  for (const result of coveredResults) {
    if (result.verdict !== 'covered') continue;
    const topic = byId.get(result.id);
    const coveredBy = [...new Set(result.coveredBy || [])].filter(id => id !== result.id && byId.has(id)).sort();
    if (!topic || coveredBy.length < 2) continue;
    topic.status = 'covered';
    topic.coveredBy = coveredBy;
    coveredTopics++;
  }

  const migrated = migrateExistingRescopes(nextTopicsDoc.topics, nextDepsDoc.dependencies, RESCOPE_BATCH_ID);
  const demotedReviewed = migrated.dependencies.filter((edge, index) =>
    nextDepsDoc.dependencies[index].reviewStatus === 'reviewed' && edge.reviewStatus === 'machine').length;
  nextDepsDoc.dependencies = migrated.dependencies;
  const migratedBridges = nextBridgeDepsDoc
    ? migrateExistingRescopes(nextTopicsDoc.topics, nextBridgeDepsDoc.dependencies, RESCOPE_BATCH_ID)
    : null;
  const bridgeDemotedReviewed = migratedBridges?.dependencies.filter((edge, index) =>
    nextBridgeDepsDoc.dependencies[index].reviewStatus === 'reviewed' && edge.reviewStatus === 'machine').length || 0;
  if (migratedBridges) nextBridgeDepsDoc.dependencies = migratedBridges.dependencies;

  for (const edge of nextDepsDoc.dependencies) {
    const topic = byId.get(edge.topicId);
    const prerequisite = byId.get(edge.prerequisiteId);
    if (edge.reviewStatus === 'machine' && topic?.stage && topic.stage === prerequisite?.stage
      && Number.isFinite(topic.ageRangeStart) && Number.isFinite(prerequisite.ageRangeStart)
      && prerequisite.ageRangeStart > topic.ageRangeStart) edge.ageRegression = true;
  }

  if (Number.isInteger(historicalBackfillStart)) {
    for (let index = historicalBackfillStart; index < nextDepsDoc.dependencies.length; index++) {
      const edge = nextDepsDoc.dependencies[index];
      if (edge.reviewStatus === 'machine' && !edge.generationBatchId) edge.generationBatchId = HISTORICAL_BATCH_ID;
    }
    const batches = nextDepsDoc.generationBatches || [];
    const existingBatch = batches.find(batch => batch.id === HISTORICAL_BATCH_ID);
    if (existingBatch) {
      existingBatch.inputFingerprint = null;
      existingBatch.strategy = 'bounded-split-relations-v1-historical';
    } else {
      nextDepsDoc.generationBatches = [...batches, {
        id: HISTORICAL_BATCH_ID,
        model: 'deepseek-v4-flash',
        inputFingerprint: null,
        generatedAt: migratedAt,
        strategy: 'bounded-split-relations-v1-historical',
      }];
    }
  }

  nextTopicsDoc.topicCount = nextTopicsDoc.topics.length;
  nextDepsDoc.edgeCount = nextDepsDoc.dependencies.length;
  if (nextBridgeDepsDoc) nextBridgeDepsDoc.edgeCount = nextBridgeDepsDoc.dependencies.length;
  return {
    topicsDoc: nextTopicsDoc,
    depsDoc: nextDepsDoc,
    bridgeDepsDoc: nextBridgeDepsDoc,
    stats: {
      reusedParents: migrated.parentIds.size,
      rescopeEdges: migrated.dependencies.filter(edge => edge.rescopeRequired).length,
      demotedReviewed,
      bridgeRescopeEdges: migratedBridges?.dependencies.filter(edge => edge.rescopeRequired).length || 0,
      bridgeDemotedReviewed,
      coveredTopics,
      ageRegressions: nextDepsDoc.dependencies.filter(edge => edge.ageRegression).length,
    },
  };
}


async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const topicsPath = resolve(DATA, 'cn-topics.json');
  const depsPath = resolve(DATA, 'cn-dependencies.json');
  const bridgeDepsPath = resolve(DATA, 'cn-bridge-dependencies.json');
  const topicsDoc = JSON.parse(readFileSync(topicsPath, 'utf8'));
  const depsDoc = JSON.parse(readFileSync(depsPath, 'utf8'));
  const bridgeDepsDoc = JSON.parse(readFileSync(bridgeDepsPath, 'utf8'));
  const priorMigration = (depsDoc.generationBatches || []).some(batch => batch.id === HISTORICAL_BATCH_ID);
  const bridgeMigration = bridgeDepsDoc.dependencies.some(edge => edge.rescopeBatchId === RESCOPE_BATCH_ID);
  if (!dryRun && priorMigration && bridgeMigration) throw new Error('AI safety migration 已应用；不得重复执行');
  const { readdirSync } = await import('node:fs');
  const workDir = resolve(DATA, '.granularity-work');
  const coveredResults = priorMigration ? [] : readdirSync(workDir).filter(file => file.endsWith('.json')).sort()
    .flatMap(file => JSON.parse(readFileSync(resolve(workDir, file), 'utf8')).results || [])
    .filter(result => result.verdict === 'covered');
  // simplified: only the one-shot 2026-07-21 migration knows the original append was the final 329-edge suffix.
  const out = migrateAiSafetyData({
    topicsDoc, depsDoc, bridgeDepsDoc, coveredResults,
    historicalBackfillStart: priorMigration ? undefined : Math.max(0, depsDoc.dependencies.length - 329),
    migratedAt: new Date().toISOString(),
  });
  console.log(JSON.stringify(out.stats, null, 2));
  if (dryRun) return;
  writeFileSync(topicsPath, JSON.stringify(out.topicsDoc, null, 2) + '\n');
  writeFileSync(depsPath, JSON.stringify(out.depsDoc, null, 2) + '\n');
  writeFileSync(bridgeDepsPath, JSON.stringify(out.bridgeDepsDoc, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Fatal: ${error.message}`); process.exit(1); });
}
