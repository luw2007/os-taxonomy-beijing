import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { evaluateGoldSet } from '../evaluate-ai-gold-set.mjs';

test('gold-set harness reports consensus precision recall and reviewer kappa by subject and kind', () => {
  const records = [
    { subject: 'Biology', kind: 'relation', predicted: 'prerequisite', reviewerA: 'prerequisite', reviewerB: 'prerequisite' },
    { subject: 'Biology', kind: 'relation', predicted: 'prerequisite', reviewerA: 'none', reviewerB: 'none' },
    { subject: 'Biology', kind: 'relation', predicted: 'none', reviewerA: 'prerequisite', reviewerB: 'prerequisite' },
    { subject: 'Biology', kind: 'relation', predicted: 'none', reviewerA: 'none', reviewerB: 'none' },
  ];
  const report = evaluateGoldSet(records);
  const row = report.groups['Biology|relation'];
  assert.equal(row.consensusCount, 4);
  assert.equal(row.precision, 0.5);
  assert.equal(row.recall, 0.5);
  assert.equal(row.kappa, 1);
  assert.equal(row.sampleReady, false);
});

test('per-subject aggregation micro-averages tp/fp/fn/precision/recall/f1 across kinds using each row\'s own positive label', () => {
  const records = [
    // Biology|relation: positive label 'prerequisite'. 1 tp, 1 fp, 1 fn, 1 tn (all consensus).
    { subject: 'Biology', kind: 'relation', predicted: 'prerequisite', reviewerA: 'prerequisite', reviewerB: 'prerequisite' },
    { subject: 'Biology', kind: 'relation', predicted: 'prerequisite', reviewerA: 'none', reviewerB: 'none' },
    { subject: 'Biology', kind: 'relation', predicted: 'none', reviewerA: 'prerequisite', reviewerB: 'prerequisite' },
    { subject: 'Biology', kind: 'relation', predicted: 'none', reviewerA: 'none', reviewerB: 'none' },
    // Biology|split: positive label 'split'. 1 more tp.
    { subject: 'Biology', kind: 'split', predicted: 'split', reviewerA: 'split', reviewerB: 'split' },
    // disagreement row: excluded from consensus, still counted in total.
    { subject: 'Biology', kind: 'split', predicted: 'split', reviewerA: 'split', reviewerB: 'none' },
  ];
  const report = evaluateGoldSet(records);
  const bio = report.bySubject.Biology;
  assert.equal(bio.total, 6);
  assert.equal(bio.consensusCount, 5);
  assert.equal(bio.disagreementCount, 1);
  assert.equal(bio.tp, 2);
  assert.equal(bio.fp, 1);
  assert.equal(bio.fn, 1);
  assert.equal(bio.precision, 2 / 3);
  assert.equal(bio.recall, 2 / 3);
  assert.ok(Math.abs(bio.f1 - 2 / 3) < 1e-9);
});

test('overall aggregates across every subject and kind', () => {
  const records = [
    { subject: 'Biology', kind: 'relation', predicted: 'prerequisite', reviewerA: 'prerequisite', reviewerB: 'prerequisite' },
    { subject: 'Chemistry', kind: 'relation', predicted: 'none', reviewerA: 'prerequisite', reviewerB: 'prerequisite' },
  ];
  const report = evaluateGoldSet(records);
  assert.equal(report.overall.total, 2);
  assert.equal(report.overall.tp, 1);
  assert.equal(report.overall.fn, 1);
  assert.equal(report.overall.precision, 1);
  assert.equal(report.overall.recall, 0.5);
});

test('GOLD_SET_MIN_CONSENSUS env override lowers the sample-ready threshold', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gold-set-'));
  const file = join(dir, 'gold-set.json');
  const records = [
    { subject: 'Biology', kind: 'relation', predicted: 'prerequisite', reviewerA: 'prerequisite', reviewerB: 'prerequisite' },
    { subject: 'Biology', kind: 'relation', predicted: 'none', reviewerA: 'none', reviewerB: 'none' },
  ];
  writeFileSync(file, JSON.stringify(records));
  try {
    const result = spawnSync(process.execPath, ['../evaluate-ai-gold-set.mjs', file, '--json'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
      env: { ...process.env, GOLD_SET_MIN_CONSENSUS: '2' },
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.overall.sampleReady, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--json CLI flag prints machine-readable output matching evaluateGoldSet(records)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gold-set-'));
  const file = join(dir, 'gold-set.json');
  const records = [
    { subject: 'Physics', kind: 'relation', predicted: 'prerequisite', reviewerA: 'prerequisite', reviewerB: 'prerequisite' },
    { subject: 'Physics', kind: 'split', predicted: 'none', reviewerA: 'none', reviewerB: 'none' },
  ];
  writeFileSync(file, JSON.stringify(records));
  try {
    const result = spawnSync(process.execPath, ['../evaluate-ai-gold-set.mjs', file, '--json'], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.deepEqual(report, evaluateGoldSet(records));
    // without --json the CLI must not emit raw JSON dump
    const humanResult = spawnSync(process.execPath, ['../evaluate-ai-gold-set.mjs', file], {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
    });
    assert.equal(humanResult.status, 0, humanResult.stderr);
    assert.match(humanResult.stdout, /gold set 总体/);
    assert.match(humanResult.stdout, /按学科/);
    assert.throws(() => JSON.parse(humanResult.stdout));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
