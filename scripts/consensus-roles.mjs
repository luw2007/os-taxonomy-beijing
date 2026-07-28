import { createHash } from 'node:crypto';

export const ROLE_NAMES = Object.freeze(['necessity', 'direction', 'adversary']);
export const ROLE_RESPONSE_FORMAT = 'beijing-skill-taxonomy-ai-role-response/v1';
export const PACKET_TOPIC_FIELDS = Object.freeze([
  'id', 'name', 'description', 'subject', 'domain', 'ageRangeStart', 'ageRangeEnd', 'evidence', 'cnStandards',
]);
export const CONSENSUS_RUNS_PREFIX = 'reviews/ai-consensus/v1/runs/';

const PACKET_EDGE_FIELDS = new Set([
  'topicId', 'prerequisiteId', 'strength', 'reason', 'contentFingerprint',
  'generationBatchId', 'generationBatch', 'topic', 'prerequisite',
]);

const VERDICTS = new Set(['reviewed', 'rejected']);
const RESOLVED_STRENGTHS = new Set(['hard', 'soft', 'unchanged']);
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function fail(message) {
  throw new Error(message);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireExactKeys(value, required, label) {
  if (!isRecord(value)) fail(`${label} must be an object`);
  const keys = Object.keys(value);
  for (const key of required) if (!keys.includes(key)) fail(`${label} required field ${key} is missing`);
  for (const key of keys) if (!required.includes(key)) fail(`${label} has unsupported field ${key}`);
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('canonical JSON cannot contain a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value).sort().map(key => {
      if (value[key] === undefined) fail(`canonical JSON cannot contain undefined at ${key}`);
      return `${JSON.stringify(key)}:${canonicalJson(value[key])}`;
    });
    return `{${entries.join(',')}}`;
  }
  fail(`canonical JSON cannot encode ${typeof value}`);
}

export function hashJson(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function edgeContentFingerprint(edge) {
  if (!isRecord(edge)) fail('edge content fingerprint requires an object');
  return hashJson(edge);
}

export function projectPacketTopic(topic) {
  if (!isRecord(topic)) fail('packet topic projection requires an object');
  const projected = {};
  for (const field of PACKET_TOPIC_FIELDS) {
    if (topic[field] !== undefined) projected[field] = structuredClone(topic[field]);
  }
  return projected;
}

export function assertSafeRunId(runId) {
  if (typeof runId !== 'string' || !SAFE_RUN_ID.test(runId)) fail('runId must be a safe non-empty identifier');
  return runId;
}

export function evidenceRefForRun(runId) {
  return `${CONSENSUS_RUNS_PREFIX}${assertSafeRunId(runId)}.json`;
}

export function validateEvidenceRef(evidenceRef, runId = null) {
  if (typeof evidenceRef !== 'string') fail('evidenceRef must be a canonical consensus run reference');
  const match = evidenceRef.match(/^reviews\/ai-consensus\/v1\/runs\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})\.json$/);
  if (!match || evidenceRef !== evidenceRefForRun(match[1])) fail('evidenceRef must be a safe canonical reviews/ai-consensus/v1/runs/<runId>.json reference');
  if (runId !== null && evidenceRef !== evidenceRefForRun(runId)) fail('evidenceRef does not match runId');
  return evidenceRef;
}

export function isConsensusEvidenceRef(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.replaceAll('\\', '/').split('/').reduce((parts, part) => {
    if (!part || part === '.') return parts;
    if (part === '..') parts.pop();
    else parts.push(part);
    return parts;
  }, []).join('/');
  return normalized === 'reviews/ai-consensus'
    || normalized.startsWith('reviews/ai-consensus/')
    || normalized.includes('/reviews/ai-consensus/');
}

