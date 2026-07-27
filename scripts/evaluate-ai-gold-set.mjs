#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// 单组进入统计所需的最小双评一致样本量（可用环境变量覆盖；非法值直接报错，不静默回落）
const rawConsensusMin = process.env.GOLD_SET_MIN_CONSENSUS;
const CONSENSUS_SAMPLE_MIN = rawConsensusMin === undefined ? 30 : Number(rawConsensusMin);
if (!Number.isFinite(CONSENSUS_SAMPLE_MIN) || CONSENSUS_SAMPLE_MIN < 0) {
  throw new Error('GOLD_SET_MIN_CONSENSUS 必须是非负数');
}
const positiveLabel = kind => kind === 'split' ? 'split' : 'prerequisite';

function kappa(records) {
  if (!records.length) return null;
  const labels = new Set(records.flatMap(record => [record.reviewerA, record.reviewerB]));
  const observed = records.filter(record => record.reviewerA === record.reviewerB).length / records.length;
  let expected = 0;
  for (const label of labels) {
    const a = records.filter(record => record.reviewerA === label).length / records.length;
    const b = records.filter(record => record.reviewerB === label).length / records.length;
    expected += a * b;
  }
  return expected === 1 ? 1 : (observed - expected) / (1 - expected);
}

// 逐条按自己的 kind 取正类（split vs prerequisite），因此同一函数既能算单组
// 也能算跨 kind 的聚合（overall / bySubject）而不会用第一条记录的 kind 代表整组。
// 注意：overall/bySubject 的 kappa 在合并后的标签空间上计算（split 与 prerequisite
// 不会在同一标注任务共现），期望一致率被摊薄、kappa 偏乐观；分组内 kappa 才是权威口径。
function summarize(rows) {
  const agreed = rows.filter(row => row.reviewerA === row.reviewerB);
  let tp = 0, fp = 0, fn = 0;
  for (const row of agreed) {
    const positive = positiveLabel(row.kind);
    const predictedPositive = row.predicted === positive;
    const actualPositive = row.reviewerA === positive;
    if (predictedPositive && actualPositive) tp++;
    else if (predictedPositive) fp++;
    else if (actualPositive) fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return {
    total: rows.length,
    consensusCount: agreed.length,
    disagreementCount: rows.length - agreed.length,
    tp, fp, fn,
    precision,
    recall,
    f1: precision === null || recall === null ? null : (precision + recall ? (2 * precision * recall) / (precision + recall) : 0),
    kappa: kappa(rows),
    sampleReady: agreed.length >= CONSENSUS_SAMPLE_MIN,
  };
}

const groupBy = (records, keyOf) => {
  const groups = new Map();
  for (const record of records) {
    const key = keyOf(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
};

export function evaluateGoldSet(records) {
  const summarizeGroups = groups =>
    Object.fromEntries([...groups].map(([key, rows]) => [key, summarize(rows)]));
  return {
    overall: summarize(records),
    bySubject: summarizeGroups(groupBy(records, record => record.subject)),
    groups: summarizeGroups(groupBy(records, record => `${record.subject}|${record.kind}`)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) throw new Error('用法: node scripts/evaluate-ai-gold-set.mjs <gold-set.json> [--json]');
  const report = evaluateGoldSet(JSON.parse(readFileSync(resolve(file), 'utf8')));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const pct = value => value === null ? '   —  ' : `${(value * 100).toFixed(1)}%`;
    const line = (label, row) => `  ${label.padEnd(28)} n=${String(row.total).padStart(4)}  双评一致=${String(row.consensusCount).padStart(4)}`
      + `  P=${pct(row.precision)}  R=${pct(row.recall)}  F1=${pct(row.f1)}`
      + `  κ=${row.kappa === null ? ' —  ' : row.kappa.toFixed(2)}`
      + `  tp/fp/fn=${row.tp}/${row.fp}/${row.fn}${row.sampleReady ? '' : `  ⚠ 一致样本 <${CONSENSUS_SAMPLE_MIN}`}`;
    console.log('\n=== gold set 总体 ===');
    console.log(line('ALL', report.overall));
    console.log('\n=== 按学科 ===');
    for (const [subject, row] of Object.entries(report.bySubject)) console.log(line(subject, row));
    console.log('\n=== 按学科 × 任务 ===');
    for (const [key, row] of Object.entries(report.groups)) console.log(line(key, row));
    console.log('');
  }
}
