import { readFileSync, realpathSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AI_CONSENSUS_REVIEWER } from './migrate-review-provenance.mjs';
import { validateConsensusEvidence } from './consensus-review.mjs';
import { edgeContentFingerprint, isConsensusEvidenceRef, validateEvidenceRef } from './consensus-roles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V1_REVIEWED_BY = /^ai-consensus-v1:[a-f0-9]{64}$/;

const edgeKey = edge => `${edge.topicId}<-${edge.prerequisiteId}`;

function originalMachineEdge(edge, packetStrength) {
  const original = { ...edge, strength: packetStrength, reviewStatus: 'machine' };
  delete original.reviewProvenance;
  delete original.reviewedBy;
  delete original.reviewedAt;
  delete original.reviewEvidenceRef;
  return original;
}

function defaultEvidenceLoader(root, evidenceRef) {
  const path = resolve(root, evidenceRef);
  const runsRoot = resolve(root, 'reviews', 'ai-consensus', 'v1', 'runs');
  const realRunsRoot = realpathSync(runsRoot);
  const realPath = realpathSync(path);
  const relation = relative(realRunsRoot, realPath);
  if (relation.startsWith('..') || relation.includes(sep) || relation === '') throw new Error('consensus evidence path escaped runs directory');
  if (realPath !== path) throw new Error('consensus evidence path must not be a symbolic link');
  return JSON.parse(readFileSync(realPath, 'utf8'));
}

/**
 * 发布前交叉验证依赖数据与版本化 AI 共识证据。返回问题列表，不修改任何输入。
 * loadEvidence 仅用于单测；同一 evidenceRef 在一次调用中最多加载和校验一次。
 */
export function consensusPublishProblems({ cnDependencies = [], bridgeDependencies = [], root = ROOT, loadEvidence = null }) {
  const problems = [];
  const evidenceCache = new Map();
  const load = loadEvidence ?? (ref => defaultEvidenceLoader(root, ref));

  function evidenceFor(ref) {
    validateEvidenceRef(ref);
    if (evidenceCache.has(ref)) return evidenceCache.get(ref);
    const evidence = load(ref);
    validateConsensusEvidence(evidence);
    if (evidence.status !== 'complete') throw new Error('consensus evidence is not complete');
    if (evidence.evidenceRef !== ref) throw new Error('loaded consensus evidenceRef does not match dependency reference');
    evidenceCache.set(ref, evidence);
    return evidence;
  }

  function inspect(edge, label) {
    const key = `${label} ${edgeKey(edge)}`;
    if (edge.reviewProvenance !== 'ai-consensus') {
      if (isConsensusEvidenceRef(edge.reviewEvidenceRef)) problems.push(`${key}: non-AI provenance must not reference consensus evidence`);
      return;
    }

    if (edge.reviewedBy === AI_CONSENSUS_REVIEWER) {
      if (edge.reviewEvidenceRef !== undefined) problems.push(`${key}: legacy AI consensus must not impersonate v1 evidence binding`);
      return;
    }
    if (!V1_REVIEWED_BY.test(edge.reviewedBy ?? '')) {
      problems.push(`${key}: AI consensus reviewedBy is neither the legacy literal nor a v1 derived identity`);
      return;
    }

    let evidence;
    try { evidence = evidenceFor(edge.reviewEvidenceRef); }
    catch (error) {
      problems.push(`${key}: invalid consensus evidence: ${error.message}`);
      return;
    }
    const proposal = evidence.proposals.find(item => edgeKey(item) === edgeKey(edge));
    const decision = evidence.edges.find(item => edgeKey(item) === edgeKey(edge));
    if (!proposal || !decision || decision.consensus !== 'unanimous-reviewed') {
      problems.push(`${key}: consensus evidence has no corresponding unanimous-reviewed proposal`);
      return;
    }
    const mismatches = [];
    if (edge.reviewStatus !== 'reviewed') mismatches.push('reviewStatus');
    if (edge.reviewProvenance !== 'ai-consensus') mismatches.push('reviewProvenance');
    if (edge.strength !== proposal.resolvedStrength) mismatches.push('strength');
    if (edge.reviewedBy !== proposal.reviewedBy) mismatches.push('reviewedBy');
    if (edge.reviewedAt !== proposal.reviewedAt) mismatches.push('reviewedAt');
    if (edge.reviewEvidenceRef !== proposal.reviewEvidenceRef) mismatches.push('reviewEvidenceRef');
    if (mismatches.length) {
      problems.push(`${key}: dependency does not match consensus proposal fields: ${mismatches.join(', ')}`);
      return;
    }
    if (edgeContentFingerprint(originalMachineEdge(edge, decision.packetStrength)) !== decision.contentFingerprint) {
      problems.push(`${key}: reconstructed original machine edge fingerprint does not match evidence`);
    }
  }

  for (const edge of cnDependencies) inspect(edge, 'cn-dep');
  for (const edge of bridgeDependencies) inspect(edge, 'cn-bridge');
  return problems;
}
