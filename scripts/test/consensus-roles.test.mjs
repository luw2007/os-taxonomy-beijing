import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildRoleRequest,
  callOpenAICompatibleRole,
  edgeContentFingerprint,
  runRoleCalls,
  validatePacket,
  validateRoleConfigs,
  validateRoleResponse,
} from '../consensus-roles.mjs';
import { buildConsensusEvidence } from '../consensus-review.mjs';

const edge = (topicId, prerequisiteId, strength = 'hard') => {
  const persisted = { topicId, prerequisiteId, strength, reason: `${prerequisiteId} before ${topicId}`, reviewStatus: 'machine' };
  return {
    topicId,
    prerequisiteId,
    strength,
    reason: persisted.reason,
    contentFingerprint: edgeContentFingerprint(persisted),
    topic: { id: topicId, name: topicId },
    prerequisite: { id: prerequisiteId, name: prerequisiteId },
  };
};

const packet = {
  format: 'beijing-skill-taxonomy-edge-review-packet/v1',
  source: {
    taxonomyVersion: '1.2.0-zh.0',
    cnTopicsSha256: 'a'.repeat(64),
    cnDependenciesSha256: 'b'.repeat(64),
  },
  edges: [edge('mtc_b', 'mtc_a'), edge('mtc_d', 'mtc_c', 'soft')],
};

const configs = {
  necessity: { endpoint: 'https://one.invalid/v1', model: 'model-one', apiKeyEnv: 'KEY_ONE', systemPrompt: 'Check necessity.', timeoutMs: 1_000 },
  direction: { endpoint: 'https://two.invalid/v1', model: 'model-two', apiKeyEnv: 'KEY_TWO', systemPrompt: 'Check direction.', timeoutMs: 1_000 },
  adversary: { endpoint: 'https://three.invalid/v1', model: 'model-three', apiKeyEnv: 'KEY_THREE', systemPrompt: 'Challenge the edge.', timeoutMs: 1_000 },
};

function responseFor(request, overrides = {}) {
  return JSON.stringify({
    format: 'beijing-skill-taxonomy-ai-role-response/v1',
    requestId: request.requestId,
    packetId: request.packetId,
    role: request.role,
    configuredModel: request.configuredModel,
    votes: request.edges.map(item => ({
      topicId: item.topicId,
      prerequisiteId: item.prerequisiteId,
      verdict: 'reviewed',
      resolvedStrength: 'unchanged',
      reason: `reason from ${request.role}`,
      references: [],
    })),
    ...overrides,
  });
}

test('role config requires exactly three roles and distinct configured models', () => {
  assert.doesNotThrow(() => validateRoleConfigs(configs));
  assert.throws(() => validateRoleConfigs({ ...configs, adversary: { ...configs.adversary, model: 'model-one' } }), /distinct configured model/i);
  assert.throws(() => validateRoleConfigs({ necessity: configs.necessity, direction: configs.direction }), /exactly.*necessity.*direction.*adversary/i);
  assert.throws(() => validateRoleConfigs({ ...configs, necessity: { ...configs.necessity, unexpected: true } }), /unsupported field/i);
});

test('duplicate configured models fail closed before any role caller runs', async () => {
  let calls = 0;
  await assert.rejects(() => runRoleCalls({
    packet,
    configs: { ...configs, adversary: { ...configs.adversary, model: 'model-one' } },
    runId: 'run-duplicate',
    caller: async () => { calls++; },
  }), /distinct configured model/i);
  assert.equal(calls, 0);
});

test('each role request contains only its own config and the packet, never sibling outputs', () => {
  const request = buildRoleRequest({ role: 'necessity', config: configs.necessity, packet, runId: 'run-isolation' });
  const serialized = JSON.stringify(request);
  assert.equal(request.role, 'necessity');
  assert.equal(request.configuredModel, 'model-one');
  assert.equal(serialized.includes('model-two'), false);
  assert.equal(serialized.includes('model-three'), false);
  assert.equal(serialized.includes('sibling-output-marker'), false);
});

test('packet topic context is an allowlisted teaching projection and rejects centrality or other extras', () => {
  assert.doesNotThrow(() => validatePacket(packet));
  for (const field of ['centrality', 'reviewedBy', 'splitFrom']) {
    const tampered = structuredClone(packet);
    tampered.edges[0].topic[field] = field === 'centrality' ? 0.5 : 'private';
    assert.throws(() => validatePacket(tampered), /unsupported field/i);
  }
  const edgeAudit = structuredClone(packet);
  edgeAudit.edges[0].reviewStatus = 'machine';
  assert.throws(() => validatePacket(edgeAudit), /packet edge.*unsupported field/i);
});

