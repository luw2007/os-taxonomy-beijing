const config = window.BST_STATIC_CONFIG;
if (config?.static) {
  const base = new URL(config.basePath || './', location.origin).pathname.replace(/\/$/, '');
  const originalFetch = window.fetch.bind(window);
  const asset = path => `${base}/${path.replace(/^\//, '')}`;
  const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
  const request = async input => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.origin);
    const method = typeof input === 'string' ? 'GET' : input.method;
    if (method !== 'GET') return new Response(JSON.stringify({ error: '静态版不提供 AI 功能' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
    const path = url.pathname.startsWith('/api/') ? url.pathname : url.pathname.slice(base.length) || '/';
    const dimension = url.searchParams.get('dimension');
    const file = path.startsWith('/api/topic/')
      ? `api/topic/${path.slice('/api/topic/'.length)}${dimension ? `.${encodeURIComponent(dimension)}` : ''}.json`
      : dimension && ['/api/summary', '/api/topics', '/api/subjects'].includes(path)
        ? `${path.slice(1)}.${encodeURIComponent(dimension)}.json`
        : `${path.slice(1)}.json`;
    const response = await originalFetch(asset(file));
    if (!response.ok) return response;
    const data = await response.json();
    if (path === '/api/topics') {
      let topics = data.topics;
      const subject = url.searchParams.get('subject'), domain = url.searchParams.get('domain');
      const age = url.searchParams.get('age'), ageRange = url.searchParams.get('ageRange'), q = url.searchParams.get('q')?.toLowerCase();
      if (subject) topics = topics.filter(topic => topic.subject === subject);
      if (domain) topics = topics.filter(topic => topic.domain === domain);
      if (age) topics = topics.filter(topic => topic.ageRangeStart === Number(age));
      if (ageRange) { const [lo, hi] = ageRange.split('-').map(Number); topics = topics.filter(topic => topic.ageRangeStart >= lo && topic.ageRangeStart <= hi); }
      if (q) topics = topics.filter(topic => `${topic.name} ${topic.description} ${topic.id}`.toLowerCase().includes(q));
      return json({ count: topics.length, topics });
    }
    if (path === '/api/textbook-gaps') {
      let gaps = data.gaps;
      for (const [key, field] of [['subject', 'subject'], ['gap_type', 'gap_type'], ['grade', 'grade']]) if (url.searchParams.get(key)) gaps = gaps.filter(gap => gap[field] === url.searchParams.get(key));
      const q = url.searchParams.get('q')?.toLowerCase();
      if (q) gaps = gaps.filter(gap => `${gap.topic} ${gap.path} ${gap.textbook}`.toLowerCase().includes(q));
      return json({ ...data, count: gaps.length, gaps });
    }
    return json(data);
  };
  window.fetch = request;
}
