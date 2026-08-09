import { formatMasteryProgress } from './mastery-progress.js';
import { renderAssessmentForm, renderAssessmentResult } from './graph-assessment-ui.js';
import { toggleMastery, addMastery } from './mastery-state.js';
import { ageRangeForAge } from './age-filter.js';
import { buildRoute } from './path-route.js';

/* === Beijing Skill Taxonomy 知识浏览器前端 (2D 列表布局) ===
 * 路由状态由单文档 workspace shell 注入。
 *   #/                              概览
 *   #/?dim=bj-primary&subject=Mathematics&ageRange=8-10&q=...   列表(筛选状态)
 *   #/mt_AzTrT5ySCx                 详情(topic id 唯一定位)
 *   #/mt_AzTrT5ySCx?dim=bj-primary  详情 + 维度(返回时恢复)
 * 所有导航通过注入的 navigate 回调交给 shell。
 */
'use strict';

const SUBJECT_ZH = {
  'Mathematics': '数学', 'Science': '科学', 'English': '英语', 'Computing': '计算机',
  'History': '历史', 'Learning to Learn': '学习方法', 'Life Skills': '生活技能',
  'Personal & Social Development': '个人与社会发展',
};
const SUBJECT_ZH_FALLBACK = (s) => SUBJECT_ZH[s] || s;

// --- 路由状态(由 hash 解析而来,只读) ---
let route = { id: null, tab: 'graph', dim: 'us', subject: null, domain: null, ageRange: null, q: null };
let dimensionsData = null;
let subjectsTree = null;


// 精确年龄筛选复用现有 ageRange=<age>-<age> API 语义。
const ageFilter = document.getElementById('age-filter');
let bulkMasteryMode = false;
let bulkMasterySelection = new Set();

