import assert from 'node:assert/strict';
import test from 'node:test';

import { consensusPublishProblems } from '../consensus-publish-gate.mjs';
import { applyConsensusEvidence, buildConsensusEvidence } from '../consensus-review.mjs';
import { buildRoleRequest, edgeContentFingerprint } from '../consensus-roles.mjs';
import { AI_CONSENSUS_REVIEWER } from '../migrate-review-provenance.mjs';

const configs = {
  necessity: { model: 'model-one' },
  direction: { model: 'model-two' },
  adversary: { model: 'model-three' },
};

function fixture() {
  const original = { topicId: 'mtc_b', prerequisiteId: 'mtc_a', strength: 'hard', reason: 'a before b', reviewStatus: 'machine' };
  const packet = {
    format: 'beijing-skill-taxonomy-edge-review-packet/v1',
    source: { taxonomyVersion: '1.2.0-zh.0', cnTopicsSha256: 'a'.repeat(64), cnDependenciesSha256: 'b'.repeat(64) },
    edges: [{
      topicId: original.topicId,
      prerequisiteId: original.prerequisiteId,
      strength: original.strength,
      reason: original.reason,
      contentFingerprint: edgeContentFingerprint(original),
      topic: { id: 'mtc_b', name: 'B' },
      prerequisite: { id: 'mtc_a', name: 'A' },
    }],
  };
  const runId = 'publish-gate-fixture';
  const roles = {};
  for (const role of Object.keys(configs)) {
    const request = buildRoleRequest({ role, config: configs[role], packet, runId });
    const votes = [{
      topicId: 'mtc_b', prerequisiteId: 'mtc_a', verdict: 'reviewed', resolvedStrength: 'unchanged',
      reason: `${role} reason`, references: [],
    }];
    roles[role] = {
      status: 'valid', configuredModel: configs[role].model, actualModel: `${role}-actual`, request, votes,
      rawResponse: JSON.stringify({
        format: 'beijing-skill-taxonomy-ai-role-response/v1', requestId: request.requestId,
        packetId: request.packetId, role, configuredModel: request.configuredModel, votes,
      }),
    };
  }
  const evidence = buildConsensusEvidence({
    packet,
    roleRun: { valid: true, runId, roles },
    completedAt: '2026-07-27T00:00:00.000Z',
  });
  const applied = applyConsensusEvidence({
    dependencies: { dependencies: [original] },
    topics: { topics: [{ id: 'mtc_a', name: 'A' }, { id: 'mtc_b', name: 'B' }] },
    evidence,
  }).document.dependencies[0];
  return { original, evidence, applied };
}

test('publish gate validates v1 evidence, reconstructed preimage, and caches repeated refs', () => {
  const { evidence, applied } = fixture();
  let loads = 0;
  const problems = consensusPublishProblems({
    cnDependencies: [applied],
    bridgeDependencies: [structuredClone(applied)],
    loadEvidence: ref => { loads++; assert.equal(ref, evidence.evidenceRef); return evidence; },
  });
  assert.deepEqual(problems, []);
  assert.equal(loads, 1);
});

test('publish gate rejects proposal field mismatch and reconstructed machine preimage tamper', () => {
  const { evidence, applied } = fixture();
  const loadEvidence = () => evidence;
  for (const [field, value, expected] of [
    ['reviewStatus', 'rejected', /reviewStatus/],
    ['strength', 'soft', /strength/],
    ['reviewedBy', `ai-consensus-v1:${'f'.repeat(64)}`, /reviewedBy/],
    ['reviewEvidenceRef', 'reviews/ai-consensus/v1/runs/other.json', /invalid consensus evidence|reviewEvidenceRef/],
  ]) {
    const edge = { ...applied, [field]: value };
    assert.match(consensusPublishProblems({ cnDependencies: [edge], loadEvidence }).join('\n'), expected);
  }
  const preimageTamper = { ...applied, reason: 'changed after apply' };
  assert.match(consensusPublishProblems({ cnDependencies: [preimageTamper], loadEvidence }).join('\n'), /original machine edge fingerprint/i);
});

test('publish gate preserves exact legacy literal without evidence and prevents v1 impersonation', () => {
  const legacy = {
    topicId: 'mtc_b', prerequisiteId: 'mtc_a', strength: 'hard', reviewStatus: 'reviewed',
    reviewProvenance: 'ai-consensus', reviewedBy: AI_CONSENSUS_REVIEWER, reviewedAt: '2026-07-20T00:00:00.000Z',
  };
  assert.deepEqual(consensusPublishProblems({ cnDependencies: [legacy] }), []);
  assert.match(consensusPublishProblems({ cnDependencies: [{ ...legacy, reviewEvidenceRef: 'reviews/ai-consensus/v1/runs/legacy.json' }] }).join('\n'), /must not impersonate v1/i);
  assert.match(consensusPublishProblems({ cnDependencies: [{ ...legacy, reviewedBy: 'similar-but-not-legacy' }] }).join('\n'), /neither the legacy literal nor a v1/i);
});

test('publish gate rejects non-AI provenance pointing into consensus evidence', () => {
  const edge = {
    topicId: 'mtc_b', prerequisiteId: 'mtc_a', strength: 'hard', reviewStatus: 'reviewed',
    reviewProvenance: 'human', reviewedBy: 'teacher', reviewedAt: '2026-07-27T00:00:00.000Z',
    reviewEvidenceRef: 'reviews/other/../ai-consensus/v1/runs/run.json',
  };
  assert.match(consensusPublishProblems({ bridgeDependencies: [edge] }).join('\n'), /non-AI provenance/i);
});

test('publish gate validates loaded evidence instead of trusting a matching reference', () => {
  const { evidence, applied } = fixture();
  const tampered = structuredClone(evidence);
  tampered.roles.necessity.votes[0].reason = 'tampered stored vote';
  assert.match(consensusPublishProblems({ cnDependencies: [applied], loadEvidence: () => tampered }).join('\n'), /invalid consensus evidence/i);
});
