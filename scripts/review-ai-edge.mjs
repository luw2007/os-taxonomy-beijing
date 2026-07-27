#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateReviewerEvidence } from './reviewer-evidence.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEPS_PATH = resolve(ROOT, 'data', 'cn-dependencies.json');
const BRIDGE_DEPS_PATH = resolve(ROOT, 'data', 'cn-bridge-dependencies.json');

// 审核 CLI 只产出带审核人的两档证据；rule/upstream 由脚本与合并期负责，不允许人工声明。
const REVIEWER_PROVENANCE = new Set(['human', 'ai-consensus']);

export function reviewEdge(edge, decision) {
  if (!['reviewed', 'rejected'].includes(decision?.status)) throw new Error('status 必须为 reviewed 或 rejected');
  if (typeof decision.reviewer !== 'string' || !decision.reviewer.trim()) throw new Error('reviewer 不能为空');
  const provenance = decision.provenance || 'human';
  if (!REVIEWER_PROVENANCE.has(provenance)) throw new Error('provenance 必须为 human 或 ai-consensus');
  const reviewed = {
    ...edge,
    reviewStatus: decision.status,
    reviewedBy: decision.reviewer.trim(),
    reviewedAt: decision.reviewedAt || new Date().toISOString(),
    ...(decision.note?.trim() ? { reviewNote: decision.note.trim() } : {}),
    reviewProvenance: provenance,
    ...(provenance === 'human' ? { reviewerRole: decision.reviewerRole || 'curator' } : {}),
    ...(decision.reviewRubric ? { reviewRubric: decision.reviewRubric } : {}),
    ...(decision.reviewEvidenceRef ? { reviewEvidenceRef: decision.reviewEvidenceRef } : {}),
  };
  validateReviewerEvidence(reviewed);
  delete reviewed.rescopeRequired;
  delete reviewed.previousReviewStatus;
  delete reviewed.ageRegression;
  return reviewed;
}

function opt(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : null;
}

function main() {
  const argv = process.argv.slice(2);
  const topicId = opt(argv, '--topic');
  const prerequisiteId = opt(argv, '--prerequisite');
  const status = opt(argv, '--status');
  const reviewer = opt(argv, '--reviewer');
  const note = opt(argv, '--note');
  const provenance = opt(argv, '--provenance');
  const reviewerRole = opt(argv, '--reviewer-role');
  const reviewRubric = opt(argv, '--review-rubric');
  const reviewEvidenceRef = opt(argv, '--review-evidence-ref');
  const bridge = argv.includes('--bridge');
  const dryRun = argv.includes('--dry-run');
  if (!topicId || !prerequisiteId) throw new Error('需要 --topic 和 --prerequisite');

  const path = bridge ? BRIDGE_DEPS_PATH : DEPS_PATH;
  const doc = JSON.parse(readFileSync(path, 'utf8'));
  const index = doc.dependencies.findIndex(edge => edge.topicId === topicId && edge.prerequisiteId === prerequisiteId);
  if (index < 0) throw new Error(`找不到${bridge ? '桥接' : ''}边 ${topicId}<-${prerequisiteId}`);
  doc.dependencies[index] = reviewEdge(doc.dependencies[index], { status, reviewer, note, provenance, reviewerRole, reviewRubric, reviewEvidenceRef });
  console.log(JSON.stringify(doc.dependencies[index], null, 2));
  if (!dryRun) writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(`Fatal: ${error.message}`); process.exit(1); }
}
