/* === Beijing Skill Taxonomy 知识浏览器前端 (2D 列表布局) ===
 * 路由设计:location.hash 是唯一状态源。
 *   #/                              概览
 *   #/?dim=bj-primary&subject=Mathematics&ageRange=8-10&q=...   列表(筛选状态)
 *   #/mt_AzTrT5ySCx                 详情(topic id 唯一定位)
 *   #/mt_AzTrT5ySCx?dim=bj-primary  详情 + 维度(返回时恢复)
 * 所有导航函数只改 hash,渲染由 hashchange 统一驱动。
 */
'use strict';

const SUBJECT_ZH = {
  'Mathematics': '数学', 'Science': '科学', 'English': '英语', 'Computing': '计算机',
  'History': '历史', 'Learning to Learn': '学习方法', 'Life Skills': '生活技能',
  'Personal & Social Development': '个人与社会发展',
};
const SUBJECT_ZH_FALLBACK = (s) => SUBJECT_ZH[s] || s;

// --- 路由状态(由 hash 解析而来,只读) ---
let route = { view: 'overview', id: null, dim: 'us', subject: null, domain: null, ageRange: null, q: null, gapType: null, grade: null };
let dimensionsData = null;
let subjectsTree = null;

// --- 审核闸门: 是否只看已审核关联 ---
// 默认勾选(只显示 reviewed),保护儿童不看到未审核的 AI 推测关联。
// 字段缺失(老数据)按 machine 处理,不会出现"指令性措辞"误导。
const REVIEW_FILTER_KEY = 'kg-viewer-review-filter';
let reviewFilterOnlyReviewed = (() => {
  const saved = localStorage.getItem(REVIEW_FILTER_KEY);
  // 显式存 '0' 才关闭;否则(包括首次/null)默认开启
  return saved !== '0';
})();

// 年龄段筛选按钮值 → ageRange 区间
const FILTER_TO_RANGE = { young: '4-7', mid: '8-10', old: '11-15' };
const RANGE_TO_FILTER = Object.fromEntries(Object.entries(FILTER_TO_RANGE).map(([k, v]) => [v, k]));

