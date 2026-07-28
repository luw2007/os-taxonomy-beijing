#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import * as defaultFs from 'node:fs';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  ROLE_NAMES,
  assertSafeRunId,
  assertRoleCredentials,
  buildRoleRequest,
  callOpenAICompatibleRole,
  canonicalJson,
  edgeContentFingerprint,
  evidenceRefForRun,
  hashJson,
  packetIdFor,
  projectPacketTopic,
  runRoleCalls,
  validatePacket,
  validateEvidenceRef,
  validateRoleConfigs,
  validateRoleResponse,
} from './consensus-roles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REVIEWS_ROOT = resolve(ROOT, 'reviews', 'ai-consensus', 'v1');
const RUNS_ROOT = resolve(REVIEWS_ROOT, 'runs');
const DEFAULT_DATA_PATH = resolve(ROOT, 'data', 'cn-dependencies.json');
const DEFAULT_TOPICS_PATH = resolve(ROOT, 'data', 'cn-topics.json');
const EVIDENCE_FORMAT = 'beijing-skill-taxonomy-ai-consensus-evidence/v1';

const edgeKey = edge => `${edge.topicId}<-${edge.prerequisiteId}`;
const cloned = value => structuredClone(value);

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireExactKeys(value, required, optional, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${label} required field ${key} is missing`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} has unsupported field ${key}`);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  try { return new Date(value).toISOString() === value; }
  catch { return false; }
}

function normalizedVote(vote, packetEdge) {
  return {
    verdict: vote.verdict,
    resolvedStrength: vote.resolvedStrength === 'unchanged' ? packetEdge.strength : vote.resolvedStrength,
  };
}

function roleEvidence(roleRun) {
  return Object.fromEntries(ROLE_NAMES.map(role => {
    const item = roleRun.roles?.[role] ?? { status: 'invalid', votes: [], error: 'missing role result' };
    return [role, {
      status: item.status,
      configuredModel: item.configuredModel ?? null,
      actualModel: item.actualModel ?? null,
      transportResponseId: item.transportResponseId ?? null,
      request: item.request ? cloned(item.request) : null,
      rawResponse: item.rawResponse ?? null,
      votes: cloned(item.votes ?? []),
      ...(item.error ? { error: item.error } : {}),
    }];
  }));
}

export function deriveReviewedBy(evidence, edgeDecision) {
  const identityAndVotes = ROLE_NAMES.map(role => {
    const roleRecord = evidence.roles[role];
    const vote = roleRecord.votes.find(item => edgeKey(item) === edgeKey(edgeDecision));
    return {
      role,
      configuredModel: roleRecord.configuredModel,
      actualModel: roleRecord.actualModel,
      verdict: vote?.verdict,
      resolvedStrength: vote?.resolvedStrength === 'unchanged' ? edgeDecision.packetStrength : vote?.resolvedStrength,
    };
  });
  return `ai-consensus-v1:${hashJson({
    packetId: evidence.packetId,
    topicId: edgeDecision.topicId,
    prerequisiteId: edgeDecision.prerequisiteId,
    contentFingerprint: edgeDecision.contentFingerprint,
    roles: identityAndVotes,
  })}`;
}

