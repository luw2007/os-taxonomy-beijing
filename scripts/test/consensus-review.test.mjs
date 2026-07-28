import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildRoleRequest, edgeContentFingerprint } from '../consensus-roles.mjs';
import {
  applyConsensusEvidence,
  assertConfigModelsMatchEvidence,
  assertEvidenceFileRef,
  assertWriteableApplyResult,
  atomicLockedJsonWrite,
  atomicLockedJsonUpdate,
  buildConsensusEvidence,
  deriveReviewedBy,
  validateConsensusEvidence,
} from '../consensus-review.mjs';

const configs = {
  necessity: { endpoint: 'https://one.invalid/v1', model: 'model-one', apiKeyEnv: 'KEY_ONE', systemPrompt: 'necessity', timeoutMs: 1_000 },
  direction: { endpoint: 'https://two.invalid/v1', model: 'model-two', apiKeyEnv: 'KEY_TWO', systemPrompt: 'direction', timeoutMs: 1_000 },
  adversary: { endpoint: 'https://three.invalid/v1', model: 'model-three', apiKeyEnv: 'KEY_THREE', systemPrompt: 'adversary', timeoutMs: 1_000 },
};

function persistedEdge(topicId, prerequisiteId, strength = 'hard') {
  return { topicId, prerequisiteId, strength, reason: `${prerequisiteId} before ${topicId}`, reviewStatus: 'machine' };
}

function packetEdge(edge) {
  return {
    topicId: edge.topicId,
    prerequisiteId: edge.prerequisiteId,
    strength: edge.strength,
    reason: edge.reason,
    contentFingerprint: edgeContentFingerprint(edge),
    topic: { id: edge.topicId, name: edge.topicId },
    prerequisite: { id: edge.prerequisiteId, name: edge.prerequisiteId },
  };
}

function packetFor(edges) {
  return {
    format: 'beijing-skill-taxonomy-edge-review-packet/v1',
    source: { taxonomyVersion: '1.2.0-zh.0', cnTopicsSha256: 'a'.repeat(64), cnDependenciesSha256: 'b'.repeat(64) },
    edges: edges.map(packetEdge),
  };
}

function validRoleRun(packet, voteFor = () => ({ verdict: 'reviewed', resolvedStrength: 'unchanged' })) {
  const runId = 'run-consensus';
  const roles = {};
  for (const role of ['necessity', 'direction', 'adversary']) {
    const request = buildRoleRequest({ role, config: configs[role], packet, runId });
    const votes = packet.edges.map((edge, index) => ({
      topicId: edge.topicId,
      prerequisiteId: edge.prerequisiteId,
      ...voteFor({ role, edge, index }),
      reason: `${role} audit reason ${index}`,
      references: [`${role} citation ${index}`],
    }));
    roles[role] = {
      status: 'valid',
      configuredModel: configs[role].model,
      actualModel: `${role}-actual-model`,
      request,
      rawResponse: JSON.stringify({
        format: 'beijing-skill-taxonomy-ai-role-response/v1',
        requestId: request.requestId,
        packetId: request.packetId,
        role: request.role,
        configuredModel: request.configuredModel,
        votes,
      }),
      votes,
    };
  }
  return { valid: true, runId, roles };
}

function topicsFor(edges, mutate = topic => topic) {
  const topics = [];
  for (const edge of edges) {
    topics.push(mutate({ id: edge.topicId, name: edge.topicId }));
    topics.push(mutate({ id: edge.prerequisiteId, name: edge.prerequisiteId }));
  }
  return { topics };
}

test('exact unanimity compares only normalized (verdict, resolvedStrength), ignoring reasons', () => {
  const edge = persistedEdge('mtc_b', 'mtc_a', 'hard');
  const packet = packetFor([edge]);
  const evidence = buildConsensusEvidence({ packet, roleRun: validRoleRun(packet), completedAt: '2026-07-27T00:00:00.000Z' });
  assert.equal(evidence.proposals.length, 1);
  assert.equal(evidence.proposals[0].verdict, 'reviewed');
  assert.equal(evidence.proposals[0].resolvedStrength, 'hard');
  assert.equal(evidence.edges[0].consensus, 'unanimous-reviewed');
});

