const ROUTE_KEYS = ['tab', 'dim', 'subject', 'domain', 'ageRange', 'q'];

export function parseRoute(hash) {
  const [path, query = ''] = (String(hash || '').replace(/^#/, '') || '/').split('?');
  const params = new URLSearchParams(query);
  const idMatch = path.match(/^\/(mtc?_[A-Za-z0-9_-]+)$/);
  const subject = params.get('subject') || null;
  return {
    id: idMatch ? idMatch[1] : null,
    tab: params.get('tab') === 'graph' ? 'graph' : 'path',
    dim: params.get('dim') || null,
    subject,
    domain: subject ? params.get('domain') || null : null,
    ageRange: params.get('ageRange') || null,
    q: params.get('q') || null,
  };
}

export function buildRoute(parts = {}, current = {}) {
  const merged = { tab: 'path', id: null, dim: null, subject: null, domain: null, ageRange: null, q: null, ...current, ...parts };
  if (merged.tab !== 'graph') merged.tab = 'path';
  if (!merged.subject) merged.domain = null;
  const params = new URLSearchParams();
  for (const key of ROUTE_KEYS) {
    const value = merged[key];
    if (key === 'tab' && value === 'path') continue;
    if (value != null && value !== '') params.set(key, value);
  }
  const query = params.toString();
  return `#/${merged.id || ''}${query ? `?${query}` : ''}`;
}

export function navigate(parts, current = parseRoute(location.hash)) {
  const next = buildRoute(parts, current);
  if (location.hash !== next) location.hash = next;
}

// Backward-compatible aliases for callers outside the workspace shell.
export const parsePathRoute = parseRoute;
export function buildPathHash(parts) { return buildRoute(parts); }
