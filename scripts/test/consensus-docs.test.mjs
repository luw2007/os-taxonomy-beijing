import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { validateRoleConfigs } from '../consensus-roles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('operator docs prominently disclose the OMP peer-isolation limitation', async () => {
  const docs = await readFile(resolve(ROOT, 'docs', 'ai-consensus-workflow.md'), 'utf8');
  assert.match(docs, /重要限制/);
  assert.match(docs, /OMP harness 不能证明架构层级的 subagent peer isolation/);
  assert.match(docs, /不把任何 sibling role 输出放入其输入/);
  assert.match(docs, /不能写成或理解为 architecture-grade blind-isolation guarantee/);
});

test('tracked example config supplies separate valid role configs and package scripts keep review and apply separate', async () => {
  const config = JSON.parse(await readFile(resolve(ROOT, 'reviews', 'ai-consensus', 'v1', 'roles.example.json'), 'utf8'));
  assert.doesNotThrow(() => validateRoleConfigs(config.roles));
  const pkg = JSON.parse(await readFile(resolve(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['consensus:review'], 'node scripts/consensus-review.mjs review');
  assert.equal(pkg.scripts['consensus:apply'], 'node scripts/consensus-review.mjs apply');
});

test('docs describe postapply verification and evidence limitations without claiming provider attestation', async () => {
  const docs = await readFile(resolve(ROOT, 'docs', 'ai-consensus-workflow.md'), 'utf8');
  assert.match(docs, /make consensus-postapply/);
  assert.match(docs, /self-consistent|自洽/);
  assert.match(docs, /hash-sealed/);
  assert.match(docs, /不是 provider attestation/);
  assert.match(docs, /topic.*漂移|教学上下文.*漂移/);
  assert.match(docs, /centrality/);
  assert.match(docs, /quarantined conflict/);
});

test('Makefile exposes offline consensus targets and no consensus recipe calls write mode', async () => {
  const makefile = await readFile(resolve(ROOT, 'Makefile'), 'utf8');
  for (const target of ['consensus-plan:', 'consensus-dryrun:', 'consensus-apply-plan:', 'consensus-apply-dryrun:', 'consensus-postapply:']) {
    assert.equal(makefile.includes(target), true, target);
  }
  for (const line of makefile.split('\n').filter(line => line.startsWith('\t') && line.includes('consensus-review.mjs'))) {
    assert.equal(line.includes('--write'), false, line);
  }
  assert.match(makefile, /consensus-postapply: checksum[\s\S]*validate\.mjs --publish[\s\S]*npm test/);
});

test('CI consensus smoke is offline and env example contains credential names but no role endpoint/model values', async () => {
  const ci = await readFile(resolve(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(ci, /AI consensus offline review smoke \(no secrets\)/);
  assert.match(ci, /consensus-review\.mjs review[^\n]+--plan/);
  assert.match(ci, /consensus-review\.mjs review[^\n]+--dry-run/);
  const envExample = await readFile(resolve(ROOT, '.env.example'), 'utf8');
  for (const role of ['NECESSITY', 'DIRECTION', 'ADVERSARY']) assert.match(envExample, new RegExp(`AI_CONSENSUS_${role}_API_KEY=`));
  assert.equal(/AI_CONSENSUS_.*(?:ENDPOINT|MODEL)=/.test(envExample), false);
});

test('gitignore excludes consensus locks/temp/fixture scratch while retaining run JSON evidence', async () => {
  const ignore = await readFile(resolve(ROOT, '.gitignore'), 'utf8');
  assert.match(ignore, /reviews\/ai-consensus\/v1\/runs\/\*\.lock/);
  assert.match(ignore, /reviews\/ai-consensus\/v1\/runs\/\.fixture-scratch\//);
  assert.equal(ignore.includes('reviews/ai-consensus/v1/runs/*.json'), false);
});