function validatePacketTopic(topic, expectedId, label) {
  if (!isRecord(topic) || topic.id !== expectedId) fail(`${label} context does not match ${label === 'topic' ? 'topicId' : 'prerequisiteId'}`);
  const extras = Object.keys(topic).filter(field => !PACKET_TOPIC_FIELDS.includes(field));
  if (extras.length) fail(`${label} context has unsupported field ${extras[0]}`);
  if (canonicalJson(topic) !== canonicalJson(projectPacketTopic(topic))) fail(`${label} context is not a valid packet projection`);
}

export function validatePacket(packet) {
  if (!isRecord(packet) || packet.format !== 'beijing-skill-taxonomy-edge-review-packet/v1') {
    fail('unsupported review packet format');
  }
  if (!isRecord(packet.source) || typeof packet.source.taxonomyVersion !== 'string' || !packet.source.taxonomyVersion) {
    fail('packet source taxonomyVersion is required');
  }
  for (const field of ['cnTopicsSha256', 'cnDependenciesSha256']) {
    if (!SHA256.test(packet.source[field] ?? '')) fail(`packet source ${field} must be a SHA-256 checksum`);
  }
  if (!Array.isArray(packet.edges) || packet.edges.length === 0) fail('packet edges must be a non-empty array');
  const seen = new Set();
  for (const [index, edge] of packet.edges.entries()) {
    if (!isRecord(edge)) fail(`packet edge ${index} must be an object`);
    for (const field of Object.keys(edge)) {
      if (!PACKET_EDGE_FIELDS.has(field)) fail(`packet edge ${index} has unsupported field ${field}`);
    }
    for (const field of ['topicId', 'prerequisiteId']) {
      if (typeof edge[field] !== 'string' || !edge[field]) fail(`packet edge ${index} requires ${field}`);
    }
    if (!['hard', 'soft'].includes(edge.strength)) fail(`packet edge ${index} has invalid strength`);
    if (edge.reason !== null && typeof edge.reason !== 'string') fail(`packet edge ${index} reason must be a string or null`);
    if (!SHA256.test(edge.contentFingerprint ?? '')) fail(`packet edge ${index} requires a content fingerprint`);
    validatePacketTopic(edge.topic, edge.topicId, 'topic');
    validatePacketTopic(edge.prerequisite, edge.prerequisiteId, 'prerequisite');
    const key = edgeKey(edge);
    if (seen.has(key)) fail(`packet contains duplicate edge ${key}`);
    seen.add(key);
  }
  return packet;
}

export function packetIdFor(packet) {
  validatePacket(packet);
  return `packet-v1:${hashJson({ format: packet.format, source: packet.source, edges: packet.edges })}`;
}

export function validateRoleConfigs(configs) {
  if (!isRecord(configs)) fail('role config must be an object');
  const keys = Object.keys(configs).sort();
  const expected = [...ROLE_NAMES].sort();
  if (canonicalJson(keys) !== canonicalJson(expected)) {
    fail('role config must contain exactly necessity, direction, and adversary');
  }
  for (const role of ROLE_NAMES) {
    const config = configs[role];
    if (!isRecord(config)) fail(`${role} config must be an object`);
    requireExactKeys(config, ['endpoint', 'model', 'apiKeyEnv', 'systemPrompt', 'timeoutMs'], `${role} config`);
    if (typeof config.endpoint !== 'string' || !URL.canParse(config.endpoint) || !/^https?:$/.test(new URL(config.endpoint).protocol)) {
      fail(`${role} endpoint must be an absolute HTTP URL`);
    }
    if (typeof config.model !== 'string' || !config.model.trim() || config.model.length > 200) fail(`${role} model is required and limited to 200 characters`);
    if (typeof config.apiKeyEnv !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(config.apiKeyEnv)) fail(`${role} apiKeyEnv must name an environment variable`);
    if (typeof config.systemPrompt !== 'string' || !config.systemPrompt.trim() || config.systemPrompt.length > 8_000) fail(`${role} systemPrompt is required and limited to 8000 characters`);
    if (!Number.isInteger(config.timeoutMs) || config.timeoutMs < 1 || config.timeoutMs > 120_000) fail(`${role} timeoutMs must be an integer from 1 to 120000`);
  }
  const models = ROLE_NAMES.map(role => configs[role].model.trim());
  if (new Set(models).size !== ROLE_NAMES.length) fail('each role must use a distinct configured model identifier');
  return configs;
}

