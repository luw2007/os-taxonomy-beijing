import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveManifestCounts, mergeManifestCounts } from '../checksum.mjs';

test('derives manifest counts from current data arrays', () => {
  const counts = deriveManifestCounts({
    topicsZh: { topics: [{}, {}] },
    cnTopics: { topics: [{}] },
    dependenciesZh: { dependencies: [{}, {}, {}] },
    cnDependencies: { dependencies: [{}, {}] },
    clustersZh: { clusters: [{}] },
    cnStandards: {
      curricula: [
        { topics: [{}, {}] },
        { topics: [{}] },
      ],
    },
  });

  assert.deepEqual(counts, {
    topicsZh: 2,
    cnTopics: 1,
    dependenciesZh: 3,
    clustersZh: 1,
    cnCurricula: 2,
    cnCurriculumEntries: 3,
    cnDeps: 2,
  });
});

test('updates derived counts without dropping manual alignment counters', () => {
  assert.deepEqual(
    mergeManifestCounts(
      { cnDeps: 1, alignedMathTotal: 446 },
      { cnDeps: 2619 }
    ),
    { cnDeps: 2619, alignedMathTotal: 446 }
  );
});