async function api(path) {
  const url = new URL(path, location.origin);
  url.searchParams.set('dimension', route.dim);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API ${path} 返回 ${res.status}`);
  return res.json();
}

// The shell owns browser routing. This view receives route snapshots and a navigation callback.
let navigateRoute = (parts) => { window.dispatchEvent(new CustomEvent('workspace-navigate', { detail: parts })); };
function graphHash(parts) { return buildRoute(parts, route); }

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
    entries.map(([id, dim]) => `<button class="dimension-btn ${id === route.dim ? 'active' : ''}" data-dimension="${escapeHtml(id)}" title="${escapeHtml(dim.description || '')}">${escapeHtml(dim.label)}</button>`).join('') +
    '</div>';
  bar.onclick = (event) => {
    const button = event.target.closest('.dimension-btn');
    if (button) setDimension(button.dataset.dimension);
  };
}

function setDimension(dim) {
  if (dim === route.dim) return;
  // 切换维度:清空列表筛选(学科/领域/搜索因目录树变化可能失效),保留在概览
  navigateRoute({ id: null, dim, subject: null, domain: null, q: null, ageRange: route.ageRange });
}

function syncFilterButtons() {
  ageFilter.value = route.ageRange?.match(/^(\d+)-\1$/)?.[1] || '';
}

function currentMasteredIds() {
  const users = JSON.parse(localStorage.getItem('kg-demo-users') || 'null');
  const activeId = users?.activeId;
  return new Set(JSON.parse(localStorage.getItem(activeId ? `kg-demo-u-${activeId}-mastered` : 'kg-demo-mastered') || '[]'));
}

function saveMasteredIds(ids) {
  const users = JSON.parse(localStorage.getItem('kg-demo-users') || 'null');
  const activeId = users?.activeId;
  localStorage.setItem(activeId ? `kg-demo-u-${activeId}-mastered` : 'kg-demo-mastered', JSON.stringify([...ids]));
}

function toggleCurrentTopicMastery() {
  if (!route.id) return;
  const mastered = toggleMastery(currentMasteredIds(), route.id);
  saveMasteredIds(mastered);
  loadDetail();
}
window.toggleCurrentTopicMastery = toggleCurrentTopicMastery;

// === 渲染:概览 ===
async function loadSummary() {
  const summary = await api('/api/summary');
  const el = document.getElementById('stats');
  el.innerHTML = `<div class="stat-line">微主题 <strong>${summary.totalTopics}</strong> · 已译 <strong>${summary.translatedTopics}</strong></div><div class="stat-line">依赖 <strong>${summary.totalDeps}</strong> · 聚类 <strong>${summary.totalClusters}</strong></div><div class="stat-line">${summary.hasUpstream ? '上游 ✓ v' + summary.upstreamVersion : '上游 ✗ 仅中文'}</div>`;
  if (dimensionsData && dimensionsData.dimensions[route.dim]) {
    document.getElementById('hero-desc').textContent = dimensionsData.dimensions[route.dim].description || '';
  }
  const statsEl = document.getElementById('overview-stats');
  const progress = formatMasteryProgress(currentMasteredIds(), new Set(summary.topicIds));
  statsEl.innerHTML = `<div class="stat-card"><div class="num">${summary.totalTopics}</div><div class="label">微主题总数</div></div><div class="stat-card highlight"><div class="num">${progress.count}</div><div class="label">已掌握(${progress.percent}%)</div></div><div class="stat-card"><div class="num">${summary.totalDeps}</div><div class="label">依赖关系</div></div><div class="stat-card"><div class="num">${Object.keys(summary.subjectCounts).length}</div><div class="label">学科</div></div>`;
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
    return `<a class="subject-card" href="${graphHash({ id: null, subject, domain: null, q: null })}"><h4>${subjZh}</h4><div class="meta"><span>${data.count} 个微主题</span><span>${data.translated} 已译</span><span>${domains.length} 领域</span></div><div class="domains-preview">${domainPreview}</div></a>`;
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
    const domainItems = domains.map(([domain, dd]) => `<a class="tree-domain" href="${graphHash({ id: null, subject, domain, q: null })}"><span>${dd.domainZh || domain}</span><span class="tree-domain-count">${dd.count}</span></a>`).join('');
    const isCurrent = route.subject === subject && !route.domain;
    return `<div class="tree-subject ${route.subject === subject ? 'open' : ''}"><div class="tree-subject-header ${isCurrent ? 'current' : ''}"><span class="arrow">▶</span><span>${subjZh}</span><span class="tree-subject-count"><span class="translated">${data.translated}</span>/${data.count}</span></div><div class="tree-domains">${domainItems}</div></div>`;
  }).join('');
  container.onclick = (event) => {
    if (event.target.closest('.tree-domain')) return;
    const subject = event.target.closest('.tree-subject');
    if (subject) subject.classList.toggle('open');
  };
}


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
  const toggle = document.getElementById('bulk-mastery-toggle');
  const apply = document.getElementById('bulk-mastery-apply');
  toggle.hidden = false;
  apply.hidden = !bulkMasteryMode;
  toggle.textContent = bulkMasteryMode ? '取消批量标记' : '批量标记';
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
  const mastered = currentMasteredIds();
  const selected = bulkMasterySelection;
  grid.innerHTML = data.topics.map(t => `<a class="topic-card ${bulkMasteryMode ? 'bulk-selecting' : ''} ${mastered.has(t.id) ? 'is-mastered' : ''}" href="${graphHash({ id: t.id })}" data-topic-id="${escapeHtml(t.id)}">${bulkMasteryMode ? `<input class="bulk-mastery-check" type="checkbox" aria-label="标记 ${escapeHtml(t.name)} 为已掌握" ${selected.has(t.id) ? 'checked' : ''}>` : ''}<div class="card-name">${escapeHtml(t.name)}</div><div class="card-desc">${escapeHtml(t.description || '(无描述)')}</div><div class="card-meta"><span class="tag tag-subject">${SUBJECT_ZH_FALLBACK(t.subject)}</span>${t.domainZh ? `<span class="tag tag-age">${escapeHtml(t.domainZh)}</span>` : ''}${t.ageRangeStart != null ? `<span class="tag tag-age">${t.ageRangeStart}-${t.ageRangeEnd} 岁</span>` : ''}${mastered.has(t.id) ? '<span class="tag tag-translated">已掌握</span>' : ''}</div></a>`).join('');
  apply.disabled = selected.size === 0;
  grid.querySelectorAll('.bulk-mastery-check').forEach(check => check.addEventListener('click', event => event.stopPropagation()));
  grid.querySelectorAll('.bulk-mastery-check').forEach(check => check.addEventListener('change', event => {
    const id = event.target.closest('.topic-card').dataset.topicId;
    if (event.target.checked) selected.add(id); else selected.delete(id);
    apply.disabled = selected.size === 0;
  }));
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
  el.innerHTML = `<a class="subject-card" href="${graphHash({ view: 'textbook-gaps', subject: null, domain: null, q: null, gap_type: null, grade: null })}">
    <h4>课本 vs 微主题</h4>
    <div class="meta"><span>共 ${summary.total} 条</span><span class="tag ${GAP_TYPE_TAG.missing}">遗漏 ${miss}</span><span class="tag ${GAP_TYPE_TAG.covered}">已有 ${cov}</span><span class="tag ${GAP_TYPE_TAG['textbook-only']}">课本独有 ${tbo}</span></div>
    <div class="domains-preview">${escapeHtml(subjects)}</div>
  </a>`;
}

// === 渲染:课本目录对比(表格视图) ===
function setGapFilter(key, val) {
  const patch = key === 'clear' ? { subject: null, gap_type: null, grade: null, q: null }
    : { [key === 'gap_type' ? 'gapType' : key]: val || null };
  navigateRoute({ view: 'textbook-gaps', ...patch });
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
  const subjBtns = bySubject.map(([s, n]) => `<button class="filter-btn ${route.subject === s ? 'active' : ''}" data-gap-filter="subject" data-gap-value="${escapeHtml(s)}">${escapeHtml(s)} <span class="filter-n">${n}</span></button>`).join('');
  const gradeBtns = byGrade.map(([g, n]) => `<button class="filter-btn ${route.grade === g ? 'active' : ''}" data-gap-filter="grade" data-gap-value="${escapeHtml(g)}">${escapeHtml(g)} <span class="filter-n">${n}</span></button>`).join('');
  const typeBtns = byType.map(([t, n]) => `<button class="filter-btn ${route.gapType === t ? 'active' : ''}" data-gap-filter="gap_type" data-gap-value="${escapeHtml(t)}">${escapeHtml(GAP_TYPE_LABEL[t] || t)} <span class="filter-n">${n}</span></button>`).join('');
  const clearBtn = (route.subject || route.gapType || route.grade) ? '<button class="filter-btn" data-gap-filter="clear">✕ 清除</button>' : '';
  el.innerHTML = `<div class="gap-filter-row"><span class="filter-label">状态</span><div class="gap-filter-btns">${typeBtns}</div></div><div class="gap-filter-row"><span class="filter-label">学科</span><div class="gap-filter-btns">${subjBtns}</div></div><div class="gap-filter-row"><span class="filter-label">年级</span><div class="gap-filter-btns">${gradeBtns}</div></div>${clearBtn}`;
  el.onclick = (event) => {
    const button = event.target.closest('[data-gap-filter]');
    if (button) setGapFilter(button.dataset.gapFilter, button.dataset.gapValue);
  };
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
  const subjectLink = graphHash({ id: null, subject: t.subject, domain: null, q: null });
  const domainLink = t.domainZh ? graphHash({ id: null, subject: t.subject, domain: t.domain, q: null }) : null;
  badges.innerHTML = `<a class="tag tag-subject detail-filter-link" href="${subjectLink}" aria-label="查看${escapeHtml(SUBJECT_ZH_FALLBACK(t.subject))}知识点">${escapeHtml(SUBJECT_ZH_FALLBACK(t.subject))}</a>${domainLink ? `<a class="tag tag-age detail-filter-link" href="${domainLink}" aria-label="查看${escapeHtml(t.domainZh)}知识点">${escapeHtml(t.domainZh)}</a>` : ''}${t.ageRangeStart != null ? `<span class="tag tag-age">${t.ageRangeStart}-${t.ageRangeEnd} 岁</span>` : ''}${dimHidden ? `<span class="tag tag-us">美版</span>` : ''}`;
  const assessment = escapeHtml(t.assessmentPrompt || '(无)').replace(/\{\{name\}\}/g, '<span class="placeholder">孩子名字</span>');
  const standardsHtml = (data.standards && data.standards.length > 0)
    ? `<div class="standards-list">${data.standards.map(s => `<div class="standard-item"><div class="std-key">${escapeHtml(s.key)}</div><div class="std-strand">${escapeHtml(s.strand || '')}</div><div class="std-note">${escapeHtml(s.note || '')}</div></div>`).join('')}</div>`
    : '<p style="color:var(--text-muted);font-size:13px;">暂无中国课标对齐。</p>';
  // 依赖链接改成 href,可中键打开
  const depLink = (id) => `#/${id}?dim=${route.dim}`;
  const strengthTag = (dependency) =>
    `<span class="dep-strength ${dependency.strength}">${dependency.strength === 'hard' ? '必须先学' : '建议先学'}</span>`;
  const renderPrereq = (d) => {
    const pt = d.prerequisiteTopic; const hidden = pt && pt.dimensionVisible === false;
    const cls = ['dep-link', hidden ? 'dim-hidden' : ''].filter(Boolean).join(' ');
    return `<a class="${cls}" href="${depLink(d.prerequisiteId)}"><span class="dep-name">${pt ? escapeHtml(pt.name) : d.prerequisiteId}</span>${hidden ? '<span class="dim-hidden-tag">美版</span>' : ''}${strengthTag(d)}</a>${d.reason ? `<div class="dep-reason">${escapeHtml(d.reason)}</div>` : ''}`;
  };
  const renderDependent = (d) => {
    const dt = d.dependentTopic; const hidden = dt && dt.dimensionVisible === false;
    const cls = ['dep-link', hidden ? 'dim-hidden' : ''].filter(Boolean).join(' ');
    return `<a class="${cls}" href="${depLink(d.topicId)}"><span class="dep-name">${dt ? escapeHtml(dt.name) : d.topicId}</span>${hidden ? '<span class="dim-hidden-tag">美版</span>' : ''}${strengthTag(d)}</a>`;
  };
  const prereqs = data.prerequisites || [];
  const dependents = data.dependents || [];
  const emptyPrereq = '<p class="dep-empty">暂无已审核关联</p>';
  const emptyDependents = '<p class="dep-empty">暂无已审核关联</p>';
  const prereqHtml = prereqs.length > 0 ? prereqs.map(renderPrereq).join('') : emptyPrereq;
  const dependentsHtml = dependents.length > 0 ? dependents.map(renderDependent).join('') : emptyDependents;
  const masteryAction = currentMasteredIds().has(t.id)
    ? '<button class="mastery-action mastered" id="detail-mastery-action">↩︎ 取消掌握标记</button>'
    : '<button class="mastery-action" id="detail-mastery-action">✓ 标记为已掌握</button>';
  const assessmentSection = t.assessmentPrompt
    ? `<div class="detail-section"><h3>🎯 评估话术</h3><div class="assessment-box">${assessment}</div>${renderAssessmentForm(t.id)}</div>`
    : '';
  body.innerHTML = `<div class="detail-title-row"><h2>${escapeHtml(t.name)}</h2>${masteryAction}</div><div class="detail-id">${t.id}</div><div class="detail-section"><h3>📖 描述</h3><div class="detail-desc">${escapeHtml(t.description || '(无描述)')}</div></div>${t.evidence && t.evidence.length > 0 ? `<div class="detail-section"><h3>✓ 掌握证据</h3><ul class="evidence-list">${t.evidence.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>` : ''}${assessmentSection}<div class="detail-section"><h3>📋 中国课标对齐</h3>${standardsHtml}</div><div class="detail-section"><h3>🔗 已审核知识依赖</h3><div class="dep-section"><div class="dep-box"><h4>前置(学这个之前要先掌握)</h4>${prereqHtml}</div><div class="dep-box"><h4>后续(掌握后可继续学习)</h4>${dependentsHtml}</div></div></div>`;
  document.getElementById('detail-mastery-action').addEventListener('click', toggleCurrentTopicMastery);
  bindAssessment(body);
}

function bindAssessment(root) {
  const form = root.querySelector('.assessment-form');
  if (!form) return;
  const answer = form.querySelector('.assessment-answer');
  const submit = form.querySelector('.assessment-submit');
  const result = form.querySelector('.assessment-result');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const text = answer.value.trim();
    if (!text) { answer.focus(); return; }
    submit.disabled = true; submit.textContent = '评分中…';
    result.className = 'assessment-result pending'; result.textContent = 'AI 正在评分，请稍候…';
    try {
      const response = await fetch('/api/assessment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId: form.dataset.topicId, answer: text }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
      result.className = 'assessment-result success';
      result.innerHTML = renderAssessmentResult(data);
    } catch (error) {
      result.className = 'assessment-result error'; result.textContent = error.message || '评分失败，请稍后重试';
    } finally {
      submit.disabled = false; submit.textContent = '提交 AI 评分';
    }
  });
}


