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