export function buildConsensusEvidence({ packet, roleRun, completedAt, evidenceRef }) {
  validatePacket(packet);
  if (typeof completedAt !== 'string' || !completedAt) fail('completedAt is required');
  if (!isRecord(roleRun)) fail('role run identity is required');
  assertSafeRunId(roleRun.runId);
  const roles = roleEvidence(roleRun);
  const canonicalEvidenceRef = evidenceRefForRun(roleRun.runId);
  if (evidenceRef !== undefined) validateEvidenceRef(evidenceRef, roleRun.runId);
  const evidence = {
    format: EVIDENCE_FORMAT,
    runId: roleRun.runId,
    packetId: packetIdFor(packet),
    completedAt,
    evidenceRef: evidenceRef ?? canonicalEvidenceRef,
    status: roleRun.valid === true ? 'complete' : 'failed',
    ...(roleRun.valid === true ? {} : { error: roleRun.error ?? 'role run failed closed' }),
    source: cloned(packet.source),
    packet: cloned(packet),
    roles,
    edges: [],
    proposals: [],
  };

  for (const packetEdge of packet.edges) {
    const decision = {
      topicId: packetEdge.topicId,
      prerequisiteId: packetEdge.prerequisiteId,
      packetStrength: packetEdge.strength,
      contentFingerprint: packetEdge.contentFingerprint,
      consensus: 'packet-failed',
    };
    if (evidence.status === 'complete') {
      const votes = ROLE_NAMES.map(role => roles[role].votes.find(item => edgeKey(item) === edgeKey(packetEdge)));
      if (votes.some(vote => !vote)) fail(`valid role run is missing vote for ${edgeKey(packetEdge)}`);
      const normalized = votes.map(vote => normalizedVote(vote, packetEdge));
      const unanimous = normalized.every(item => item.verdict === normalized[0].verdict && item.resolvedStrength === normalized[0].resolvedStrength);
      if (!unanimous) {
        decision.consensus = 'disagreement';
      } else if (normalized[0].verdict === 'rejected') {
        decision.consensus = 'unanimous-rejected';
      } else {
        decision.consensus = 'unanimous-reviewed';
        decision.resolvedStrength = normalized[0].resolvedStrength;
      }
    }
    evidence.edges.push(decision);
  }

  for (const decision of evidence.edges.filter(item => item.consensus === 'unanimous-reviewed')) {
    evidence.proposals.push({
      topicId: decision.topicId,
      prerequisiteId: decision.prerequisiteId,
      contentFingerprint: decision.contentFingerprint,
      verdict: 'reviewed',
      resolvedStrength: decision.resolvedStrength,
      reviewedBy: deriveReviewedBy(evidence, decision),
      reviewedAt: completedAt,
      reviewEvidenceRef: evidence.evidenceRef,
    });
  }
  evidence.evidenceHash = hashJson(evidence);
  return validateConsensusEvidence(evidence);
}

