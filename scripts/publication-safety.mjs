import { computeCentrality } from './compute-centrality.mjs';
import { publishedGraph } from './review-policy.mjs';

export function publicationProblems(topics, dependencies, bridgeDependencies = []) {
  const problems = [];
  const unresolvedRescopes = dependencies.filter(edge => edge.rescopeRequired === true);
  if (unresolvedRescopes.length) problems.push(`${unresolvedRescopes.length} edges still have rescopeRequired`);
  const unresolvedBridgeRescopes = bridgeDependencies.filter(edge => edge.rescopeRequired === true);
  if (unresolvedBridgeRescopes.length) problems.push(`${unresolvedBridgeRescopes.length} bridge edges still have rescopeRequired`);

  const graph = publishedGraph(topics, dependencies);
  const expected = computeCentrality(graph.topics, graph.dependencies).centrality;
  let mismatches = 0;
  for (const topic of graph.topics) {
    if (topic.centrality !== expected.get(topic.id)) mismatches++;
  }
  if (mismatches) problems.push(`${mismatches} topics have stale centrality`);
  return problems;
}