async function api(path) {
  const url = new URL(path, location.origin);
  url.searchParams.set('dimension', route.dim);
  // 审核闸门: 关闭 toggle 时带 review=all 看全部(含 machine);
  // 开启时(默认)不带参数 → API 只返回 reviewed。
  if (!reviewFilterOnlyReviewed && !url.searchParams.has('review')) {
    url.searchParams.set('review', 'all');
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${path} 返回 ${res.status}`);
  return res.json();
}

// === hash 解析与序列化 ===
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, query] = raw.split('?');
  const params = new URLSearchParams(query || '');
  // 课本对比:#/textbook-gaps
  if (path === '/textbook-gaps') {
    return {
      view: 'textbook-gaps', id: null,
      dim: params.get('dim') || 'us',
      subject: params.get('subject'), domain: null, ageRange: null,
      q: params.get('q'), gapType: params.get('gap_type'), grade: params.get('grade'),
    };
  }
  // 详情:#/mt_xxx 或 #/mtc_xxx  其余视为概览/列表(#/ 或空)
  const idMatch = path.match(/^\/(mtc?_[A-Za-z0-9_-]+)$/);
  return {
    view: idMatch ? 'detail' : 'list',
    id: idMatch ? idMatch[1] : null,
    dim: params.get('dim') || 'us',
    subject: params.get('subject'),
    domain: params.get('domain'),
    ageRange: params.get('ageRange'),
    q: params.get('q'),
    gapType: null, grade: null,
  };
}

// 构造 hash(不触发跳转,用于拼链接)
function buildHash(parts) {
  const isGap = (parts.view || route.view) === 'textbook-gaps';
  const merged = isGap
    ? { dim: route.dim, subject: route.subject, q: route.q, gap_type: route.gapType, grade: route.grade, ...parts }
    : { dim: route.dim, subject: route.subject, domain: route.domain, ageRange: route.ageRange, q: route.q, ...parts };
  // 清掉空值与非路由字段
  for (const k of Object.keys(merged)) {
    if (k === 'view') continue;
    if (merged[k] == null || merged[k] === '') delete merged[k];
  }
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(merged)) params.set(k, v);
  const qs = params.toString();
  let base;
  if (parts.view === 'textbook-gaps') base = '/textbook-gaps';
  else if (parts.id != null) base = `/${parts.id}`;
  else base = '/';
  return '#' + base + (qs ? '?' + qs : '');
}

// === 导航:只改 hash,不直接渲染(实现见文末 goOverview) ===

// === 维度切换 ===
async function loadDimensions() {
  const res = await fetch('/api/dimensions');
  if (!res.ok) throw new Error(`/api/dimensions 返回 ${res.status}`);
  dimensionsData = await res.json();
  renderDimensionBar();
}

function renderDimensionBar() {
  if (!dimensionsData) return;
  const bar = document.getElementById('dimension-bar');
  const entries = Object.entries(dimensionsData.dimensions);
  bar.innerHTML = '<span class="dimension-label">维度</span><div class="dimension-btns">' +
    entries.map(([id, dim]) => `<button class="dimension-btn ${id === route.dim ? 'active' : ''}" data-dimension="${id}" title="${escapeHtml(dim.description || '')}" onclick="setDimension('${id}')">${escapeHtml(dim.label)}</button>`).join('') +
    '</div>';
}

function setDimension(dim) {
  if (dim === route.dim) return;
  // 切换维度:清空列表筛选(学科/领域/搜索因目录树变化可能失效),保留在概览
  location.hash = buildHash({ id: null, dim, subject: null, domain: null, q: null, ageRange: route.ageRange });
}

// === 年龄段筛选按钮同步 ===
function syncFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(b => {
    const want = b.dataset.filter === 'all'
      ? route.ageRange == null
      : FILTER_TO_RANGE[b.dataset.filter] === route.ageRange;
    b.classList.toggle('active', want);
  });
}

// === 渲染:概览 ===
async function loadSummary() {
  const summary = await api('/api/summary');
  const el = document.getElementById('stats');
  el.innerHTML = `<div class="stat-line">微主题 <strong>${summary.totalTopics}</strong> · 已译 <strong>${summary.translatedTopics}</strong></div><div class="stat-line">依赖 <strong>${summary.totalDeps}</strong> · 聚类 <strong>${summary.totalClusters}</strong></div><div class="stat-line">${summary.hasUpstream ? '上游 ✓ v' + summary.upstreamVersion : '上游 ✗ 仅中文'}</div>`;
  if (dimensionsData && dimensionsData.dimensions[route.dim]) {
    document.getElementById('hero-desc').textContent = dimensionsData.dimensions[route.dim].description || '';
  }
  const statsEl = document.getElementById('overview-stats');
  const pct = summary.totalTopics > 0 ? (summary.translatedTopics / summary.totalTopics * 100).toFixed(1) : 0;
  statsEl.innerHTML = `<div class="stat-card"><div class="num">${summary.totalTopics}</div><div class="label">微主题总数</div></div><div class="stat-card highlight"><div class="num">${summary.translatedTopics}</div><div class="label">已翻译(${pct}%)</div></div><div class="stat-card"><div class="num">${summary.totalDeps}</div><div class="label">依赖关系</div></div><div class="stat-card"><div class="num">${Object.keys(summary.subjectCounts).length}</div><div class="label">学科</div></div>`;
  await loadSubjectCards();
  await loadTextbookGapCards();
}

async function loadSubjectCards() {
  const tree = await api('/api/subjects');
  subjectsTree = tree;
  const container = document.getElementById('subject-cards');
  const subjects = Object.entries(tree).sort((a, b) => b[1].count - a[1].count);
  container.innerHTML = subjects.map(([subject, data]) => {
    const subjZh = data.subjectZh || SUBJECT_ZH_FALLBACK(subject);
    const domains = Object.entries(data.domains);
    const domainPreview = domains.slice(0, 4).map(([d, dd]) => dd.domainZh || d).join(' · ') + (domains.length > 4 ? ' …' : '');
    return `<a class="subject-card" href="${buildHash({ id: null, subject, domain: null, q: null })}"><h4>${subjZh}</h4><div class="meta"><span>${data.count} 个微主题</span><span>${data.translated} 已译</span><span>${domains.length} 领域</span></div><div class="domains-preview">${domainPreview}</div></a>`;
  }).join('');
}

// === 渲染:目录树 ===
async function loadTree() {
  if (!subjectsTree) subjectsTree = await api('/api/subjects');
  const container = document.getElementById('tree');
  const subjects = Object.entries(subjectsTree).sort((a, b) => b[1].count - a[1].count);
  container.innerHTML = subjects.map(([subject, data]) => {
    const subjZh = data.subjectZh || SUBJECT_ZH_FALLBACK(subject);
    const domains = Object.entries(data.domains).sort((a, b) => b[1].count - a[1].count);
    const domainItems = domains.map(([domain, dd]) => `<a class="tree-domain" href="${buildHash({ id: null, subject, domain, q: null })}" onclick="event.preventDefault();event.stopPropagation();location.hash='${buildHash({ id: null, subject, domain, q: null })}';"><span>${dd.domainZh || domain}</span><span class="tree-domain-count">${dd.count}</span></a>`).join('');
    const isCurrent = route.subject === subject && !route.domain;
    return `<div class="tree-subject ${route.subject === subject ? 'open' : ''}" onclick="toggleSubject(this)"><div class="tree-subject-header ${isCurrent ? 'current' : ''}"><span class="arrow">▶</span><span>${subjZh}</span><span class="tree-subject-count"><span class="translated">${data.translated}</span>/${data.count}</span></div><div class="tree-domains">${domainItems}</div></div>`;
  }).join('');
}

function toggleSubject(el) { el.classList.toggle('open'); }

// === 渲染:列表页 ===
function listTitle() {
  if (route.q) return `搜索: "${route.q}"`;
  if (route.subject && subjectsTree) {
    const sData = subjectsTree[route.subject];
    const subjZh = (sData && sData.subjectZh) || SUBJECT_ZH_FALLBACK(route.subject);
    if (route.domain) {
      const domZh = (sData && sData.domains[route.domain] && sData.domains[route.domain].domainZh) || route.domain;
      return `${subjZh} / ${domZh}`;
    }
    return subjZh;
  }
  return '全部微主题';
}

async function loadTopicList() {
  document.getElementById('list-title').textContent = listTitle();
  const grid = document.getElementById('topic-grid');
  grid.innerHTML = '<p class="tree-loading">加载中…</p>';
  const params = new URLSearchParams();
  if (route.subject) params.set('subject', route.subject);
  if (route.domain) params.set('domain', route.domain);
  if (route.ageRange) params.set('ageRange', route.ageRange);
  if (route.q) params.set('q', route.q);
  const data = await api(`/api/topics?${params}`);
  document.getElementById('list-count').textContent = `${data.count} 个`;
  if (data.topics.length === 0) { grid.innerHTML = '<p style="color:var(--text-muted);padding:20px;">没有匹配的微主题。</p>'; return; }
  data.topics.sort((a, b) => (a.ageRangeStart || 0) - (b.ageRangeStart || 0));
  grid.innerHTML = data.topics.map(t => `<a class="topic-card" href="#/${t.id}?dim=${route.dim}"><div class="card-name">${escapeHtml(t.name)}</div><div class="card-desc">${escapeHtml(t.description || '(无描述)')}</div><div class="card-meta"><span class="tag tag-subject">${SUBJECT_ZH_FALLBACK(t.subject)}</span>${t.domainZh ? `<span class="tag tag-age">${escapeHtml(t.domainZh)}</span>` : ''}${t.ageRangeStart != null ? `<span class="tag tag-age">${t.ageRangeStart}-${t.ageRangeEnd} 岁</span>` : ''}</div></a>`).join('');
}

// === 渲染:课本目录对比(概览页入口卡) ===
const GAP_TYPE_LABEL = { missing: '遗漏', covered: '已有', 'textbook-only': '课本独有' };
const GAP_TYPE_TAG = { missing: 'tag-missing', covered: 'tag-covered', 'textbook-only': 'tag-textbook-only' };

async function loadTextbookGapCards() {
  const el = document.getElementById('textbook-gaps-cards');
  const summary = await api('/api/textbook-gaps');
  if (summary.total === 0) {
    el.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">课本对比报告尚未生成。</p>';
    return;
  }
  const s = summary.summary;
  const miss = s.byGapType.missing || 0;
  const cov = s.byGapType.covered || 0;
  const tbo = s.byGapType['textbook-only'] || 0;
  const subjects = Object.entries(s.bySubject).sort((a, b) => b[1] - a[1]).map(([k]) => k).join(' · ');
  el.innerHTML = `<a class="subject-card" href="${buildHash({ view: 'textbook-gaps', subject: null, domain: null, q: null, gap_type: null, grade: null })}">
    <h4>课本 vs 微主题</h4>
    <div class="meta"><span>共 ${summary.total} 条</span><span class="tag ${GAP_TYPE_TAG.missing}">遗漏 ${miss}</span><span class="tag ${GAP_TYPE_TAG.covered}">已有 ${cov}</span><span class="tag ${GAP_TYPE_TAG['textbook-only']}">课本独有 ${tbo}</span></div>
    <div class="domains-preview">${escapeHtml(subjects)}</div>
  </a>`;
}

// === 渲染:课本目录对比(表格视图) ===
function setGapFilter(key, val) {
  const patch = key === 'clear' ? { subject: null, gap_type: null, grade: null, q: null }
    : { [key === 'gap_type' ? 'gapType' : key]: val || null };
  location.hash = buildHash({ view: 'textbook-gaps', ...patch });
}

async function loadTextbookGaps() {
  const table = document.getElementById('gap-table');
  const countEl = document.getElementById('gap-count');
  table.innerHTML = '<thead><tr><th>加载中…</th></tr></thead>';
  const params = new URLSearchParams();
  if (route.subject) params.set('subject', route.subject);
  if (route.gapType) params.set('gap_type', route.gapType);
  if (route.grade) params.set('grade', route.grade);
  if (route.q) params.set('q', route.q);
  const data = await api(`/api/textbook-gaps?${params}`);
  countEl.textContent = `${data.count} / ${data.total} 条`;

  // 筛选条(全量 summary 驱动,不受当前筛选影响)
  renderGapFilters(data.summary);

  // 搜索框同步
  const searchInp = document.getElementById('gap-search');
  if (route.q) { if (searchInp.value !== route.q) searchInp.value = route.q; }
  else if (searchInp.value) searchInp.value = '';

  if (data.count === 0) {
    table.innerHTML = '<tbody><tr><td style="color:var(--text-muted);padding:20px;">没有匹配的条目。</td></tr></tbody>';
    return;
  }

  // 排序:missing 优先,再按 grade → path
  const gradeOrder = (g) => (g || '').replace(/年级(上|下)/, (m, s) => `年级${s === '上' ? 0 : 1}`);
  const sorted = [...data.gaps].sort((a, b) => {
    if (a.gap_type !== b.gap_type) return a.gap_type === 'missing' ? -1 : 1;
    const ga = gradeOrder(a.grade), gb = gradeOrder(b.grade);
    if (ga !== gb) return ga < gb ? -1 : 1;
    return (a.path || '') < (b.path || '') ? -1 : 1;
  });

  const rows = sorted.map(g => `<tr>
    <td><span class="tag ${GAP_TYPE_TAG[g.gap_type] || ''}">${GAP_TYPE_LABEL[g.gap_type] || g.gap_type}</span></td>
    <td>${escapeHtml(g.subject || '')}</td>
    <td>${escapeHtml(g.grade || '')}</td>
    <td class="gap-topic">${escapeHtml(g.topic || '')}<div class="gap-path">${escapeHtml(g.path || '')}</div></td>
    <td class="gap-textbook">${escapeHtml((g.textbook || '').replace(/\.md$/, ''))}</td>
  </tr>`).join('');
  table.innerHTML = `<thead><tr><th>状态</th><th>学科</th><th>年级</th><th>知识点 / 路径</th><th>课本来源</th></tr></thead><tbody>${rows}</tbody>`;
}

function renderGapFilters(summary) {
  const el = document.getElementById('gap-filters');
  const bySubject = Object.entries(summary.bySubject).sort((a, b) => b[1] - a[1]);
  const byGrade = Object.entries(summary.byGrade).sort((a, b) => a[0] < b[0] ? -1 : 1);
  const byType = Object.entries(summary.byGapType);
  // 学科
  const subjBtns = bySubject.map(([s, n]) => `<button class="filter-btn ${route.subject === s ? 'active' : ''}" onclick="setGapFilter('subject','${s}')">${escapeHtml(s)} <span class="filter-n">${n}</span></button>`).join('');
  // 年级
  const gradeBtns = byGrade.map(([g, n]) => `<button class="filter-btn ${route.grade === g ? 'active' : ''}" onclick="setGapFilter('grade','${g}')">${escapeHtml(g)} <span class="filter-n">${n}</span></button>`).join('');
  // 状态
  const typeBtns = byType.map(([t, n]) => `<button class="filter-btn ${route.gapType === t ? 'active' : ''}" onclick="setGapFilter('gap_type','${t}')">${escapeHtml(GAP_TYPE_LABEL[t] || t)} <span class="filter-n">${n}</span></button>`).join('');
  const clearBtn = (route.subject || route.gapType || route.grade) ? `<button class="filter-btn" onclick="setGapFilter('clear')">✕ 清除</button>` : '';
  el.innerHTML = `<div class="gap-filter-row"><span class="filter-label">状态</span><div class="gap-filter-btns">${typeBtns}</div></div><div class="gap-filter-row"><span class="filter-label">学科</span><div class="gap-filter-btns">${subjBtns}</div></div><div class="gap-filter-row"><span class="filter-label">年级</span><div class="gap-filter-btns">${gradeBtns}</div></div>${clearBtn}`;
}

// === 渲染:详情页 ===
async function loadDetail() {
  const body = document.getElementById('detail-body');
  const badges = document.getElementById('detail-badges');
  body.innerHTML = '<p class="tree-loading">加载中…</p>';
  badges.innerHTML = '';
  const data = await api(`/api/topic/${encodeURIComponent(route.id)}`);
  const t = data.topic;
  const dimHidden = t.dimensionVisible === false;
  badges.innerHTML = `<span class="tag tag-subject">${SUBJECT_ZH_FALLBACK(t.subject)}</span>${t.domainZh ? `<span class="tag tag-age">${escapeHtml(t.domainZh)}</span>` : ''}${t.ageRangeStart != null ? `<span class="tag tag-age">${t.ageRangeStart}-${t.ageRangeEnd} 岁</span>` : ''}${dimHidden ? `<span class="tag tag-us">美版</span>` : ''}`;
  const assessment = escapeHtml(t.assessmentPrompt || '(无)').replace(/\{\{name\}\}/g, '<span class="placeholder">孩子名字</span>');
  const standardsHtml = (data.standards && data.standards.length > 0)
    ? `<div class="standards-list">${data.standards.map(s => `<div class="standard-item"><div class="std-key">${escapeHtml(s.key)}</div><div class="std-strand">${escapeHtml(s.strand || '')}</div><div class="std-note">${escapeHtml(s.note || '')}</div></div>`).join('')}</div>`
    : '<p style="color:var(--text-muted);font-size:13px;">暂无中国课标对齐。</p>';
  // 依赖链接改成 href,可中键打开
  const depLink = (id) => `#/${id}?dim=${route.dim}`;
  // 审核闸门: reviewed 边显示指令性强度标签;machine(或字段缺失)降级为"AI 推测·未核对"。
  // 字段缺失时按 machine 处理(向后兼容老数据)。
  const isReviewed = (d) => d && d.reviewStatus === 'reviewed';
  const strengthTag = (d) => isReviewed(d)
    ? `<span class="dep-strength ${d.strength}">${d.strength === 'hard' ? '必须先学' : '建议先学'}</span>`
    : `<span class="dep-strength unverified" title="这条关联由 AI 推测，尚未经教师核对">AI 推测·未核对</span>`;
  const renderPrereq = (d) => {
    const pt = d.prerequisiteTopic; const hidden = pt && pt.dimensionVisible === false;
    const cls = ['dep-link', hidden ? 'dim-hidden' : '', isReviewed(d) ? '' : 'machine'].filter(Boolean).join(' ');
    return `<a class="${cls}" href="${depLink(d.prerequisiteId)}"><span class="dep-name">${pt ? escapeHtml(pt.name) : d.prerequisiteId}</span>${hidden ? '<span class="dim-hidden-tag">美版</span>' : ''}${strengthTag(d)}</a>${d.reason ? `<div class="dep-reason">${escapeHtml(d.reason)}</div>` : ''}`;
  };
  const renderDependent = (d) => {
    const dt = d.dependentTopic; const hidden = dt && dt.dimensionVisible === false;
    const cls = ['dep-link', hidden ? 'dim-hidden' : '', isReviewed(d) ? '' : 'machine'].filter(Boolean).join(' ');
    return `<a class="${cls}" href="${depLink(d.topicId)}"><span class="dep-name">${dt ? escapeHtml(dt.name) : d.topicId}</span>${hidden ? '<span class="dim-hidden-tag">美版</span>' : ''}${strengthTag(d)}</a>`;
  };
  const prereqs = data.prerequisites || [];
  const dependents = data.dependents || [];
  // 仅显示已审核(默认): 没有已审核边时给空态提示;取消勾选则显示全部(含 machine)。
  const emptyPrereq = reviewFilterOnlyReviewed
    ? '<p class="dep-empty">暂无已审核关联<a class="dep-empty-toggle" onclick="toggleReviewFilter()">（显示全部含 AI 推测）</a></p>'
    : '<p class="dep-empty">无（这是基础知识）</p>';
  const emptyDependents = reviewFilterOnlyReviewed
    ? '<p class="dep-empty">暂无已审核关联<a class="dep-empty-toggle" onclick="toggleReviewFilter()">（显示全部含 AI 推测）</a></p>'
    : '<p class="dep-empty">无</p>';
  const prereqHtml = prereqs.length > 0 ? prereqs.map(renderPrereq).join('') : emptyPrereq;
  const dependentsHtml = dependents.length > 0 ? dependents.map(renderDependent).join('') : emptyDependents;
  // 依赖区顶部的"仅显示已审核关联"toggle。勾选=只看 reviewed(默认),取消=看全部含 machine。
  const toggleHtml = `<label class="review-toggle"><input type="checkbox" id="review-filter" ${reviewFilterOnlyReviewed ? 'checked' : ''} onchange="toggleReviewFilter()"><span>仅显示已审核关联</span><span class="review-toggle-hint">${reviewFilterOnlyReviewed ? '✓ 教师已核对' : '含 AI 推测·未核对'}</span></label>`;
  body.innerHTML = `<h2>${escapeHtml(t.name)}</h2><div class="detail-id">${t.id}</div><div class="detail-section"><h3>📖 描述</h3><div class="detail-desc">${escapeHtml(t.description || '(无描述)')}</div></div>${t.evidence && t.evidence.length > 0 ? `<div class="detail-section"><h3>✓ 掌握证据</h3><ul class="evidence-list">${t.evidence.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>` : ''}<div class="detail-section"><h3>🎯 评估话术</h3><div class="assessment-box">${assessment}</div></div><div class="detail-section"><h3>📋 中国课标对齐</h3>${standardsHtml}</div><div class="detail-section"><h3>🔗 知识依赖关系</h3>${toggleHtml}<div class="dep-section"><div class="dep-box"><h4>前置(学这个之前要先掌握)</h4>${prereqHtml}</div><div class="dep-box"><h4>后续(学了这个才能学的)</h4>${dependentsHtml}</div></div></div>`;
}

// === 审核闸门 toggle ===
// 切换"仅显示已审核关联":写 localStorage + 重新拉取当前 topic 渲染。
function toggleReviewFilter() {
  reviewFilterOnlyReviewed = !reviewFilterOnlyReviewed;
  localStorage.setItem(REVIEW_FILTER_KEY, reviewFilterOnlyReviewed ? '1' : '0');
  // 同步 checkbox 状态(空态提示里的 a 也会触发,此时 checkbox 可能刚渲染)
  const cb = document.getElementById('review-filter');
  if (cb) cb.checked = reviewFilterOnlyReviewed;
  if (route.view === 'detail' && route.id) {
    loadDetail();
  }
}
window.toggleReviewFilter = toggleReviewFilter;

// === hashchange:唯一渲染入口 ===
async function render() {
  route = parseHash();
  // 同步维度按钮高亮
  document.querySelectorAll('.dimension-btn').forEach(b => b.classList.toggle('active', b.dataset.dimension === route.dim));
  // 同步年龄筛选按钮
  syncFilterButtons();

  // 课本目录对比视图
  if (route.view === 'textbook-gaps') {
    showView('textbook-gaps');
    await loadTextbookGaps();
    return;
  }

  // 概览页:无 subject/domain/q 时视为概览(列表态全空 = 概览)
  const isOverview = !route.id && !route.subject && !route.domain && !route.q && !route.ageRange;

  if (route.id) {
    showView('detail');
    await loadDetail();
    return;
  }

  // 维度变化或目录树未加载时,重载统计 + 目录树
  if (subjectsTree == null || subjectsTree.__dim !== route.dim) {
    subjectsTree = null;
    await loadSummary();
    await loadTree();
    subjectsTree.__dim = route.dim; // 标记当前维度
  }

  if (isOverview) {
    showView('overview');
  } else {
    showView('list');
    await loadTopicList();
  }
}

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// === 搜索框 ===
let searchTimer;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => {
    // 清空搜索框 → 回到概览(或保留当前学科?这里回到概览)
    location.hash = buildHash({ id: null, q: q || null, subject: null, domain: null });
  }, 300);
});