export function assertRoleCredentials(configs, env = process.env) {
  validateRoleConfigs(configs);
  const missing = ROLE_NAMES.filter(role => typeof env[configs[role].apiKeyEnv] !== 'string' || !env[configs[role].apiKeyEnv].trim());
  if (missing.length) {
    fail(`missing required model-call credentials: ${missing.map(role => configs[role].apiKeyEnv).join(', ')}`);
  }
}

export function buildRoleRequest({ role, config, packet, runId }) {
  if (!ROLE_NAMES.includes(role)) fail(`unsupported role ${role}`);
  validatePacket(packet);
  if (!isRecord(config) || typeof config.model !== 'string' || !config.model.trim()) fail(`${role} model config is required`);
  assertSafeRunId(runId);
  const packetId = packetIdFor(packet);
  return {
    format: 'beijing-skill-taxonomy-ai-role-request/v1',
    requestId: `${runId}:${role}:${packetId.slice(-16)}`,
    packetId,
    role,
    configuredModel: config.model.trim(),
    source: structuredClone(packet.source),
    edges: structuredClone(packet.edges),
  };
}

function edgeKey(edge) {
  return `${edge.topicId}<-${edge.prerequisiteId}`;
}

export function validateRoleResponse(raw, request) {
  let response;
  try {
    response = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    fail('role response must be well-formed JSON');
  }
  requireExactKeys(response, ['format', 'requestId', 'packetId', 'role', 'configuredModel', 'votes'], 'role response');
  if (response.format !== ROLE_RESPONSE_FORMAT) fail('role response identity echo format does not match request contract');
  for (const field of ['requestId', 'packetId', 'role', 'configuredModel']) {
    if (response[field] !== request[field]) fail(`role response identity echo ${field} does not match request`);
  }
  if (!Array.isArray(response.votes)) fail('role response votes must be an array');
  const expected = new Set(request.edges.map(edgeKey));
  const seen = new Set();
  for (const [index, vote] of response.votes.entries()) {
    requireExactKeys(vote, ['topicId', 'prerequisiteId', 'verdict', 'resolvedStrength', 'reason', 'references'], `vote ${index}`);
    if (typeof vote.topicId !== 'string' || typeof vote.prerequisiteId !== 'string') fail(`vote ${index} requires edge identifiers`);
    const key = edgeKey(vote);
    if (seen.has(key)) fail(`role response contains duplicate edge ${key}`);
    if (!expected.has(key)) fail(`role response contains extra edge ${key}`);
    seen.add(key);
    if (!VERDICTS.has(vote.verdict)) fail(`vote ${index} verdict must be reviewed or rejected`);
    if (!RESOLVED_STRENGTHS.has(vote.resolvedStrength)) fail(`vote ${index} resolvedStrength must be hard, soft, or unchanged`);
    if (typeof vote.reason !== 'string' || vote.reason.length < 1 || vote.reason.length > 2_000) fail(`vote ${index} reason is required and limited to 2000 characters`);
    if (!Array.isArray(vote.references) || vote.references.length > 8) fail(`vote ${index} references must contain at most 8 entries`);
    for (const reference of vote.references) {
      if (typeof reference !== 'string' || reference.length < 1 || reference.length > 500) fail(`vote ${index} reference is required and limited to 500 characters`);
    }
  }
  if (seen.size !== expected.size) fail('role response must cover the exact edge set exactly once');
  return response;
}