// === 路由快照渲染 ===
async function render() {
  // 同步维度按钮高亮
  document.querySelectorAll('.dimension-btn').forEach(b => b.classList.toggle('active', b.dataset.dimension === route.dim));
  // 同步年龄筛选按钮
  syncFilterButtons();

  if (route.view === 'textbook-gaps') {
    document.getElementById('bulk-mastery-toggle').hidden = true;
    document.getElementById('bulk-mastery-apply').hidden = true;
    showView('textbook-gaps');
    await loadTextbookGaps();
    return;
  }

  // 概览页:无 subject/domain/q 时视为概览(列表态全空 = 概览)
  const isOverview = !route.id && !route.subject && !route.domain && !route.q && !route.ageRange;

  if (route.id) {
    document.getElementById('bulk-mastery-toggle').hidden = true;
    document.getElementById('bulk-mastery-apply').hidden = true;
    showView('graph-detail');
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
    document.getElementById('bulk-mastery-toggle').hidden = true;
    document.getElementById('bulk-mastery-apply').hidden = true;
    showView('graph-overview');
  } else {
    showView('graph-list');
    await loadTopicList();
  }
}

function showView(id) {
  document.querySelectorAll('#graph-pane .view').forEach(v => v.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// === 搜索框 ===
let searchTimer;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(() => {
    // 清空搜索框 → 回到概览(或保留当前学科?这里回到概览)
    navigateRoute({ id: null, q: q || null, subject: null, domain: null });
  }, 300);
});