test('resolvedStrength disagreement leaves the edge machine with no proposal', () => {
  const edge = persistedEdge('mtc_b', 'mtc_a', 'hard');
  const packet = packetFor([edge]);
  const roleRun = validRoleRun(packet, ({ role }) => ({ verdict: 'reviewed', resolvedStrength: role === 'adversary' ? 'soft' : 'unchanged' }));
  const evidence = buildConsensusEvidence({ packet, roleRun, completedAt: '2026-07-27T00:00:00.000Z' });
  assert.equal(evidence.proposals.length, 0);
  assert.equal(evidence.edges[0].consensus, 'disagreement');
});

test('verdict disagreement and unanimous rejected votes are audit-only and never applyable', () => {
  const edge = persistedEdge('mtc_b', 'mtc_a');
  const packet = packetFor([edge]);
  const disagreement = buildConsensusEvidence({
    packet,
    roleRun: validRoleRun(packet, ({ role }) => ({ verdict: role === 'necessity' ? 'rejected' : 'reviewed', resolvedStrength: 'unchanged' })),
    completedAt: '2026-07-27T00:00:00.000Z',
  });
  assert.equal(disagreement.proposals.length, 0);

  const rejected = buildConsensusEvidence({
    packet,
    roleRun: validRoleRun(packet, () => ({ verdict: 'rejected', resolvedStrength: 'unchanged' })),
    completedAt: '2026-07-27T00:00:00.000Z',
  });
  assert.equal(rejected.edges[0].consensus, 'unanimous-rejected');
  assert.equal(rejected.proposals.length, 0);
  assert.deepEqual(applyConsensusEvidence({ dependencies: { edgeCount: 1, dependencies: [edge] }, evidence: rejected }).applied, []);
});

test('any invalid role fails closed for the entire packet while retaining durable failure audit', () => {
  const edges = [persistedEdge('mtc_b', 'mtc_a'), persistedEdge('mtc_d', 'mtc_c')];
  const packet = packetFor(edges);
  const roleRun = validRoleRun(packet);
  roleRun.valid = false;
  roleRun.error = 'direction timed out';
  roleRun.roles.direction = { ...roleRun.roles.direction, status: 'timeout', actualModel: null, rawResponse: null, votes: [], error: 'timeout' };
  const evidence = buildConsensusEvidence({ packet, roleRun, completedAt: '2026-07-27T00:00:00.000Z' });
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.proposals.length, 0);
  assert.equal(evidence.roles.direction.status, 'timeout');
  assert.equal(evidence.edges.every(edge => edge.consensus === 'packet-failed'), true);
  assert.match(evidence.error, /direction timed out/);
});

test('reviewedBy is deterministic from audit identities and votes, not accepted as input', () => {
  const packet = packetFor([persistedEdge('mtc_b', 'mtc_a')]);
  const evidence = buildConsensusEvidence({ packet, roleRun: validRoleRun(packet), completedAt: '2026-07-27T00:00:00.000Z' });
  const proposal = evidence.proposals[0];
  assert.match(proposal.reviewedBy, /^ai-consensus-v1:[a-f0-9]{64}$/);
  assert.equal(proposal.reviewedBy, deriveReviewedBy(evidence, evidence.edges[0]));
  const tampered = structuredClone(evidence);
  tampered.proposals[0].reviewedBy = 'free-form-input';
  assert.throws(() => validateConsensusEvidence(tampered), /reviewedBy.*derived/i);
});

test('evidence binds packet source checksums and every edge content fingerprint', () => {
  const edges = [persistedEdge('mtc_b', 'mtc_a'), persistedEdge('mtc_d', 'mtc_c', 'soft')];
  const packet = packetFor(edges);
  const evidence = buildConsensusEvidence({ packet, roleRun: validRoleRun(packet), completedAt: '2026-07-27T00:00:00.000Z' });
  assert.deepEqual(evidence.source, packet.source);
  assert.deepEqual(evidence.edges.map(edge => edge.contentFingerprint), packet.edges.map(edge => edge.contentFingerprint));
  assert.doesNotThrow(() => validateConsensusEvidence(evidence));
  const tampered = structuredClone(evidence);
  tampered.source.cnDependenciesSha256 = 'c'.repeat(64);
  assert.throws(() => validateConsensusEvidence(tampered), /evidence hash|source/i);
});