export function validateConsensusEvidence(evidence) {
  if (!isRecord(evidence) || evidence.format !== EVIDENCE_FORMAT) fail('unsupported consensus evidence format');
  requireExactKeys(evidence,
    ['format', 'runId', 'packetId', 'completedAt', 'evidenceRef', 'status', 'source', 'packet', 'roles', 'edges', 'proposals', 'evidenceHash'],
    ['error'], 'consensus evidence');
  assertSafeRunId(evidence.runId);
  validateEvidenceRef(evidence.evidenceRef, evidence.runId);
  if (!isCanonicalTimestamp(evidence.completedAt)) fail('evidence completedAt must be a canonical ISO timestamp');
  validatePacket(evidence.packet);
  if (canonicalJson(evidence.source) !== canonicalJson(evidence.packet.source)) fail('evidence source does not match its packet source');
  if (evidence.packetId !== packetIdFor(evidence.packet)) fail('evidence packet identity does not match packet content');
  if (!['complete', 'failed'].includes(evidence.status)) fail('evidence status must be complete or failed');
  if (evidence.status === 'complete' && Object.hasOwn(evidence, 'error')) fail('complete evidence must not contain an error');
  if (evidence.status === 'failed' && (typeof evidence.error !== 'string' || !evidence.error.trim())) fail('failed evidence requires an error');
  if (!isRecord(evidence.roles) || canonicalJson(Object.keys(evidence.roles).sort()) !== canonicalJson([...ROLE_NAMES].sort())) {
    fail('evidence roles must contain exactly necessity, direction, and adversary');
  }
  if (!Array.isArray(evidence.edges) || evidence.edges.length !== evidence.packet.edges.length) fail('evidence must bind every packet edge');
  if (!Array.isArray(evidence.proposals)) fail('evidence proposals must be an array');

  const decisionByKey = new Map();
  for (const decision of evidence.edges) {
    const key = edgeKey(decision);
    if (decisionByKey.has(key)) fail(`evidence contains duplicate edge decision ${key}`);
    decisionByKey.set(key, decision);
  }
  const expectedKeys = new Set(evidence.packet.edges.map(edgeKey));
  if (decisionByKey.size !== expectedKeys.size || [...decisionByKey.keys()].some(key => !expectedKeys.has(key))) {
    fail('evidence edge decisions do not cover the exact packet edge set');
  }

  const configuredModels = [];
  const actualModels = [];
  let validRoleCount = 0;
  for (const role of ROLE_NAMES) {
    const record = evidence.roles[role];
    if (!isRecord(record) || !isRecord(record.request)) fail(`evidence requires complete ${role} role identity`);
    requireExactKeys(record,
      ['status', 'configuredModel', 'actualModel', 'transportResponseId', 'request', 'rawResponse', 'votes'],
      ['error'], `${role} role record`);
    if (typeof record.configuredModel !== 'string' || !record.configuredModel || record.configuredModel !== record.configuredModel.trim()) {
      fail(`${role} configured model identity is required and must be normalized`);
    }
    const expectedRequest = buildRoleRequest({ role, config: { model: record.configuredModel }, packet: evidence.packet, runId: evidence.runId });
    if (canonicalJson(record.request) !== canonicalJson(expectedRequest)) fail(`${role} request does not exactly match run, source, and packet edges`);
    configuredModels.push(record.configuredModel);
    if (record.transportResponseId !== null && (typeof record.transportResponseId !== 'string' || !record.transportResponseId)) {
      fail(`${role} transport response id must be a non-empty string or null`);
    }
    if (record.status === 'valid') {
      if (Object.hasOwn(record, 'error')) fail(`valid ${role} role record must not contain an error`);
      validRoleCount++;
      if (typeof record.rawResponse !== 'string') fail(`valid ${role} role record requires rawResponse`);
      const reparsed = validateRoleResponse(record.rawResponse, expectedRequest);
      if (canonicalJson(reparsed.votes) !== canonicalJson(record.votes)) fail(`${role} raw response votes do not match stored votes`);
      if (typeof record.actualModel !== 'string' || !record.actualModel || record.actualModel !== record.actualModel.trim()) {
        fail(`valid ${role} role record requires normalized actual model identity`);
      }
      actualModels.push(record.actualModel);
    } else if (!['invalid', 'timeout'].includes(record.status)) {
      fail(`${role} role status must be valid, invalid, or timeout`);
    } else {
      if (typeof record.error !== 'string' || !record.error.trim()) fail(`${role} failed role record requires an error`);
      if (!Array.isArray(record.votes) || record.votes.length !== 0) fail(`${role} failed role record must not retain partial votes`);
      if (record.rawResponse !== null && typeof record.rawResponse !== 'string') fail(`${role} failed role rawResponse must be a string or null`);
      if (record.actualModel !== null && (typeof record.actualModel !== 'string' || !record.actualModel.trim())) fail(`${role} failed role actualModel must be a string or null`);
    }
  }
  if (new Set(configuredModels).size !== ROLE_NAMES.length) fail('evidence roles require distinct configured model identifiers');

  if (evidence.status === 'complete') {
    if (validRoleCount !== ROLE_NAMES.length) fail('complete evidence requires three valid role records');
    if (new Set(actualModels).size !== ROLE_NAMES.length) fail('evidence roles require distinct actual model identifiers');

    for (const packetEdge of evidence.packet.edges) {
      const votes = ROLE_NAMES.map(role => evidence.roles[role].votes.find(item => edgeKey(item) === edgeKey(packetEdge)));
      const normalized = votes.map(vote => normalizedVote(vote, packetEdge));
      const unanimous = normalized.every(item => item.verdict === normalized[0].verdict && item.resolvedStrength === normalized[0].resolvedStrength);
      const expected = {
        topicId: packetEdge.topicId,
        prerequisiteId: packetEdge.prerequisiteId,
        packetStrength: packetEdge.strength,
        contentFingerprint: packetEdge.contentFingerprint,
        consensus: !unanimous ? 'disagreement' : normalized[0].verdict === 'rejected' ? 'unanimous-rejected' : 'unanimous-reviewed',
        ...(unanimous && normalized[0].verdict === 'reviewed' ? { resolvedStrength: normalized[0].resolvedStrength } : {}),
      };
      if (canonicalJson(decisionByKey.get(edgeKey(packetEdge))) !== canonicalJson(expected)) {
        fail(`evidence edge ${edgeKey(packetEdge)} does not match re-derived consensus`);
      }
    }
  } else {
    const actualModelCollision = validRoleCount === ROLE_NAMES.length && new Set(actualModels).size !== ROLE_NAMES.length;
    if (validRoleCount === ROLE_NAMES.length && !actualModelCollision) fail('failed evidence has no failed role or actual model collision');
    if (evidence.proposals.length !== 0) fail('failed evidence must not contain any proposal');
    for (const packetEdge of evidence.packet.edges) {
      const decision = decisionByKey.get(edgeKey(packetEdge));
      if (decision?.consensus !== 'packet-failed') fail(`failed evidence edge ${edgeKey(packetEdge)} must remain packet-failed`);
    }
  }

  const proposalKeys = new Set();
  for (const proposal of evidence.proposals) {
    requireExactKeys(proposal,
      ['topicId', 'prerequisiteId', 'contentFingerprint', 'verdict', 'resolvedStrength', 'reviewedBy', 'reviewedAt', 'reviewEvidenceRef'],
      [], `proposal ${edgeKey(proposal)}`);
    const proposalKey = edgeKey(proposal);
    if (proposalKeys.has(proposalKey)) fail(`evidence contains duplicate proposal ${proposalKey}`);
    proposalKeys.add(proposalKey);
    const decision = evidence.edges.find(item => edgeKey(item) === edgeKey(proposal));
    if (!decision || decision.consensus !== 'unanimous-reviewed' || proposal.verdict !== 'reviewed') fail(`proposal ${edgeKey(proposal)} lacks strict unanimous reviewed evidence`);
    const derived = deriveReviewedBy(evidence, decision);
    if (proposal.reviewedBy !== derived) fail(`proposal ${edgeKey(proposal)} reviewedBy must be derived from audit content`);
    if (proposal.contentFingerprint !== decision.contentFingerprint || proposal.resolvedStrength !== decision.resolvedStrength) {
      fail(`proposal ${edgeKey(proposal)} does not match its consensus decision`);
    }
    if (proposal.reviewEvidenceRef !== evidence.evidenceRef || proposal.reviewedAt !== evidence.completedAt) fail(`proposal ${edgeKey(proposal)} audit binding does not match evidence`);
  }
  const expectedProposalCount = evidence.edges.filter(item => item.consensus === 'unanimous-reviewed').length;
  if (evidence.proposals.length !== expectedProposalCount) fail('evidence proposals do not match re-derived consensus');
  const expectedHash = hashJson(Object.fromEntries(Object.entries(evidence).filter(([key]) => key !== 'evidenceHash')));
  if (evidence.evidenceHash !== expectedHash) fail('evidence hash does not match audit content');
  return evidence;
}

