const normalizeTopicName = (value) => String(value || '')
  .replace(/[·：:（）()《》“”"'、，,\s]/g, '')
  .replace(/的|与|和/g, '');

export function validateSplitResult(result) {
  if (!(result?.estimateMinutes > 45)) return { valid: false, reason: '父主题时长必须大于 45 分钟' };
  if (!Array.isArray(result.children) || result.children.length < 2 || result.children.length > 5) {
    return { valid: false, reason: '子主题必须为 2~5 个' };
  }
  const valid = result.children.every(child =>
    typeof child?.name === 'string' && child.name.trim()
    && typeof child.description === 'string' && child.description.trim()
    && Number.isFinite(child.estimateMinutes) && child.estimateMinutes > 0 && child.estimateMinutes <= 45
    && Array.isArray(child.evidence) && child.evidence.length > 0
    && child.evidence.every(item => typeof item === 'string' && item.trim()));
  return valid ? { valid: true } : { valid: false, reason: '子主题名称、描述、时长或掌握证据不完整' };
}

export function rescopeEdgesForTopic(edges, topicId, rescopeBatchId) {
  return edges.map(edge => {
    if (edge.topicId !== topicId && edge.prerequisiteId !== topicId) return edge;
    return {
      ...edge,
      reviewStatus: 'machine',
      ...(edge.reviewStatus === 'reviewed' ? { previousReviewStatus: 'reviewed' } : {}),
      rescopeRequired: true,
      ...(rescopeBatchId ? { rescopeBatchId } : {}),
    };
  });
}

export function reusedSplitParentIds(topics) {
  const byId = new Map(topics.map(topic => [topic.id, topic]));
  return new Set(topics
    .filter(topic => topic.splitFrom && byId.get(topic.splitFrom)?.granularity === 'split-45min')
    .map(topic => topic.splitFrom));
}

export function migrateExistingRescopes(topics, dependencies, rescopeBatchId) {
  const parentIds = reusedSplitParentIds(topics);
  let migrated = dependencies;
  for (const id of [...parentIds].sort()) migrated = rescopeEdgesForTopic(migrated, id, rescopeBatchId);
  return { parentIds, dependencies: migrated };
}

export function prepareGranularityChanges({ topicsDoc, depsDoc, bridgeDepsDoc, results, generationBatchId }) {
  const nextTopicsDoc = structuredClone(topicsDoc);
  const nextDepsDoc = structuredClone(depsDoc);
  const nextBridgeDepsDoc = bridgeDepsDoc ? structuredClone(bridgeDepsDoc) : null;
  const topics = nextTopicsDoc.topics;
  const seenResults = new Set();
  const sortedResults = [...results].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const result of sortedResults) {
    if (seenResults.has(result.id)) throw new Error(`重复审计结果 id: ${result.id}`);
    seenResults.add(result.id);
  }

  const names = new Map();
  for (const topic of topics) {
    const normalized = normalizeTopicName(topic.name);
    if (!names.has(normalized)) names.set(normalized, new Set());
    names.get(normalized).add(topic.id);
  }
  const ids = new Set(topics.map(topic => topic.id));
  let nextId = Math.max(0, ...topics.map(topic => Number(/^mtc_(\d+)$/.exec(topic.id)?.[1] || 0))) + 1;
  const allocateId = () => {
    while (ids.has(`mtc_${nextId}`)) nextId++;
    const id = `mtc_${nextId++}`;
    ids.add(id);
    return id;
  };

  let splitCount = 0;
  let coveredCount = 0;
  for (const result of sortedResults) {
    const topic = topics.find(item => item.id === result.id);
    if (!topic) continue;
    if (result.verdict === 'covered') {
      const coveredBy = [...new Set(result.coveredBy || [])]
        .filter(id => id !== topic.id && ids.has(id))
        .sort();
      if (coveredBy.length < 2) continue;
      topic.status = 'covered';
      topic.coveredBy = coveredBy;
      coveredCount++;
      continue;
    }
    if (result.verdict !== 'split' || topic.granularity === 'split-45min') continue;
    const validation = validateSplitResult(result);
    if (!validation.valid) continue;

    const childNames = result.children.map(child => normalizeTopicName(child.name));
    if (new Set(childNames).size !== childNames.length) continue;
    const collides = childNames.some(name => [...(names.get(name) || [])].some(id => id !== topic.id));
    if (collides) continue;

    const originalId = topic.id;
    const first = result.children[0];
    topic.name = first.name.trim();
    topic.description = first.description.trim();
    topic.evidence = first.evidence.map(item => item.trim());
    topic.assessmentPrompt = `让 {{name}} 展示：${topic.evidence[0]}`;
    topic.centrality = null;
    topic.granularity = 'split-45min';
    delete topic.status;
    delete topic.coveredBy;

    for (const child of result.children.slice(1)) {
      topics.push({
        ...topic,
        id: allocateId(),
        name: child.name.trim(),
        description: child.description.trim(),
        evidence: child.evidence.map(item => item.trim()),
        assessmentPrompt: `让 {{name}} 展示：${child.evidence[0].trim()}`,
        centrality: null,
        splitFrom: originalId,
        granularity: 'split-45min',
      });
    }
    nextDepsDoc.dependencies = rescopeEdgesForTopic(nextDepsDoc.dependencies, originalId, generationBatchId);
    if (nextBridgeDepsDoc) {
      nextBridgeDepsDoc.dependencies = rescopeEdgesForTopic(nextBridgeDepsDoc.dependencies, originalId, generationBatchId);
    }
    splitCount++;
  }

  nextTopicsDoc.topicCount = topics.length;
  nextDepsDoc.edgeCount = nextDepsDoc.dependencies.length;
  if (nextBridgeDepsDoc) nextBridgeDepsDoc.edgeCount = nextBridgeDepsDoc.dependencies.length;
  return { topicsDoc: nextTopicsDoc, depsDoc: nextDepsDoc, bridgeDepsDoc: nextBridgeDepsDoc, splitCount, coveredCount };
}
