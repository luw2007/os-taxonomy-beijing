const READ_API_PATHS = new Set([
  '/api/dimensions',
  '/api/summary',
  '/api/topics',
  '/api/clusters',
  '/api/standards',
  '/api/subjects',
  '/api/path-data',
  '/api/textbook-gaps',
]);

const SIDE_EFFECT_PATHS = new Set(['/api/chat', '/api/assessment', '/api/resolve']);

export function staticPathForRequest(pathname) {
  if (pathname === '/') return '/static/index.html';
  if (pathname.startsWith('/static/')) return pathname;
  if (pathname.startsWith('/api/') || pathname === '/service-worker.js') return null;
  return `/static${pathname}`;
}

export function cachePolicyForRequest({ method, pathname }) {
  if (pathname.startsWith('/static/') && method === 'GET') {
    return { zone: 'static', cacheControl: 'public, max-age=0, must-revalidate' };
  }
  if (method === 'GET' && (READ_API_PATHS.has(pathname) || /^\/api\/topic\/[^/]+$/.test(pathname))) {
    return { zone: 'read-api', cacheControl: 'no-cache' };
  }
  if (method !== 'GET' && SIDE_EFFECT_PATHS.has(pathname)) {
    return { zone: 'side-effect', cacheControl: 'no-store' };
  }
  return { zone: 'passthrough', cacheControl: 'no-store' };
}
