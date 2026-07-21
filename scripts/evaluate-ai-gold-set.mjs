#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

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

export function evaluateGoldSet(records) {
  const groups = {};
  for (const record of records) {
    const key = `${record.subject}|${record.kind}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(record);
  }
  return {
    groups: Object.fromEntries(Object.entries(groups).map(([key, rows]) => {
      const agreed = rows.filter(row => row.reviewerA === row.reviewerB);
      const positive = positiveLabel(rows[0]?.kind);
      const tp = agreed.filter(row => row.predicted === positive && row.reviewerA === positive).length;
      const fp = agreed.filter(row => row.predicted === positive && row.reviewerA !== positive).length;
      const fn = agreed.filter(row => row.predicted !== positive && row.reviewerA === positive).length;
      return [key, {
        total: rows.length,
        consensusCount: agreed.length,
        precision: tp + fp ? tp / (tp + fp) : null,
        recall: tp + fn ? tp / (tp + fn) : null,
        kappa: kappa(rows),
        sampleReady: agreed.length >= 30,
      }];
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file) throw new Error('用法: node scripts/evaluate-ai-gold-set.mjs <gold-set.json>');
  console.log(JSON.stringify(evaluateGoldSet(JSON.parse(readFileSync(resolve(file), 'utf8'))), null, 2));
}
