import assert from 'node:assert/strict';
import test from 'node:test';

import { staticAssetUrl, staticApiUrl } from '../static-site.mjs';

test('builds project-site relative static asset URLs', () => {
  assert.equal(staticAssetUrl('/os-taxonomy-beijing/', 'path.js'), '/os-taxonomy-beijing/path.js');
  assert.equal(staticAssetUrl('/', 'style.css'), '/style.css');
});

test('maps read APIs to generated JSON files', () => {
  assert.equal(staticApiUrl('/os-taxonomy-beijing/', '/api/path-data'), '/os-taxonomy-beijing/api/path-data.json');
  assert.equal(staticApiUrl('/os-taxonomy-beijing/', '/api/topic/mt_a'), '/os-taxonomy-beijing/api/topic/mt_a.json');
  assert.equal(staticApiUrl('/', '/api/summary?dimension=us'), '/api/summary.json');
  assert.throws(() => staticApiUrl('/', '/api/chat'), /read-only/);
});
