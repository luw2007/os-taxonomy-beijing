import assert from 'node:assert/strict';
import test from 'node:test';

import { publicationProblems } from '../publication-safety.mjs';

test('publish readiness rejects reviewed rescope edges and stale centrality', () => {
  const topics = [
    { id: 'a', nodeKind: 'concept', centrality: 1 },
    { id: 'b', nodeKind: 'concept', centrality: 0 },
  ];
  const dependencies = [
    { topicId: 'b', prerequisiteId: 'a', reviewStatus: 'reviewed', rescopeRequired: true },
  ];
  const problems = publicationProblems(topics, dependencies);
  assert.ok(problems.some(problem => problem.includes('rescopeRequired')));
  assert.ok(problems.some(problem => problem.includes('centrality')));
});

test('publish readiness rejects quarantined bridge edges', () => {
  const topics = [
    { id: 'a', nodeKind: 'concept', centrality: 0 },
  ];
  const bridgeDependencies = [
    { topicId: 'a', prerequisiteId: 'upstream', reviewStatus: 'machine', rescopeRequired: true },
  ];
  const problems = publicationProblems(topics, [], bridgeDependencies);
  assert.ok(problems.includes('1 bridge edges still have rescopeRequired'));
});

test('publish readiness accepts reviewed graph with fresh centrality', () => {
  const topics = [
    { id: 'a', nodeKind: 'concept', centrality: 1 },
    { id: 'b', nodeKind: 'concept', centrality: 0 },
  ];
  const dependencies = [{ topicId: 'b', prerequisiteId: 'a', reviewStatus: 'reviewed' }];
  assert.deepEqual(publicationProblems(topics, dependencies), []);
});

test('publish readiness is unaffected by reviewProvenance metadata (coverage lives in validate.mjs --publish)', () => {
  const topics = [
    { id: 'a', nodeKind: 'concept', centrality: 1 },
    { id: 'b', nodeKind: 'concept', centrality: 0 },
  ];
  const withProvenance = [{ topicId: 'b', prerequisiteId: 'a', reviewStatus: 'reviewed', reviewProvenance: 'rule' }];
  const withoutProvenance = [{ topicId: 'b', prerequisiteId: 'a', reviewStatus: 'reviewed' }];
  assert.deepEqual(publicationProblems(topics, withProvenance), []);
  assert.deepEqual(publicationProblems(topics, withoutProvenance), []);
});
