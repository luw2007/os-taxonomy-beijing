const ROUTE_KEYS = ['tab', 'dim', 'subject', 'domain', 'ageRange', 'q'];

export function parseRoute(hash) {
  const [path, query = ''] = (String(hash || '').replace(/^#/, '') || '/').split('?');
  const params = new URLSearchParams(query);
  const idMatch = path.match(/^\/(mtc?_[A-Za-z0-9_-]+)$/);
  const subject = params.get('subject') || null;
  const view = path === '/textbook-gaps' ? 'textbook-gaps' : null;
  const base = {
    id: idMatch ? idMatch[1] : null,
    tab: params.get('tab') === 'graph' ? 'graph' : 'path',
    dim: params.get('dim') || null,
    subject,
    domain: view || subject ? params.get('domain') || null : null,
    ageRange: params.get('ageRange') || null,
    q: params.get('q') || null,
  };
  return view ? { ...base, view, gapType: params.get('gap_type') || null, grade: params.get('grade') || null } : base;
}

export function buildRoute(parts = {}, current = {}) {
  const merged = {
    tab: 'path', id: null, dim: null, subject: null, domain: null, ageRange: null, q: null,
    view: null, gapType: null, grade: null, ...current, ...parts,
  };
  if (merged.tab !== 'graph') merged.tab = 'path';
  if (!merged.subject) merged.domain = null;
  if (merged.view !== 'textbook-gaps') { merged.view = null; merged.gapType = null; merged.grade = null; }
  const params = new URLSearchParams();
  for (const key of ROUTE_KEYS) {
    const value = merged[key];
    if (key === 'tab' && value === 'path') continue;
    if (value != null && value !== '') params.set(key, value);
  }
  if (merged.view === 'textbook-gaps') {
    if (merged.gapType) params.set('gap_type', merged.gapType);
    if (merged.grade) params.set('grade', merged.grade);
  }
  const query = params.toString();
  const base = merged.view === 'textbook-gaps' ? '/textbook-gaps' : `/${merged.id || ''}`;
  return `#${base}${query ? `?${query}` : ''}`;
}

export function navigate(parts, current = parseRoute(location.hash)) {
  const next = buildRoute(parts, current);
  if (location.hash !== next) location.hash = next;
}

export const parsePathRoute = parseRoute;
export function buildPathHash(parts) { return buildRoute(parts); }