const QUARANTINE_FIELDS = Object.freeze([
  'rescopeRequired', 'previousReviewStatus', 'ageRegression', 'reviewNote', 'reviewerRole', 'reviewRubric',
  'reviewProvenance', 'reviewedBy', 'reviewedAt', 'reviewEvidenceRef',
]);

export function applyConsensusEvidence({ dependencies, topics, evidence }) {
  validateConsensusEvidence(evidence);
  if (!isRecord(dependencies) || !Array.isArray(dependencies.dependencies)) fail('dependency document is invalid');
  if (dependencies.edgeCount !== undefined && dependencies.edgeCount !== dependencies.dependencies.length) fail('dependency edgeCount does not match dependency array');
  const dependencyKeys = new Set();
  for (const edge of dependencies.dependencies) {
    const key = edgeKey(edge);
    if (dependencyKeys.has(key)) fail(`dependency document contains duplicate edge ${key}`);
    dependencyKeys.add(key);
  }
  if (evidence.proposals.length > 0) {
    const topicList = Array.isArray(topics) ? topics : topics?.topics;
    if (!Array.isArray(topicList)) fail('current topic document is required to apply consensus proposals');
    const topicById = new Map();
    for (const topic of topicList) {
      if (!isRecord(topic) || typeof topic.id !== 'string' || !topic.id) fail('current topic document contains an invalid topic');
      if (topicById.has(topic.id)) fail(`current topic document contains duplicate topic ${topic.id}`);
      topicById.set(topic.id, topic);
    }
    const packetEdgeByKey = new Map(evidence.packet.edges.map(edge => [edgeKey(edge), edge]));
    const topicDrift = [];
    for (const proposal of evidence.proposals) {
      const packetEdge = packetEdgeByKey.get(edgeKey(proposal));
      const liveTopic = topicById.get(proposal.topicId);
      const livePrerequisite = topicById.get(proposal.prerequisiteId);
      if (!liveTopic || canonicalJson(projectPacketTopic(liveTopic)) !== canonicalJson(packetEdge.topic)) topicDrift.push(`${proposal.topicId}:topic`);
      if (!livePrerequisite || canonicalJson(projectPacketTopic(livePrerequisite)) !== canonicalJson(packetEdge.prerequisite)) topicDrift.push(`${proposal.prerequisiteId}:prerequisite`);
    }
    if (topicDrift.length) fail(`current topic context drifted from packet; no proposals applied: ${topicDrift.join(', ')}`);
  }
  const document = cloned(dependencies);
  const indexByKey = new Map(document.dependencies.map((edge, index) => [edgeKey(edge), index]));
  const applied = [];
  const conflicts = [];
  for (const proposal of evidence.proposals) {
    const key = edgeKey(proposal);
    const index = indexByKey.get(key);
    if (index === undefined) {
      conflicts.push({ edge: key, code: 'missing-edge' });
      continue;
    }
    const live = document.dependencies[index];
    if (live.reviewStatus !== 'machine') {
      conflicts.push({ edge: key, code: 'not-machine' });
      continue;
    }
    if (QUARANTINE_FIELDS.some(field => Object.hasOwn(live, field))) {
      conflicts.push({ edge: key, code: 'quarantined' });
      continue;
    }
    if (edgeContentFingerprint(live) !== proposal.contentFingerprint) {
      conflicts.push({ edge: key, code: 'stale-fingerprint' });
      continue;
    }
    const next = {
      ...live,
      strength: proposal.resolvedStrength,
      reviewStatus: 'reviewed',
      reviewProvenance: 'ai-consensus',
      reviewedBy: proposal.reviewedBy,
      reviewedAt: proposal.reviewedAt,
      reviewEvidenceRef: proposal.reviewEvidenceRef,
    };
    document.dependencies[index] = next;
    applied.push(key);
  }
  return { document, applied, conflicts };
}

