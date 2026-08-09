import assert from 'node:assert/strict';
import test from 'node:test';

import { cachePolicyForRequest, staticPathForRequest } from '../cache-policy.mjs';

test('maps the root and viewer resources into the static zone', () => {
  assert.equal(staticPathForRequest('/'), '/static/index.html');
  assert.equal(staticPathForRequest('/app.js'), '/static/app.js');
  assert.equal(staticPathForRequest('/static/path.css'), '/static/path.css');
  assert.equal(staticPathForRequest('/api/summary'), null);
});

test('separates static, read-only API, and side-effect requests', () => {
  assert.deepEqual(cachePolicyForRequest({ method: 'GET', pathname: '/static/app.js' }), {
    zone: 'static', cacheControl: 'public, max-age=0, must-revalidate',
  });
  assert.deepEqual(cachePolicyForRequest({ method: 'GET', pathname: '/api/topics' }), {
    zone: 'read-api', cacheControl: 'no-cache',
  });
  assert.deepEqual(cachePolicyForRequest({ method: 'POST', pathname: '/api/chat' }), {
    zone: 'side-effect', cacheControl: 'no-store',
  });
  assert.deepEqual(cachePolicyForRequest({ method: 'GET', pathname: '/api/chat' }), {
    zone: 'passthrough', cacheControl: 'no-store',
  });
});

test('does not allow the worker to cache unknown API routes', () => {
  assert.deepEqual(cachePolicyForRequest({ method: 'GET', pathname: '/api/not-found' }), {
    zone: 'passthrough', cacheControl: 'no-store',
  });
});
