#!/usr/bin/env node
/**
 * checksum.mjs — 重新计算并更新 manifest.json 中的 SHA-256 校验和与文件大小。
 *
 *   node scripts/checksum.mjs
 *
 * 每次修改 data/ 下的 JSON 后运行，保持 manifest 校验和准确。
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const MANIFEST = resolve(DATA, 'manifest.json');

const FILES = [
  'topics.zh.json',
  'dependencies.zh.json',
  'clusters.zh.json',
  'cn-curriculum-standards.json',
];

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.files = manifest.files || {};

for (const name of FILES) {
  const bytes = readFileSync(resolve(DATA, name));
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  manifest.files[name] = { bytes: bytes.length, sha256 };
}

writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');

console.log('✓ manifest.json 校验和已更新:');
for (const [name, meta] of Object.entries(manifest.files)) {
  console.log(`  ${name}  ${meta.bytes} bytes  ${meta.sha256.slice(0, 16)}…`);
}