test('role response validation enforces identity echoes, enums, required fields, bounds, and exact once-only edge coverage', () => {
  const request = buildRoleRequest({ role: 'necessity', config: configs.necessity, packet, runId: 'run-schema' });
  assert.equal(validateRoleResponse(responseFor(request), request).votes.length, 2);
  assert.throws(() => validateRoleResponse('{not-json', request), /well-formed JSON/i);
  assert.throws(() => validateRoleResponse(responseFor(request, { role: 'direction' }), request), /identity echo.*role/i);

  const base = JSON.parse(responseFor(request));
  const missing = structuredClone(base);
  delete missing.votes[0].reason;
  assert.throws(() => validateRoleResponse(JSON.stringify(missing), request), /required.*reason/i);

  const invalidEnum = structuredClone(base);
  invalidEnum.votes[0].verdict = 'maybe';
  assert.throws(() => validateRoleResponse(JSON.stringify(invalidEnum), request), /verdict/i);

  const tooLong = structuredClone(base);
  tooLong.votes[0].reason = 'x'.repeat(2_001);
  assert.throws(() => validateRoleResponse(JSON.stringify(tooLong), request), /reason.*2000/i);

  const missingEdge = structuredClone(base);
  missingEdge.votes.pop();
  assert.throws(() => validateRoleResponse(JSON.stringify(missingEdge), request), /exact edge set/i);

  const duplicateEdge = structuredClone(base);
  duplicateEdge.votes[1] = structuredClone(duplicateEdge.votes[0]);
  assert.throws(() => validateRoleResponse(JSON.stringify(duplicateEdge), request), /duplicate edge/i);

  const extraEdge = structuredClone(base);
  extraEdge.votes.push({ ...extraEdge.votes[0], topicId: 'mtc_extra' });
  assert.throws(() => validateRoleResponse(JSON.stringify(extraEdge), request), /extra edge/i);
});

test('one malformed, missing-field, or timed-out role invalidates the whole packet without partial votes', async () => {
  for (const failure of ['malformed', 'missing', 'timeout']) {
    const result = await runRoleCalls({
      packet,
      configs,
      runId: `run-${failure}`,
      caller: async ({ request }) => {
        if (request.role !== 'direction') return { actualModel: `${request.role}-actual`, content: responseFor(request) };
        if (failure === 'malformed') return { actualModel: 'direction-actual', content: '{bad' };
        if (failure === 'missing') {
          const parsed = JSON.parse(responseFor(request));
          delete parsed.votes[0].resolvedStrength;
          return { actualModel: 'direction-actual', content: JSON.stringify(parsed) };
        }
        const error = new Error('timed out');
        error.name = 'AbortError';
        throw error;
      },
    });
    assert.equal(result.valid, false, failure);
    assert.deepEqual(result.roles.direction.votes, [], failure);
    assert.equal(result.roles.direction.status, failure === 'timeout' ? 'timeout' : 'invalid');
  }
});

test('three distinct actual model identifiers are required after calls complete', async () => {
  const result = await runRoleCalls({
    packet,
    configs,
    runId: 'run-actual-models',
    caller: async ({ request }) => ({ actualModel: 'same-actual-model', content: responseFor(request) }),
  });
  assert.equal(result.valid, false);
  assert.match(result.error, /distinct actual model/i);
});

test('OpenAI-compatible caller requires credentials, reports actual model, and times out fail closed', async () => {
  const request = buildRoleRequest({ role: 'necessity', config: configs.necessity, packet, runId: 'run-http' });
  await assert.rejects(() => callOpenAICompatibleRole({ request, config: configs.necessity, env: {}, fetchImpl: async () => assert.fail('must not call') }), /KEY_ONE/);

  let body;
  const ok = await callOpenAICompatibleRole({
    request,
    config: configs.necessity,
    env: { KEY_ONE: 'secret' },
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return { ok: true, json: async () => ({ model: 'actual-one', choices: [{ message: { content: responseFor(request) } }] }) };
    },
  });
  assert.equal(ok.actualModel, 'actual-one');
  assert.equal(body.model, 'model-one');
  assert.equal(JSON.stringify(body).includes('model-two'), false);

  let errorBodyRead = false;
  await assert.rejects(() => callOpenAICompatibleRole({
    request,
    config: configs.necessity,
    env: { KEY_ONE: 'secret' },
    fetchImpl: async () => ({ ok: false, status: 429, text: async () => { errorBodyRead = true; return 'provider-secret-body'; } }),
  }), error => {
    assert.equal(errorBodyRead, false);
    assert.equal(error.message.includes('provider-secret-body'), false);
    assert.match(error.message, /HTTP 429/);
    return true;
  });

  await assert.rejects(() => callOpenAICompatibleRole({
    request,
    config: { ...configs.necessity, timeoutMs: 10 },
    env: { KEY_ONE: 'secret' },
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  }), /timeout/i);
});

test('provider HTTP error bodies never enter role results or persisted evidence', async () => {
  const secretBody = 'provider-private-error-body';
  const result = await runRoleCalls({
    packet,
    configs,
    runId: 'run-http-redaction',
    caller: async ({ request, config }) => {
      if (request.role !== 'direction') return { actualModel: `${request.role}-actual`, content: responseFor(request) };
      return callOpenAICompatibleRole({
        request,
        config,
        env: { [config.apiKeyEnv]: 'secret' },
        fetchImpl: async () => ({ ok: false, status: 503, text: async () => secretBody }),
      });
    },
  });
  assert.equal(result.valid, false);
  assert.equal(JSON.stringify(result).includes(secretBody), false);
  const evidence = buildConsensusEvidence({ packet, roleRun: result, completedAt: '2026-07-27T00:00:00.000Z' });
  assert.equal(JSON.stringify(evidence).includes(secretBody), false);
});
