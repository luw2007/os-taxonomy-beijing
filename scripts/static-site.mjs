const READ_API = new Set([
  '/api/dimensions', '/api/summary', '/api/topics', '/api/clusters', '/api/standards',
  '/api/subjects', '/api/path-data', '/api/textbook-gaps',
]);

export function normalizeBase(basePath = '/') {
  const base = `/${String(basePath).replace(/^\/+|\/+$/g, '')}`;
  return base === '/' ? '/' : `${base}/`;
}

export function staticAssetUrl(basePath, asset) {
  return `${normalizeBase(basePath)}${String(asset).replace(/^\/+/, '')}`;
}

export function staticApiUrl(basePath, apiPath) {
  const url = new URL(apiPath, 'https://static.invalid');
  if (READ_API.has(url.pathname)) return staticAssetUrl(basePath, `${url.pathname.slice(1)}.json`);
  const topic = url.pathname.match(/^\/api\/topic\/([^/]+)$/);
  if (topic) return staticAssetUrl(basePath, `api/topic/${topic[1]}.json`);
  throw new Error(`Static export supports read-only APIs only: ${url.pathname}`);
}