test('evidence validation re-derives consensus and forbids proposals on failed packets', () => {
  const packet = packetFor([persistedEdge('mtc_b', 'mtc_a')]);
  const disagreement = buildConsensusEvidence({
    packet,
    roleRun: validRoleRun(packet, ({ role }) => ({ verdict: 'reviewed', resolvedStrength: role === 'adversary' ? 'soft' : 'hard' })),
    completedAt: '2026-07-27T00:00:00.000Z',
  });
  disagreement.edges[0].consensus = 'unanimous-reviewed';
  disagreement.edges[0].resolvedStrength = 'hard';
  disagreement.proposals.push({
    topicId: 'mtc_b', prerequisiteId: 'mtc_a', contentFingerprint: disagreement.edges[0].contentFingerprint,
    verdict: 'reviewed', resolvedStrength: 'hard', reviewedBy: deriveReviewedBy(disagreement, disagreement.edges[0]),
    reviewedAt: disagreement.completedAt, reviewEvidenceRef: disagreement.evidenceRef,
  });
  disagreement.evidenceHash = '0'.repeat(64);
  assert.throws(() => validateConsensusEvidence(disagreement), /re-derived consensus/i);

  const failedRun = validRoleRun(packet);
  failedRun.valid = false;
  failedRun.roles.adversary = { ...failedRun.roles.adversary, status: 'timeout', rawResponse: null, votes: [], error: 'timeout' };
  const failed = buildConsensusEvidence({ packet, roleRun: failedRun, completedAt: '2026-07-27T00:00:00.000Z' });
  failed.edges[0].consensus = 'unanimous-reviewed';
  failed.edges[0].resolvedStrength = 'hard';
  assert.throws(() => validateConsensusEvidence(failed), /failed evidence.*proposal|packet-failed/i);
});

test('actual model collision is durable failed evidence and cannot produce proposals', () => {
  const packet = packetFor([persistedEdge('mtc_b', 'mtc_a')]);
  const roleRun = validRoleRun(packet);
  roleRun.valid = false;
  roleRun.error = 'actual model collision';
  for (const role of Object.keys(roleRun.roles)) roleRun.roles[role].actualModel = 'same-actual-model';
  const evidence = buildConsensusEvidence({ packet, roleRun, completedAt: '2026-07-27T00:00:00.000Z' });
  assert.equal(evidence.status, 'failed');
  assert.equal(evidence.proposals.length, 0);
  assert.doesNotThrow(() => validateConsensusEvidence(evidence));
});

test('evidence validation binds canonical run/ref, exact request context, and raw response votes', () => {
  const packet = packetFor([persistedEdge('mtc_b', 'mtc_a')]);
  const evidence = buildConsensusEvidence({ packet, roleRun: validRoleRun(packet), completedAt: '2026-07-27T00:00:00.000Z' });

  for (const mutate of [
    item => { item.roles.necessity.request.requestId = 'forged'; },
    item => { item.roles.necessity.request.source.taxonomyVersion = 'forged'; },
    item => { item.roles.necessity.request.edges[0].topic.name = 'forged'; },
    item => { item.roles.necessity.votes[0].reason = 'stored vote tamper'; },
    item => { item.runId = '../unsafe'; },
    item => { item.evidenceRef = 'reviews/ai-consensus/v1/runs/other.json'; },
  ]) {
    const tampered = structuredClone(evidence);
    mutate(tampered);
    assert.throws(() => validateConsensusEvidence(tampered));
  }

  const rawTampered = structuredClone(evidence);
  const raw = JSON.parse(rawTampered.roles.direction.rawResponse);
  raw.votes[0].reason = 'raw response tamper';
  rawTampered.roles.direction.rawResponse = JSON.stringify(raw);
  assert.throws(() => validateConsensusEvidence(rawTampered), /raw response votes/i);

  for (const mutate of [
    item => { item.completedAt = 'not-a-timestamp'; },
    item => { item.unbound = true; },
    item => { item.roles.necessity.unbound = true; },
    item => { item.proposals[0].unbound = true; },
  ]) {
    const unsupported = structuredClone(evidence);
    mutate(unsupported);
    assert.throws(() => validateConsensusEvidence(unsupported), /timestamp|unsupported field/i);
  }
});

