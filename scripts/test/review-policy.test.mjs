import assert from 'node:assert/strict';
import test from 'node:test';

import { filterPublishedDependencies } from '../review-policy.mjs';

test('child-facing publication exposes only reviewed, non-rescope dependencies', () => {
  const edges = [
    { topicId: 'b', prerequisiteId: 'a', reviewStatus: 'reviewed' },
    { topicId: 'c', prerequisiteId: 'a', reviewStatus: 'machine' },
    { topicId: 'd', prerequisiteId: 'a', reviewStatus: 'reviewed', rescopeRequired: true },
    { topicId: 'e', prerequisiteId: 'a', reviewStatus: 'rejected' },
  ];
  assert.deepEqual(filterPublishedDependencies(edges).map(edge => edge.topicId), ['b']);
});
