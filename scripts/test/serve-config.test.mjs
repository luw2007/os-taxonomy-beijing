import assert from 'node:assert/strict';
import test from 'node:test';

import { parseHost } from '../serve-config.mjs';

test('parseHost binds loopback by default', () => {
  assert.equal(parseHost([]), '127.0.0.1');
});

test('parseHost accepts an explicit IPv4 host', () => {
  assert.equal(parseHost(['--host', '0.0.0.0']), '0.0.0.0');
});

test('parseHost rejects a missing or malformed host', () => {
  assert.throws(() => parseHost(['--host']), /--host/);
  assert.throws(() => parseHost(['--host', 'not-an-ip']), /IP/);
});
