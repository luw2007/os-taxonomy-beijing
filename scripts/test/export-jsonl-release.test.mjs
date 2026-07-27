import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExportManifest } from '../export-jsonl.mjs';

test('export manifest uses the dataset timestamp, not export wall-clock time', () => {
  const manifest = buildExportManifest({
    taxonomyVersion: '1.2.0-zh.0',
    generatedAt: '2026-07-20T00:00:00.000Z',
    nodes: [{ id: 'mt_a' }],
    relationships: [{ id: 'mt_b->mt_a' }],
  });
  assert.equal(manifest.generatedAt, '2026-07-20T00:00:00.000Z');
  assert.deepEqual(manifest.counts, { nodes: 1, relationships: 1 });
});