export function atomicLockedJsonWrite({ targetPath, value, lockPath = `${targetPath}.lock`, refuseExisting = false, fsOps = defaultFs }) {
  return atomicLockedJsonCommit({ targetPath, lockPath, refuseExisting, fsOps, valueFactory: () => value });
}

export function atomicLockedJsonUpdate({ targetPath, update, lockPath = `${targetPath}.lock`, fsOps = defaultFs }) {
  if (typeof update !== 'function') fail('atomic JSON update requires an update function');
  return atomicLockedJsonCommit({
    targetPath,
    lockPath,
    refuseExisting: false,
    fsOps,
    valueFactory: () => {
      if (!fsOps.existsSync(targetPath)) fail(`atomic JSON update target does not exist: ${targetPath}`);
      let current;
      try { current = JSON.parse(fsOps.readFileSync(targetPath, 'utf8')); }
      catch { fail(`atomic JSON update target is not valid JSON: ${targetPath}`); }
      return update(current);
    },
  });
}

function atomicLockedJsonCommit({ targetPath, lockPath, refuseExisting, fsOps, valueFactory }) {
  let lockFd;
  let tempFd;
  let tempPath;
  try {
    try {
      lockFd = fsOps.openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error?.code === 'EEXIST') fail(`single-writer lock is already held: ${lockPath}`);
      throw error;
    }
    fsOps.writeFileSync(lockFd, JSON.stringify({ pid: process.pid, targetPath, acquiredAt: new Date().toISOString() }) + '\n');
    fsOps.fsyncSync(lockFd);
    if (refuseExisting && fsOps.existsSync(targetPath)) fail(`refusing to clobber existing file: ${targetPath}`);
    const value = valueFactory();
    tempPath = resolve(dirname(targetPath), `.${basename(targetPath)}.tmp-${process.pid}-${randomUUID()}`);
    const targetMode = fsOps.existsSync(targetPath) ? fsOps.statSync(targetPath).mode & 0o777 : 0o600;
    tempFd = fsOps.openSync(tempPath, 'wx', targetMode);
    fsOps.writeFileSync(tempFd, JSON.stringify(value, null, 2) + '\n');
    fsOps.fsyncSync(tempFd);
    fsOps.closeSync(tempFd);
    tempFd = undefined;
    fsOps.renameSync(tempPath, targetPath);
    tempPath = undefined;
    const directoryFd = fsOps.openSync(dirname(targetPath), 'r');
    try { fsOps.fsyncSync(directoryFd); } finally { fsOps.closeSync(directoryFd); }
  } finally {
    if (tempFd !== undefined) {
      try { fsOps.closeSync(tempFd); } catch {}
    }
    if (tempPath && fsOps.existsSync(tempPath)) {
      try { fsOps.unlinkSync(tempPath); } catch {}
    }
    if (lockFd !== undefined) {
      try { fsOps.closeSync(lockFd); } catch {}
      try { fsOps.unlinkSync(lockPath); } catch {}
    }
  }
}

