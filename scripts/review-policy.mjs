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
// reviewedBy/reviewedAt/reviewNote/rescopeBatchId/generationBatchId 等内部审核簿记一律不出网。
export const PUBLISHED_EDGE_PROPS = Object.freeze(['strength', 'reason', 'reviewStatus', 'reviewProvenance']);

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
