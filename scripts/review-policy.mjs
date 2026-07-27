export function filterPublishedDependencies(dependencies) {
  return dependencies.filter(edge => edge.reviewStatus === 'reviewed' && edge.rescopeRequired !== true);
}

export function filterPublishedTopics(topics) {
  return topics.filter(topic => topic.status !== 'covered');
}

export function publishedGraph(topics, dependencies) {
  const publishedTopics = filterPublishedTopics(topics);
  const ids = new Set(publishedTopics.map(topic => topic.id));
  const publishedDependencies = filterPublishedDependencies(dependencies)
    .filter(edge => ids.has(edge.topicId) && ids.has(edge.prerequisiteId));
  return { topics: publishedTopics, dependencies: publishedDependencies };
}

// 审核结论的证据等级。upstream 只在合并期标记，不写入 data/*.json。
export const REVIEW_PROVENANCE = Object.freeze(['upstream', 'rule', 'ai-consensus', 'human']);

// 上游 mt_→mt_ 边在上游图里即为发布态，本项目不重审，也不把该状态写回
// data/dependencies.zh.json（翻译文件只含翻译字段）。
export const UPSTREAM_EDGE_REVIEW = Object.freeze({ reviewStatus: 'reviewed', reviewProvenance: 'upstream' });

// 对外发布（HTTP API / JSONL 导出）允许透出的边属性白名单。
// reviewedBy/reviewedAt/reviewNote/rescopeBatchId/generationBatchId 等内部审核簿记一律不出网；
// reviewerRole 仅为经验证的公开角色，不含身份信息或审核记录。
export const PUBLISHED_EDGE_PROPS = Object.freeze(['strength', 'reason', 'reviewStatus', 'reviewProvenance', 'reviewerRole']);

// HTTP 主题 API 的公开字段。保留本地浏览器所需的教学载荷与显示派生字段；
// split/coverage/generation 等内部构建簿记绝不通过 API 暴露。
export const PUBLISHED_TOPIC_PROPS = Object.freeze([
  'id', 'name', 'description', 'subject', 'domain', 'ageRangeStart', 'ageRangeEnd',
  'type', 'nodeKind', 'centrality', 'translationStatus', 'cnStandards',
  'evidence', 'assessmentPrompt', 'translated', 'subjectZh', 'domainZh',
]);

export function publishedTopic(topic) {
  const published = {};
  for (const key of PUBLISHED_TOPIC_PROPS) {
    if (topic[key] !== undefined) published[key] = topic[key];
  }
  return published;
}

/**
 * 合并出完整图的全部边：上游边（中文 reason 覆盖）+ 中国内部边 + 跨图桥接边。
 * serve.mjs 与 export-jsonl.mjs 共用，避免两处合并逻辑漂移。
 */
export function mergeDependencies({ upstreamDeps, zhDeps, cnDeps, bridgeDeps }) {
  const merged = [];
  if (upstreamDeps) {
    const zhReason = new Map(zhDeps.dependencies.map(d => [`${d.topicId}->${d.prerequisiteId}`, d.reason]));
    for (const d of upstreamDeps.dependencies) {
      const key = `${d.topicId}->${d.prerequisiteId}`;
      // 中文 reason 按「是否存在译文条目」覆盖（非 truthiness——空串也算已译，不回落英文）
      merged.push({ ...d, ...(zhReason.has(key) ? { reason: zhReason.get(key) } : null), ...UPSTREAM_EDGE_REVIEW });
    }
  } else {
    for (const d of zhDeps.dependencies) merged.push({ ...d, ...UPSTREAM_EDGE_REVIEW });
  }
  if (cnDeps) merged.push(...cnDeps.dependencies);
  if (bridgeDeps) merged.push(...bridgeDeps.dependencies);
  return merged;
}

/**
 * 合并完整 topic 核心字段：上游提供结构，中文平行文件覆盖文本，中国特有主题直接追加。
 * enrich 仅供展示层补 subjectZh/domainZh 等派生字段，导出层保持原始核心数据。
 */
export function mergeTopics({ upstreamTopics, zhTopics, cnTopics, enrich = (topic) => topic }) {
  const zhById = new Map((zhTopics?.topics ?? []).map(topic => [topic.id, topic]));
  const upstreamById = new Map((upstreamTopics?.topics ?? []).map(topic => [topic.id, topic]));
  const ids = new Set([...zhById.keys(), ...upstreamById.keys()]);
  const merged = [];

  for (const id of ids) {
    const upstream = upstreamById.get(id);
    const zh = zhById.get(id);
    if (upstream && zh) {
      const topic = { ...upstream, name: zh.name, description: zh.description, cnStandards: zh.cnStandards ?? [],
        translationStatus: zh.translationStatus ?? 'untranslated', translated: true };
      if (zh.evidence !== undefined) topic.evidence = zh.evidence;
      if (zh.assessmentPrompt !== undefined) topic.assessmentPrompt = zh.assessmentPrompt;
      merged.push(enrich(topic, 'translated'));
    } else if (upstream) {
      merged.push(enrich({ ...upstream, cnStandards: [], translationStatus: 'untranslated', translated: false }, 'upstream'));
    } else if (zh) {
      merged.push(enrich({ ...zh, translated: true, orphaned: true }, 'zh-orphan'));
    }
  }

  for (const topic of cnTopics?.topics ?? []) {
    if (ids.has(topic.id)) throw new Error(`cn-origin topic id collides with upstream/zh id: ${topic.id}`);
    merged.push(enrich({ ...topic, translated: true, translationStatus: 'cn-origin', cnOrigin: true }, 'cn-origin'));
  }
  return merged;
}