test('apply uses per-edge fingerprint CAS, touches only live machine edges, and keeps independent conflicts isolated', () => {
  const fresh = persistedEdge('mtc_b', 'mtc_a', 'hard');
  const stale = persistedEdge('mtc_d', 'mtc_c', 'soft');
  const noLongerMachine = persistedEdge('mtc_f', 'mtc_e', 'hard');
  const packet = packetFor([fresh, stale, noLongerMachine]);
  const evidence = buildConsensusEvidence({ packet, roleRun: validRoleRun(packet), completedAt: '2026-07-27T00:00:00.000Z' });
  const live = {
    edgeCount: 3,
    dependencies: [
      fresh,
      { ...stale, reason: 'content changed after packet' },
      { ...noLongerMachine, reviewStatus: 'reviewed', reviewProvenance: 'rule' },
    ],
  };
  const result = applyConsensusEvidence({ dependencies: live, topics: topicsFor([fresh, stale, noLongerMachine]), evidence });
  assert.deepEqual(result.applied, ['mtc_b<-mtc_a']);
  assert.deepEqual(result.conflicts.map(item => item.code).sort(), ['not-machine', 'stale-fingerprint']);
  const applied = result.document.dependencies[0];
  assert.equal(applied.reviewStatus, 'reviewed');
  assert.equal(applied.reviewProvenance, 'ai-consensus');
  assert.equal(applied.reviewedBy, evidence.proposals[0].reviewedBy);
  assert.equal(applied.reviewedAt, '2026-07-27T00:00:00.000Z');
  assert.equal('reviewNote' in applied, false);
  assert.equal('consensusReason' in applied, false);
  assert.deepEqual(result.document.dependencies[1], live.dependencies[1]);
  assert.deepEqual(result.document.dependencies[2], live.dependencies[2]);
});

test('apply quarantines audit/flagged machine edges without deleting fields', () => {
  const fields = [
    'rescopeRequired', 'previousReviewStatus', 'ageRegression', 'reviewNote', 'reviewerRole', 'reviewRubric',
    'reviewProvenance', 'reviewedBy', 'reviewedAt', 'reviewEvidenceRef',
  ];
  for (const field of fields) {
    const edge = { ...persistedEdge('mtc_b', 'mtc_a'), [field]: field === 'ageRegression' || field === 'rescopeRequired' ? true : 'existing' };
    const packet = packetFor([edge]);
    const evidence = buildConsensusEvidence({ packet, roleRun: validRoleRun(packet), completedAt: '2026-07-27T00:00:00.000Z' });
    const result = applyConsensusEvidence({ dependencies: { dependencies: [edge] }, topics: topicsFor([edge]), evidence });
    assert.deepEqual(result.applied, []);
    assert.deepEqual(result.conflicts, [{ edge: 'mtc_b<-mtc_a', code: 'quarantined' }]);
    assert.deepEqual(result.document.dependencies[0], edge);
  }
});

test('topic context drift aborts the whole run while centrality-only drift is ignored', () => {
  const first = persistedEdge('mtc_b', 'mtc_a');
  const second = persistedEdge('mtc_d', 'mtc_c');
  const packet = packetFor([first, second]);
  const evidence = buildConsensusEvidence({ packet, roleRun: validRoleRun(packet), completedAt: '2026-07-27T00:00:00.000Z' });
  const dependencies = { dependencies: [first, second] };
  const centralityOnly = topicsFor([first, second], topic => ({ ...topic, centrality: 0.9 }));
  assert.equal(applyConsensusEvidence({ dependencies, topics: centralityOnly, evidence }).applied.length, 2);

  const drifted = structuredClone(centralityOnly);
  drifted.topics.find(topic => topic.id === 'mtc_c').name = 'changed teaching context';
  assert.throws(() => applyConsensusEvidence({ dependencies, topics: drifted, evidence }), /topic context drifted.*no proposals applied/i);
  assert.equal(dependencies.dependencies.every(edge => edge.reviewStatus === 'machine'), true);
});

