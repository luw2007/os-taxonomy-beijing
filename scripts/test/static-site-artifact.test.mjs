import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('static export uses relative assets and removes AI controls', () => {
  const out = mkdtempSync(resolve(tmpdir(), 'bst-static-'));
  try {
    const result = spawnSync(process.execPath, ['scripts/export-static-site.mjs', '--upstream', '../os-taxonomy', '--out', out, '--base-path', '/os-taxonomy-beijing/'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const index = readFileSync(resolve(out, 'index.html'), 'utf8');
    const css = readFileSync(resolve(out, 'static-mode.css'), 'utf8');
    assert.match(index, /src="\.\/path\.js"/);
    assert.match(index, /static:true/);
    assert.match(index, /本静态版不提供 AI 功能/);
    assert.match(css, /#mobile-ai-open/);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
