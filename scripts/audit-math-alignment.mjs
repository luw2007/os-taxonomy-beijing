#!/usr/bin/env node
/**
 * audit-math-alignment.mjs — 报告小学数学对齐分档缺口，不修改数据。
 * 本地 .align-work/align-result.json 是历史对齐证据；若缺失，明确报错而不猜测。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const load = path => JSON.parse(readFileSync(path, 'utf8'));
const manifest = load(resolve(DATA, 'manifest.json'));
const resultPath = resolve(DATA, '.align-work', 'align-result.json');
if (!existsSync(resultPath)) throw new Error(`缺少本地对齐证据: ${resultPath}`);
const result = load(resultPath);
const tiers = { high: [], medium: [] };
for (const [id, item] of Object.entries(result)) if (tiers[item.confidence]) tiers[item.confidence].push(id);
const counts = manifest.counts;
const aligned = tiers.high.length + tiers.medium.length;
const undisposed = counts.alignedMathTotal - aligned - counts.alignedMathLowExcluded;
console.log(JSON.stringify({
  alignedMathTotal: counts.alignedMathTotal,
  high: { manifest: counts.alignedMathHigh, evidence: tiers.high.length },
  medium: { manifest: counts.alignedMathMedium, evidence: tiers.medium.length },
  lowExcluded: counts.alignedMathLowExcluded,
  undisposed,
  conclusion: undisposed === 0 ? '所有候选已有处置' : '存在未记录处置的候选；本脚本不推断其分档',
}, null, 2));
