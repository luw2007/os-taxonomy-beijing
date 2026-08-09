#!/usr/bin/env node
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const index = readFileSync(new URL('../../viewer/index.html', import.meta.url), 'utf8');
const pathJs = readFileSync(new URL('../../viewer/path.js', import.meta.url), 'utf8');
const graphJs = readFileSync(new URL('../../viewer/app.js', import.meta.url), 'utf8');

test('the workspace is one document without an iframe or graph compatibility entry', () => {
  assert.doesNotMatch(index, /<iframe\b/i);
  assert.match(index, /id="graph-pane"/);
  assert.match(index, /id="graph-overview"/);
  assert.match(index, /data-tab="graph"/);
});

test('only the shell owns hash routing', () => {
  assert.match(pathJs, /addEventListener\(['"]hashchange['"]/);
  assert.doesNotMatch(graphJs, /location\.hash|hashchange|buildHash|parseHash/);
  assert.doesNotMatch(pathJs, /contentWindow|contentDocument|graphLoaded|pendingGraphTopicId/);
});

test('mobile navigation exposes path, graph, catalog, and profile destinations', () => {
  for (const tab of ['path', 'graph', 'catalog', 'profile']) {
    assert.match(index, new RegExp(`data-mobile-tab="${tab}"`));
  }
});
