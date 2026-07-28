import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { edgeContentFingerprint } from '../consensus-roles.mjs';
import { resolveEvidencePath } from '../consensus-review.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI = resolve(ROOT, 'scripts', 'consensus-review.mjs');

test('review --plan and --dry-run are offline and never require credentials or write evidence', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'consensus-cli-'));
  try {
    const persisted = { topicId: 'mtc_b', prerequisiteId: 'mtc_a', strength: 'hard', reason: 'a before b', reviewStatus: 'machine' };
    const packetPath = join(dir, 'packet.json');
    const configPath = join(dir, 'roles.json');
    await writeFile(packetPath, JSON.stringify({
      format: 'beijing-skill-taxonomy-edge-review-packet/v1',
      source: { taxonomyVersion: '1.2.0-zh.0', cnTopicsSha256: 'a'.repeat(64), cnDependenciesSha256: 'b'.repeat(64) },
      edges: [{
        topicId: persisted.topicId, prerequisiteId: persisted.prerequisiteId, strength: persisted.strength, reason: persisted.reason,
        contentFingerprint: edgeContentFingerprint(persisted), topic: { id: 'mtc_b' }, prerequisite: { id: 'mtc_a' },
      }],
    }));
    await writeFile(configPath, JSON.stringify({ format: 'beijing-skill-taxonomy-ai-consensus-role-config/v1', roles: {
      necessity: { endpoint: 'https://one.invalid/v1', model: 'one', apiKeyEnv: 'CONSENSUS_TEST_KEY_ONE', systemPrompt: 'one', timeoutMs: 1000 },
      direction: { endpoint: 'https://two.invalid/v1', model: 'two', apiKeyEnv: 'CONSENSUS_TEST_KEY_TWO', systemPrompt: 'two', timeoutMs: 1000 },
      adversary: { endpoint: 'https://three.invalid/v1', model: 'three', apiKeyEnv: 'CONSENSUS_TEST_KEY_THREE', systemPrompt: 'three', timeoutMs: 1000 },
    } }));
    const env = { ...process.env };
    delete env.CONSENSUS_TEST_KEY_ONE;
    delete env.CONSENSUS_TEST_KEY_TWO;
    delete env.CONSENSUS_TEST_KEY_THREE;

    for (const mode of ['--plan', '--dry-run']) {
      const result = spawnSync(process.execPath, [CLI, 'review', '--packet', packetPath, '--config', configPath, mode, '--run-id', `offline-${mode.slice(2)}`], { encoding: 'utf8', env });
      assert.equal(result.status, 0, result.stderr);
      if (mode === '--dry-run') assert.equal(JSON.parse(result.stdout).networkCalls, false);
    }

    const write = spawnSync(process.execPath, [CLI, 'review', '--packet', packetPath, '--config', configPath, '--write', '--run-id', 'missing-creds'], { encoding: 'utf8', env });
    assert.equal(write.status, 1);
    assert.match(write.stderr, /missing required model-call credentials/i);
    await assert.rejects(() => readFile(resolve(ROOT, 'reviews', 'ai-consensus', 'v1', 'runs', 'missing-creds.json')), /ENOENT/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('consensus evidence paths are canonical direct run JSON files only', () => {
  assert.equal(resolveEvidencePath('reviews/ai-consensus/v1/runs/safe-run.json').ref, 'reviews/ai-consensus/v1/runs/safe-run.json');
  for (const unsafe of [
    'reviews/ai-consensus/v1/runs/nested/run.json',
    'reviews/ai-consensus/v1/runs/../roles.example.json',
    'reviews/ai-consensus/v1/runs/run.txt',
    '/tmp/run.json',
  ]) assert.throws(() => resolveEvidencePath(unsafe), /evidenceRef|canonical/i);
});
