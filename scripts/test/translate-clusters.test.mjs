import assert from 'node:assert/strict';
import test from 'node:test';

import { buildClusterOutput, clusterKey } from '../translate-clusters.mjs';

const upstream = {
  version: 'v1',
  clusters: [
    { subject: 'Math', domain: 'Numbers', ageRangeStart: 5, summary: 'Math summary' },
    { subject: 'Science', domain: 'Animals', ageRangeStart: 5, summary: 'Animal summary' },
  ],
};

const current = {
  version: '1.2.0-zh.0',
  upstreamVersion: 'v1',
  clusterCount: 2,
  clusters: [
    { subject: 'Math', domain: 'Numbers', domainZh: '数与运算', ageRangeStart: 5, summary: '人工译文', translationStatus: 'reviewed' },
    { subject: 'Science', domain: 'Animals', domainZh: '动物', ageRangeStart: 6, summary: 'orphan' },
  ],
};

test('clusterKey is stable across the upstream alignment triple', () => {
  assert.equal(clusterKey(upstream.clusters[0]), 'Math|Numbers|5');
});

test('buildClusterOutput preserves matching translations, removes orphans, and marks generated rows machine', () => {
  const output = buildClusterOutput({
    upstreamClusters: upstream,
    currentClusters: current,
    generated: new Map([[clusterKey(upstream.clusters[1]), { summary: '动物译文', domainZh: '动物' }]]),
  });

  assert.equal(output.clusterCount, 2);
  assert.deepEqual(output.clusters.map(cluster => cluster.summary), ['人工译文', '动物译文']);
  assert.equal(output.clusters[0].translationStatus, 'reviewed');
  assert.equal(output.clusters[1].translationStatus, 'machine');
  assert.equal(output.clusters.some(cluster => cluster.ageRangeStart === 6), false);
});
