#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEPS_PATH = resolve(ROOT, 'data', 'cn-dependencies.json');

export function reviewEdge(edge, decision) {
  if (!['reviewed', 'rejected'].includes(decision?.status)) throw new Error('status 必须为 reviewed 或 rejected');
  if (typeof decision.reviewer !== 'string' || !decision.reviewer.trim()) throw new Error('reviewer 不能为空');
  const reviewed = {
    ...edge,
    reviewStatus: decision.status,
    reviewedBy: decision.reviewer.trim(),
    reviewedAt: decision.reviewedAt || new Date().toISOString(),
    ...(decision.note?.trim() ? { reviewNote: decision.note.trim() } : {}),
  };
  delete reviewed.rescopeRequired;
  delete reviewed.previousReviewStatus;
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
  const dryRun = argv.includes('--dry-run');
  if (!topicId || !prerequisiteId) throw new Error('需要 --topic 和 --prerequisite');

  const doc = JSON.parse(readFileSync(DEPS_PATH, 'utf8'));
  const index = doc.dependencies.findIndex(edge => edge.topicId === topicId && edge.prerequisiteId === prerequisiteId);
  if (index < 0) throw new Error(`找不到边 ${topicId}<-${prerequisiteId}`);
  doc.dependencies[index] = reviewEdge(doc.dependencies[index], { status, reviewer, note });
  console.log(JSON.stringify(doc.dependencies[index], null, 2));
  if (!dryRun) writeFileSync(DEPS_PATH, JSON.stringify(doc, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(`Fatal: ${error.message}`); process.exit(1); }
}