test('apply fails closed on duplicate dependency or topic identities', () => {
  const edge = persistedEdge('mtc_b', 'mtc_a');
  const packet = packetFor([edge]);
  const evidence = buildConsensusEvidence({ packet, roleRun: validRoleRun(packet), completedAt: '2026-07-27T00:00:00.000Z' });
  assert.throws(() => applyConsensusEvidence({
    dependencies: { dependencies: [edge, structuredClone(edge)] }, topics: topicsFor([edge]), evidence,
  }), /duplicate edge/i);
  assert.throws(() => applyConsensusEvidence({
    dependencies: { dependencies: [edge] }, topics: { topics: [{ id: 'mtc_a', name: 'A' }, { id: 'mtc_a', name: 'A again' }, { id: 'mtc_b', name: 'B' }] }, evidence,
  }), /duplicate topic/i);
});

test('write gate binds configured models without credentials and refuses replay/all-stale results', () => {
  const packet = packetFor([persistedEdge('mtc_b', 'mtc_a')]);
  const evidence = buildConsensusEvidence({ packet, roleRun: validRoleRun(packet), completedAt: '2026-07-27T00:00:00.000Z' });
  assert.doesNotThrow(() => assertConfigModelsMatchEvidence(configs, evidence));
  assert.throws(() => assertConfigModelsMatchEvidence({ ...configs, direction: { ...configs.direction, model: 'different' } }, evidence), /configured model does not match evidence/i);
  assert.doesNotThrow(() => assertEvidenceFileRef(evidence, evidence.evidenceRef));
  assert.throws(() => assertEvidenceFileRef(evidence, 'reviews/ai-consensus/v1/runs/other.json'), /actual evidence file path/i);
  assert.doesNotThrow(() => assertWriteableApplyResult(evidence, { applied: ['mtc_b<-mtc_a'] }));
  assert.throws(() => assertWriteableApplyResult(evidence, { applied: [] }), /replay or all-stale/i);
});

test('atomic locked JSON write/update creates temp then renames under a single-writer lock', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'consensus-write-'));
  try {
    const targetPath = join(dir, 'data.json');
    const lockPath = join(dir, 'data.lock');
    await writeFile(targetPath, '{"old":true}\n');
    const steps = [];
    const fsOps = {
      ...fs,
      openSync(path, flags, mode) { steps.push(`open:${path === lockPath ? 'lock' : 'temp'}:${flags}`); return fs.openSync(path, flags, mode); },
      renameSync(from, to) { steps.push(`rename:${from !== targetPath}:${to === targetPath}`); return fs.renameSync(from, to); },
      unlinkSync(path) { steps.push(`unlink:${path === lockPath ? 'lock' : 'temp'}`); return fs.unlinkSync(path); },
    };
    atomicLockedJsonWrite({ targetPath, value: { next: true }, lockPath, fsOps });
    assert.deepEqual(JSON.parse(await readFile(targetPath, 'utf8')), { next: true });
    assert.equal(steps[0], 'open:lock:wx');
    assert.ok(steps.some(step => step === 'open:temp:wx'));
    assert.ok(steps.some(step => step.startsWith('rename:true:true')));
    assert.equal(steps.at(-1), 'unlink:lock');

    const updateLockPath = join(dir, 'update.lock');
    let lockWasHeldDuringRead = false;
    atomicLockedJsonUpdate({
      targetPath,
      lockPath: updateLockPath,
      fsOps,
      update: current => {
        lockWasHeldDuringRead = fs.existsSync(updateLockPath);
        assert.deepEqual(current, { next: true });
        return { ...current, updated: true };
      },
    });
    assert.equal(lockWasHeldDuringRead, true);
    assert.deepEqual(JSON.parse(await readFile(targetPath, 'utf8')), { next: true, updated: true });
    assert.equal((await readdir(dir)).some(name => name.includes('.tmp-')), false);

    await writeFile(lockPath, 'held');
    assert.throws(() => atomicLockedJsonWrite({ targetPath, value: { blocked: true }, lockPath }), /single-writer lock/i);
    assert.deepEqual(JSON.parse(await readFile(targetPath, 'utf8')), { next: true, updated: true });
    assert.throws(() => atomicLockedJsonWrite({ targetPath, value: { clobbered: true }, lockPath: join(dir, 'fresh.lock'), refuseExisting: true }), /refusing to clobber/i);
    assert.deepEqual(JSON.parse(await readFile(targetPath, 'utf8')), { next: true, updated: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
