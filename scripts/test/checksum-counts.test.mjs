import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveManifestCounts, mergeManifestCounts } from '../checksum.mjs';

test('derives manifest counts from current data arrays', () => {
  const counts = deriveManifestCounts({
    topicsZh: { topics: [{}, {}] },
    cnTopics: { topics: [{}] },
    dependenciesZh: { dependencies: [{}, {}, {}] },
    cnDependencies: {
      dependencies: [
        { reviewStatus: 'reviewed', reviewProvenance: 'rule' },
        { reviewStatus: 'reviewed', reviewProvenance: 'ai-consensus' },
        { reviewStatus: 'machine' },
        { reviewStatus: 'rejected', reviewProvenance: 'human' },
      ],
    },
    cnBridgeDependencies: {
      dependencies: [
        { reviewStatus: 'reviewed' },
        { reviewStatus: 'rejected' },
        { reviewStatus: 'reviewed' },
        {},
      ],
    },
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
    cnDeps: 4,
    cnDepsReview: { reviewed: 2, machine: 1, rejected: 1 },
    cnBridgeReview: { reviewed: 2, machine: 1, rejected: 1 },
    cnDepsProvenance: { rule: 1, 'ai-consensus': 1, human: 1 },
  });
});

test('cn-deps edges default to machine review status when reviewStatus is missing', () => {
  const counts = deriveManifestCounts({
    topicsZh: { topics: [] },
    cnTopics: { topics: [] },
    dependenciesZh: { dependencies: [] },
    cnDependencies: { dependencies: [{}, { reviewStatus: 'reviewed' }] },
    cnBridgeDependencies: { dependencies: [] },
    clustersZh: { clusters: [] },
    cnStandards: { curricula: [] },
  });

  assert.deepEqual(counts.cnDepsReview, { reviewed: 1, machine: 1, rejected: 0 });
});

test('cnDepsProvenance tolerates pre-migration data (no reviewProvenance field) without throwing', () => {
  const counts = deriveManifestCounts({
    topicsZh: { topics: [] },
    cnTopics: { topics: [] },
    dependenciesZh: { dependencies: [] },
    cnDependencies: { dependencies: [{ reviewStatus: 'reviewed' }, { reviewStatus: 'machine' }] },
    cnBridgeDependencies: { dependencies: [] },
    clustersZh: { clusters: [] },
    cnStandards: { curricula: [] },
  });

  assert.deepEqual(counts.cnDepsProvenance, { rule: 0, 'ai-consensus': 0, human: 0 });
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
