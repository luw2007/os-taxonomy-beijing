export function parsePathRoute(hash) {
  const [path, query = ''] = (hash.replace(/^#/, '') || '/').split('?');
  const params = new URLSearchParams(query);
  const idMatch = path.match(/^\/(mtc?_[A-Za-z0-9_-]+)$/);
  const subject = params.get('subject');
  const domain = params.get('domain');
  return {
    id: idMatch ? idMatch[1] : null,
    dim: params.get('dim') || null,
    subject: subject && domain ? subject : null,
    domain: subject && domain ? domain : null,
    tab: params.get('tab') === 'graph' ? 'graph' : 'path',
  };
}

export function buildPathHash({ id, dim, subject, domain, tab }) {
  const params = new URLSearchParams();
  if (dim) params.set('dim', dim);
  if (subject && domain) {
    params.set('subject', subject);
    params.set('domain', domain);
  }
  if (tab === 'graph') params.set('tab', 'graph');
  return `#/${id || ''}${params.size ? `?${params}` : ''}`;
}
