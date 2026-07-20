#!/usr/bin/env node
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const topicsPath = new URL('../../data/topics.zh.json', import.meta.url);
const beforeMtime = statSync(topicsPath).mtimeMs;
const moduleUrl = new URL('../align-math-standards.mjs', import.meta.url).href;
const result = spawnSync(process.execPath, [
  '--input-type=module',
  '--eval',
  `await import(${JSON.stringify(moduleUrl)})`,
], {
  encoding: 'utf8',
  env: {
    ...process.env,
    LLM_API: 'openai',
    LLM_BASE_URL: 'http://127.0.0.1:1',
    LLM_API_KEY: 'test-only',
    LLM_MODEL: 'test-only',
  },
  timeout: 5000,
  maxBuffer: 4 * 1024 * 1024,
});
const afterMtime = statSync(topicsPath).mtimeMs;

assert.equal(result.status, 0, result.stderr || result.stdout);
assert.doesNotMatch(result.stdout, /模型:|对齐结果|已写 data\/topics\.zh\.json/, 'import must not enter the CLI main flow');
assert.equal(result.stderr, '', 'import must not report CLI errors');
assert.equal(afterMtime, beforeMtime, 'import must not rewrite topics.zh.json');

console.log('✓ importing align-math-standards.mjs has no side effects');