// === 课本对比搜索框 ===
let gapSearchTimer;
document.getElementById('gap-search').addEventListener('input', (e) => {
  clearTimeout(gapSearchTimer);
  const q = e.target.value.trim();
  gapSearchTimer = setTimeout(() => {
    navigateRoute({ view: 'textbook-gaps', q: q || null });
  }, 300);
});

// 搜索框随路由同步:进入列表态且无 q 时清空
function syncSearchBox() {
  const inp = document.getElementById('search');
  if (route.q) { if (inp.value !== route.q) inp.value = route.q; }
  else if (inp.value) inp.value = '';
}

ageFilter.addEventListener('change', () => {
  navigateRoute({ id: null, ageRange: ageRangeForAge(ageFilter.value) });
});

document.getElementById('bulk-mastery-toggle').addEventListener('click', () => {
  bulkMasteryMode = !bulkMasteryMode;
  bulkMasterySelection.clear();
  loadTopicList();
});
document.getElementById('bulk-mastery-apply').addEventListener('click', () => {
  saveMasteredIds(addMastery(currentMasteredIds(), bulkMasterySelection));
  bulkMasterySelection.clear();
  bulkMasteryMode = false;
  loadTopicList();
});
// === 返回按钮 ===
document.getElementById('detail-back').addEventListener('click', () => {
  // 详情返回:恢复之前的列表/概览(去掉 id)
  navigateRoute({ id: null });
});

function goOverview() { navigateRoute({ id: null, subject: null, domain: null, q: null, ageRange: route.ageRange }); }
document.getElementById('list-back').addEventListener('click', goOverview);
document.getElementById('gap-back').addEventListener('click', goOverview);

// === 工具 ===
window.addEventListener('masterychanged', () => { if (!route.id && !route.subject && !route.domain && !route.q) loadSummary(); });

function escapeHtml(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

// === View lifecycle (called by the single workspace shell) ===
let graphReady = false;
export async function renderGraph(nextRoute, navigate = navigateRoute) {
  navigateRoute = navigate;
  route = { ...route, ...nextRoute, tab: 'graph', dim: nextRoute.dim || dimensionsData?.defaultDimension || 'us' };
  if (!graphReady) {
    await loadDimensions();
    graphReady = true;
  }
  await render();
  syncSearchBox();
}

window.addEventListener('workspace-route', (event) => {
  if (event.detail?.route?.tab === 'graph') renderGraph(event.detail.route, event.detail.navigate).catch(error => {
    console.error('图谱渲染失败:', error);
    document.getElementById('stats').textContent = `加载失败: ${error.message}`;
  });
});