function option(args, flag, fallback = null) {
  const index = args.indexOf(flag);
  return index < 0 ? fallback : args[index + 1] ?? null;
}

function readJson(path, label) {
  try { return JSON.parse(defaultFs.readFileSync(path, 'utf8')); }
  catch (error) { fail(`cannot read ${label} ${path}: ${error.message}`); }
}

function loadConfigs(path) {
  const loaded = readJson(path, 'role config');
  if (loaded.roles !== undefined) {
    requireExactKeys(loaded, ['format', 'roles'], [], 'role config file');
    if (loaded.format !== 'beijing-skill-taxonomy-ai-consensus-role-config/v1') fail('unsupported role config format');
  }
  const configs = loaded.roles ?? loaded;
  validateRoleConfigs(configs);
  return configs;
}

function assertMode(args) {
  const modes = ['--plan', '--dry-run', '--write'].filter(flag => args.includes(flag));
  if (modes.length !== 1) fail('choose exactly one of --plan, --dry-run, or --write');
  return modes[0].slice(2);
}

export function resolveEvidencePath(path) {
  const absolute = resolve(ROOT, path);
  const ref = relative(ROOT, absolute).split(sep).join('/');
  validateEvidenceRef(ref);
  if (!defaultFs.existsSync(RUNS_ROOT) || defaultFs.realpathSync(RUNS_ROOT) !== RUNS_ROOT) fail('consensus runs directory must exist and must not be a symbolic link');
  if (dirname(absolute) !== RUNS_ROOT) fail(`evidence path must be a direct child of ${RUNS_ROOT}`);
  if (defaultFs.existsSync(absolute) && defaultFs.realpathSync(absolute) !== absolute) fail('evidence path must not be a symbolic link');
  return { absolute, ref };
}

export function assertConfigModelsMatchEvidence(configs, evidence) {
  validateRoleConfigs(configs);
  for (const role of ROLE_NAMES) {
    if (configs[role].model.trim() !== evidence.roles?.[role]?.configuredModel) fail(`${role} configured model does not match evidence`);
  }
}

export function assertEvidenceFileRef(evidence, actualEvidenceRef) {
  validateEvidenceRef(actualEvidenceRef);
  if (evidence.evidenceRef !== actualEvidenceRef) fail('evidenceRef does not match the actual evidence file path');
}

export function assertWriteableApplyResult(evidence, result) {
  if (evidence.status !== 'complete' || evidence.proposals.length === 0) fail('evidence contains no applyable unanimous reviewed proposals');
  if (result.applied.length === 0) fail('refusing replay or all-stale consensus result; no live proposal can be applied');
}

function generatedRunId(packet) {
  const time = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  return `run-${time}-${packetIdFor(packet).slice(-12)}`;
}

