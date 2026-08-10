import { buildRoute } from './path-route.js';
import { renderAssessmentForm, renderAssessmentResult } from './graph-assessment-ui.js';

const escapeHtml = value => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const staticSite = Boolean(globalThis.window?.BST_STATIC_CONFIG?.static);

export function buildInspectorRoute(id, current) {
  return buildRoute({ id }, current);
}

export function renderTopicInspector(data, { mastered = false, learnerName = '孩子' } = {}) {
  const topic = data.topic || {};
  const prompt = escapeHtml(topic.assessmentPrompt || '').replace(/\{\{name\}\}/g, `<span class="inspector-placeholder">${escapeHtml(learnerName)}</span>`);
  const relation = (item, direction) => {
    const id = direction === 'pre' ? item.prerequisiteId : item.topicId;
    const related = direction === 'pre' ? item.prerequisiteTopic : item.dependentTopic;
    return `<button type="button" class="inspector-topic-link" data-inspector-topic="${escapeHtml(id)}"><span>${escapeHtml(related?.name || id)}</span>${item.reason ? `<small>${escapeHtml(item.reason)}</small>` : ''}</button>`;
  };
  const prereqs = data.prerequisites || [];
  const dependents = data.dependents || [];
  return `<header class="inspector-header"><div><p class="inspector-eyebrow">主题详情</p><h2 id="topic-inspector-title">${escapeHtml(topic.name || topic.id)}</h2><div class="inspector-tags"><span>${escapeHtml(topic.subjectZh || topic.subject || '')}</span>${topic.domainZh ? `<span>${escapeHtml(topic.domainZh)}</span>` : ''}${topic.ageRangeStart != null ? `<span>${topic.ageRangeStart}${topic.ageRangeEnd != null && topic.ageRangeEnd !== topic.ageRangeStart ? `–${topic.ageRangeEnd}` : ''} 岁</span>` : ''}</div></div><button type="button" class="inspector-close" data-inspector-close aria-label="关闭主题详情">×</button></header>
    <button type="button" class="mastery-action ${mastered ? 'mastered' : ''}" data-inspector-mastery>${mastered ? '↩︎ 取消掌握标记' : '✓ 标记为已掌握'}</button>
    <section class="inspector-section"><h3>学习说明</h3><p>${escapeHtml(topic.description || '暂无学习说明')}</p></section>
    ${topic.evidence?.length ? `<section class="inspector-section"><h3>掌握证据</h3><ul>${topic.evidence.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>` : ''}
    ${topic.assessmentPrompt ? `<section class="inspector-section"><h3>评估话术</h3><div class="inspector-prompt">${prompt}</div>${staticSite ? '' : renderAssessmentForm(topic.id)}</section>` : ''}
    ${data.standards?.length ? `<section class="inspector-section"><h3>中国课标对齐</h3><ul class="inspector-standards">${data.standards.map(item => `<li><strong>${escapeHtml(item.key)}</strong>${item.strand ? ` · ${escapeHtml(item.strand)}` : ''}${item.note ? `<small>${escapeHtml(item.note)}</small>` : ''}</li>`).join('')}</ul></section>` : ''}
    <section class="inspector-section inspector-relations"><h3>前置知识</h3>${prereqs.length ? prereqs.map(item => relation(item, 'pre')).join('') : '<p class="inspector-empty">暂无已审核关联</p>'}<h3>后续知识</h3>${dependents.length ? dependents.map(item => relation(item, 'post')).join('') : '<p class="inspector-empty">暂无已审核关联</p>'}</section>`;
}

export function createTopicInspector({ root, getRoute, navigate, isMastered, toggleMastery, learnerName, fetchImpl = fetch }) {
  let renderToken = 0;
  const close = () => navigate({ id: null });
  const bind = (topicId) => {
    root.querySelector('[data-inspector-close]')?.addEventListener('click', close);
    root.querySelector('[data-inspector-mastery]')?.addEventListener('click', () => { toggleMastery(topicId); update(getRoute()); });
    root.querySelectorAll('[data-inspector-topic]').forEach(button => button.addEventListener('click', () => navigate({ id: button.dataset.inspectorTopic })));
    const form = root.querySelector('.assessment-form');
    if (!form) return;
    const answer = form.querySelector('.assessment-answer');
    const submit = form.querySelector('.assessment-submit');
    const result = form.querySelector('.assessment-result');
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const text = answer.value.trim();
      if (!text) { answer.focus(); return; }
      submit.disabled = true; submit.textContent = '评分中…';
      result.className = 'assessment-result pending'; result.textContent = 'AI 正在评分，请稍候…';
      try {
        const response = await fetchImpl('/api/assessment', { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ topicId, answer: text }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        result.className = 'assessment-result success'; result.innerHTML = renderAssessmentResult(data);
      } catch (error) {
        result.className = 'assessment-result error'; result.textContent = error.message || '评分失败，请稍后重试';
      } finally { submit.disabled = false; submit.textContent = '提交 AI 评分'; }
    });
  };
  const update = async route => {
    const token = ++renderToken;
    if (!route.id || route.view === 'textbook-gaps') { root.hidden = true; root.innerHTML = ''; document.body.classList.remove('inspector-open'); return; }
    root.hidden = false; document.body.classList.add('inspector-open'); root.innerHTML = '<p class="inspector-loading">加载主题详情…</p>';
    try {
      const url = new URL(`/api/topic/${encodeURIComponent(route.id)}`, location.href);
      if (route.dim) url.searchParams.set('dimension', route.dim);
      const response = await fetchImpl(url.toString());
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (token !== renderToken) return;
      root.innerHTML = renderTopicInspector(data, { mastered: isMastered(route.id), learnerName: learnerName() });
      bind(route.id);
    } catch (error) { if (token === renderToken) root.innerHTML = `<header class="inspector-header"><h2>主题详情</h2><button type="button" class="inspector-close" data-inspector-close>×</button></header><p class="inspector-error">加载失败：${escapeHtml(error.message)}</p>`; bind(route.id); }
  };
  return { update, close };
}