function buildRolePrompt(request, systemPrompt) {
  const responseShape = {
    format: ROLE_RESPONSE_FORMAT,
    requestId: request.requestId,
    packetId: request.packetId,
    role: request.role,
    configuredModel: request.configuredModel,
    votes: [{ topicId: 'copy exactly', prerequisiteId: 'copy exactly', verdict: 'reviewed|rejected', resolvedStrength: 'hard|soft|unchanged', reason: '1-2000 characters', references: ['0-8 citations'] }],
  };
  return `${systemPrompt}\n\nEvaluate every edge exactly once. Return JSON only. Echo all identity fields exactly. `
    + `Do not omit, duplicate, or add edges. Closed enums and response shape:\n${JSON.stringify(responseShape)}\n\n`
    + `Request packet:\n${JSON.stringify(request)}`;
}

export async function callOpenAICompatibleRole({ request, config, env = process.env, fetchImpl = globalThis.fetch }) {
  const credential = env[config.apiKeyEnv];
  if (typeof credential !== 'string' || !credential.trim()) fail(`missing required credential ${config.apiKeyEnv}`);
  if (typeof fetchImpl !== 'function') fail('fetch implementation is unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);
  const endpoint = config.endpoint.replace(/\/$/, '').endsWith('/chat/completions')
    ? config.endpoint.replace(/\/$/, '')
    : `${config.endpoint.replace(/\/$/, '')}/chat/completions`;
  try {
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${credential}` },
        body: JSON.stringify({
          model: config.model,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: buildRolePrompt(request, config.systemPrompt) }],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') fail(`role call timeout after ${config.timeoutMs}ms`);
      fail('role call transport failed');
    }
    if (!response?.ok) {
      const status = Number.isInteger(response?.status) ? response.status : 'error';
      fail(`role call HTTP ${status}`);
    }
    let body;
    try { body = await response.json(); }
    catch { fail('role call returned invalid provider JSON'); }
    const actualModel = body?.model;
    const content = body?.choices?.[0]?.message?.content;
    if (typeof actualModel !== 'string' || !actualModel.trim()) fail('role call did not report an actual model identifier');
    if (typeof content !== 'string' || !content.trim()) fail('role call returned no response content');
    return { actualModel: actualModel.trim(), content, transportResponseId: typeof body.id === 'string' ? body.id : null };
  } finally {
    clearTimeout(timer);
  }
}

export async function runRoleCalls({ packet, configs, runId, caller }) {
  validatePacket(packet);
  validateRoleConfigs(configs);
  if (typeof caller !== 'function') fail('role caller is required');
  const entries = await Promise.all(ROLE_NAMES.map(async role => {
    const config = configs[role];
    const request = buildRoleRequest({ role, config, packet, runId });
    let called;
    try {
      called = await caller({ role, config, request });
      const parsed = validateRoleResponse(called?.content, request);
      if (typeof called?.actualModel !== 'string' || !called.actualModel.trim()) fail('role call did not report an actual model identifier');
      return [role, {
        status: 'valid',
        configuredModel: config.model.trim(),
        actualModel: called.actualModel.trim(),
        transportResponseId: called.transportResponseId ?? null,
        request,
        rawResponse: called.content,
        votes: parsed.votes,
      }];
    } catch (error) {
      const timeout = error?.name === 'AbortError' || /timeout|timed out/i.test(error?.message ?? '');
      return [role, {
        status: timeout ? 'timeout' : 'invalid',
        configuredModel: config.model.trim(),
        actualModel: typeof called?.actualModel === 'string' ? called.actualModel : null,
        request,
        rawResponse: typeof called?.content === 'string' ? called.content : null,
        votes: [],
        error: error?.message ?? String(error),
      }];
    }
  }));
  const roles = Object.fromEntries(entries);
  const invalid = ROLE_NAMES.filter(role => roles[role].status !== 'valid');
  if (invalid.length) return { valid: false, runId, error: `packet failed because role calls were invalid: ${invalid.join(', ')}`, roles };
  const actualModels = ROLE_NAMES.map(role => roles[role].actualModel);
  if (new Set(actualModels).size !== ROLE_NAMES.length) {
    return { valid: false, runId, error: 'each role must report a distinct actual model identifier', roles };
  }
  return { valid: true, runId, roles };
}