// === 课本对比搜索框 ===
let gapSearchTimer;
document.getElementById('gap-search').addEventListener('input', (e) => {
  clearTimeout(gapSearchTimer);
  const q = e.target.value.trim();
  gapSearchTimer = setTimeout(() => {
    location.hash = buildHash({ view: 'textbook-gaps', q: q || null });
  }, 300);
});

// 搜索框随路由同步:进入列表态且无 q 时清空
function syncSearchBox() {
  const inp = document.getElementById('search');
  if (route.q) { if (inp.value !== route.q) inp.value = route.q; }
  else if (inp.value) inp.value = '';
}

// === 年龄筛选按钮 ===
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const f = btn.dataset.filter;
    const ageRange = f === 'all' ? null : FILTER_TO_RANGE[f];
    // 在当前列表基础上叠加年龄筛选;若在概览页则切到列表
    location.hash = buildHash({ id: null, ageRange });
  });
});

// === 返回按钮 ===
document.getElementById('detail-back').addEventListener('click', () => {
  // 详情返回:恢复之前的列表/概览(去掉 id)
  location.hash = buildHash({ id: null });
});

// 顶部 list 的返回按钮是 <a onclick="goOverview()">
function goOverview() { location.hash = buildHash({ id: null, subject: null, domain: null, q: null, ageRange: route.ageRange }); }

// === 工具 ===
function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// === 启动 ===
window.addEventListener('hashchange', () => { render(); syncSearchBox(); });

(async () => {
  try {
    await loadDimensions();
    // 首次加载:若无 hash,设置默认(触发 render);否则直接 render
    if (!location.hash) {
      const def = dimensionsData.defaultDimension || 'us';
      location.hash = `#/?dim=${def}`;
    } else {
      await render();
      syncSearchBox();
    }
  } catch (err) {
    console.error('初始化失败:', err);
    document.getElementById('stats').innerHTML = `<span style="color:var(--primary);">加载失败: ${err.message}</span>`;
  }
})();
