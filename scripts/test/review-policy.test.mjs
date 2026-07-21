import assert from 'node:assert/strict';
import test from 'node:test';

import { filterPublishedDependencies, filterPublishedTopics } from '../review-policy.mjs';

test('child-facing publication exposes only reviewed, non-rescope dependencies', () => {
  const edges = [
    { topicId: 'b', prerequisiteId: 'a', reviewStatus: 'reviewed' },
    { topicId: 'c', prerequisiteId: 'a', reviewStatus: 'machine' },
    { topicId: 'd', prerequisiteId: 'a', reviewStatus: 'reviewed', rescopeRequired: true },
    { topicId: 'e', prerequisiteId: 'a', reviewStatus: 'rejected' },
  ];
  assert.deepEqual(filterPublishedDependencies(edges).map(edge => edge.topicId), ['b']);
});

test('child-facing publication hides covered parent topics', () => {
  assert.deepEqual(filterPublishedTopics([{ id: 'a' }, { id: 'b', status: 'covered' }]).map(topic => topic.id), ['a']);
});