async function reviewCommand(args, mode) {
  const packetPath = resolve(ROOT, option(args, '--packet') ?? fail('--packet is required'));
  const configPath = resolve(ROOT, option(args, '--config') ?? fail('--config is required'));
  const packet = readJson(packetPath, 'packet');
  const configs = loadConfigs(configPath);
  validatePacket(packet);
  const runId = option(args, '--run-id', generatedRunId(packet));
  assertSafeRunId(runId);
  const requestedRef = option(args, '--out', evidenceRefForRun(runId));
  const { absolute: out, ref: evidenceRef } = resolveEvidencePath(requestedRef);
  validateEvidenceRef(evidenceRef, runId);
  const requests = Object.fromEntries(ROLE_NAMES.map(role => [role, buildRoleRequest({ role, config: configs[role], packet, runId })]));
  if (mode === 'plan') {
    console.log(JSON.stringify({ mode, runId, packetId: packetIdFor(packet), edges: packet.edges.length, roles: ROLE_NAMES.map(role => ({ role, model: configs[role].model, endpoint: configs[role].endpoint })) }, null, 2));
    return;
  }
  if (mode === 'dry-run') {
    console.log(JSON.stringify({ mode, writes: false, networkCalls: false, requests }, null, 2));
    return;
  }
  if (defaultFs.existsSync(out)) fail(`refusing to clobber existing evidence: ${evidenceRef}`);
  assertRoleCredentials(configs);
  const roleRun = await runRoleCalls({
    packet,
    configs,
    runId,
    caller: ({ request, config }) => callOpenAICompatibleRole({ request, config }),
  });
  defaultFs.mkdirSync(dirname(out), { recursive: true });
  const evidence = buildConsensusEvidence({ packet, roleRun, completedAt: new Date().toISOString(), evidenceRef });
  atomicLockedJsonWrite({ targetPath: out, value: evidence, refuseExisting: true });
  console.log(JSON.stringify({ evidence: evidenceRef, status: evidence.status, proposals: evidence.proposals.length }, null, 2));
  if (evidence.status !== 'complete') fail(`consensus run failed closed; audit evidence written to ${evidenceRef}`);
}

async function applyCommand(args, mode) {
  if (args.includes('--data')) fail('apply data target is fixed to data/cn-dependencies.json');
  const { absolute: evidencePath, ref: actualEvidenceRef } = resolveEvidencePath(option(args, '--evidence') ?? fail('--evidence is required'));
  const evidence = readJson(evidencePath, 'evidence');
  validateConsensusEvidence(evidence);
  assertEvidenceFileRef(evidence, actualEvidenceRef);
  if (mode === 'plan') {
    console.log(JSON.stringify({ mode, evidence: relative(ROOT, evidencePath), status: evidence.status, proposals: evidence.proposals.length }, null, 2));
    return;
  }
  const dataPath = DEFAULT_DATA_PATH;
  if (mode === 'dry-run') {
    const dependencies = readJson(dataPath, 'dependency data');
    const topics = readJson(DEFAULT_TOPICS_PATH, 'topic data');
    const result = applyConsensusEvidence({ dependencies, topics, evidence });
    console.log(JSON.stringify({ mode, writes: false, applied: result.applied, conflicts: result.conflicts }, null, 2));
    return;
  }
  const configPath = resolve(ROOT, option(args, '--config') ?? fail('--config is required for --write'));
  const configs = loadConfigs(configPath);
  assertConfigModelsMatchEvidence(configs, evidence);
  let result;
  atomicLockedJsonUpdate({
    targetPath: dataPath,
    lockPath: `${dataPath}.ai-consensus.lock`,
    update: dependencies => {
      const topics = readJson(DEFAULT_TOPICS_PATH, 'topic data');
      result = applyConsensusEvidence({ dependencies, topics, evidence });
      assertWriteableApplyResult(evidence, result);
      return result.document;
    },
  });
  console.log(JSON.stringify({ data: relative(ROOT, dataPath), applied: result.applied, conflicts: result.conflicts }, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const mode = assertMode(args);
  if (command === 'review') return reviewCommand(args.slice(1), mode);
  if (command === 'apply') return applyCommand(args.slice(1), mode);
  fail('first argument must be review or apply');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Fatal: ${error.message}`); process.exitCode = 1; });
}
