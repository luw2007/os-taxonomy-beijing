/* === 3D 知识图谱前端 === */
'use strict';

// --- 学科配色 ---
const SUBJECT_COLORS = {
  'Mathematics': '#4e79a7',
  'Science': '#59a14f',
  'English': '#f28e2b',
  'History': '#e15759',
  'Computing': '#76b7b2',
  'Personal & Social Development': '#af7aa1',
  'Life Skills': '#edc949',
  'Learning to Learn': '#ff9da7',
};

// --- 状态 ---
let graphData = null;
let graph = null;
let graphNodes = [];
let graphLinks = [];
let nodeById = new Map();
let hiddenSubjects = new Set();
let highlightedNodes = null; // null = 无高亮; Set = 高亮集合

// --- API ---
async function fetchGraph() {
  const res = await fetch('/api/graph');
  return res.json();
}

async function fetchTopicDetail(id) {
  const res = await fetch(`/api/topic/${encodeURIComponent(id)}`);
  return res.json();
}

// --- 初始化 ---
async function init() {
  graphData = await fetchGraph();
  graphNodes = graphData.nodes;
  graphLinks = graphData.links;
  for (const n of graphNodes) nodeById.set(n.id, n);

  buildSubjectFilters();
  buildLegend();

  graph = ForceGraph3D()(document.getElementById('graph'))
    .graphData({ nodes: [...graphNodes], links: [...graphLinks] })
    .nodeLabel(null) // 用自定义 tooltip
    .nodeColor(node => {
      if (highlightedNodes) {
        return highlightedNodes.has(node.id) ? SUBJECT_COLORS[node.subject] : '#1a1f27';
      }
      return hiddenSubjects.has(node.subject) ? '#1a1f27' : SUBJECT_COLORS[node.subject] || '#888';
    })
    .nodeOpacity(0.9)
    .nodeVal(node => node.val)
    .nodeResolution(8)
    .linkColor(link => {
      if (highlightedNodes) {
        return (highlightedNodes.has(link.source.id) && highlightedNodes.has(link.target.id))
          ? 'rgba(88,166,255,0.6)' : 'rgba(48,54,61,0.15)';
      }
      return 'rgba(48,54,61,0.25)';
    })
    .linkWidth(link => {
      if (!highlightedNodes) return 0;
      return (highlightedNodes.has(link.source.id) && highlightedNodes.has(link.target.id)) ? 1.5 : 0;
    })
    .linkDirectionalArrowLength(3)
    .linkDirectionalArrowRelPos(1)
    .linkDirectionalParticles(0)
    .backgroundColor('#0d1117')
    .showNavInfo(false)
    .warmupTicks(80)
    .cooldownTicks(100)
    .onNodeHover(node => {
      if (node) {
        showTooltip(node);
        document.body.style.cursor = 'pointer';
      } else {
        hideTooltip();
        document.body.style.cursor = 'default';
      }
    })
    .onNodeClick(node => {
      focusNode(node);
    })
    .d3Force('charge').strength(-30);

  // 隐藏加载遮罩
  setTimeout(() => {
    document.getElementById('loading-overlay').classList.add('hidden');
  }, 500);
}

// --- Tooltip ---
function showTooltip(node) {
  const tip = document.getElementById('tooltip');
  const color = SUBJECT_COLORS[node.subject] || '#888';
  tip.innerHTML = `
    <div class="tt-name">${escapeHtml(node.name)}</div>
    <div class="tt-meta">
      <span class="tt-dot" style="background:${color}"></span>
      <span>${escapeHtml(node.subjectZh || node.subject)}</span>
      <span>·</span>
      <span>${escapeHtml(node.domainZh || node.domain)}</span>
      <span>·</span>
      <span>${node.age}-${node.ageEnd} 岁</span>
    </div>
  `;
  tip.classList.remove('hidden');
  // 跟随鼠标（事件由 3d-force-graph 的 hoverCoordinates 提供）
}

function hideTooltip() {
  document.getElementById('tooltip').classList.add('hidden');
}

// 鼠标移动时更新 tooltip 位置
document.addEventListener('mousemove', (e) => {
  const tip = document.getElementById('tooltip');
  if (!tip.classList.contains('hidden')) {
    let x = e.clientX + 14;
    let y = e.clientY + 14;
    if (x + 280 > window.innerWidth) x = e.clientX - 294;
    if (y + 80 > window.innerHeight) y = e.clientY - 90;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
});

// --- 聚焦节点 + 显示详情 ---
function focusNode(node) {
  // 高亮该节点的依赖路径
  highlightPath(node.id);
  // 显示详情面板
  showDetail(node.id);
  // 相机聚焦
  const distance = 120;
  const destPos = node;
  graph.cameraPosition(
    { x: destPos.x, y: destPos.y, z: destPos.z + distance },
    { x: destPos.x, y: destPos.y, z: destPos.z },
    1000
  );
}

// --- 高亮依赖路径 ---
function highlightPath(nodeId) {
  const highlight = new Set([nodeId]);

  // 前置依赖（递归一层）
  for (const link of graphLinks) {
    if (link.target.id === nodeId || link.target === nodeId) {
      highlight.add(link.source.id || link.source);
    }
  }
  // 后续依赖
  for (const link of graphLinks) {
    if (link.source.id === nodeId || link.source === nodeId) {
      highlight.add(link.target.id || link.target);
    }
  }

  highlightedNodes = highlight;
  updateGraphColors();
}

function clearHighlight() {
  highlightedNodes = null;
  updateGraphColors();
}

function updateGraphColors() {
  graph.nodeColor(graph.nodeColor());
  graph.linkColor(graph.linkColor());
  graph.linkWidth(graph.linkWidth());
}

// --- 详情面板 ---
async function showDetail(id) {
  const panel = document.getElementById('detail-panel');
  const body = document.getElementById('detail-body');
  panel.classList.remove('hidden');
  body.innerHTML = '<p style="color:var(--text-muted);padding:20px;">加载中…</p>';

  const data = await fetchTopicDetail(id);
  const t = data.topic;
  const color = SUBJECT_COLORS[t.subject] || '#888';

  // 评估话术：{{name}} → 孩子
  const assessment = escapeHtml(t.assessmentPrompt || '(无)')
    .replace(/\{\{name\}\}/g, '<span class="child-name">孩子</span>');

  // 课标
  const standardsHtml = (data.standards && data.standards.length > 0)
    ? data.standards.map(s => `
        <div style="padding:10px 14px;background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;">
          <div style="font-family:monospace;font-size:11px;color:var(--accent);font-weight:600;">${escapeHtml(s.key)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin:2px 0;">${escapeHtml(s.strand || '')}</div>
          <div style="font-size:13px;">${escapeHtml(s.note || '')}</div>
        </div>
      `).join('')
    : '<div class="dep-empty">暂无课标对齐</div>';

  body.innerHTML = `
    <h2>${escapeHtml(t.name)}</h2>
    <div class="detail-id">${t.id}</div>
    <div class="detail-tags">
      <span class="tag" style="border-color:${color}40;color:${color};">${escapeHtml(t.subjectZh || t.subject)}</span>
      <span class="tag">${escapeHtml(t.domainZh || t.domain)}</span>
      ${t.ageRangeStart != null ? `<span class="tag">${t.ageRangeStart}-${t.ageRangeEnd} 岁</span>` : ''}
    </div>

    <div class="detail-section">
      <h3>📖 描述</h3>
      <div class="detail-desc">${escapeHtml(t.description || '(无描述)')}</div>
    </div>

    ${t.evidence && t.evidence.length > 0 ? `
    <div class="detail-section">
      <h3>✓ 掌握证据</h3>
      <ul class="evidence-list">
        ${t.evidence.map(e => `<li>${escapeHtml(e)}</li>`).join('')}
      </ul>
    </div>
    ` : ''}

    <div class="detail-section">
      <h3>🎯 评估话术</h3>
      <div class="assessment-box">${assessment}</div>
    </div>

    <div class="detail-section">
      <h3>🔗 前置知识（学这个之前要先掌握）</h3>
      ${renderDeps(data.prerequisites, 'prerequisite')}
    </div>

    <div class="detail-section">
      <h3>🚀 后续知识（学了这个才能学的）</h3>
      ${renderDeps(data.dependents, 'dependent')}
    </div>

    <div class="detail-section">
      <h3>📋 课标对齐</h3>
      ${standardsHtml}
    </div>
  `;
}

function renderDeps(deps, type) {
  if (!deps || deps.length === 0) {
    return '<div class="dep-empty">无</div>';
  }
  return deps.map(d => {
    const topic = type === 'prerequisite' ? d.prerequisiteTopic : d.dependentTopic;
    const targetId = type === 'prerequisite' ? d.prerequisiteId : d.topicId;
    if (!topic) return '';
    const color = SUBJECT_COLORS[topic.subject] || '#888';
    return `
      <div class="dep-link" onclick="focusNodeById('${targetId}')">
        <span class="dep-dot" style="background:${color}"></span>
        <span class="dep-name">${escapeHtml(topic.name)}</span>
        <span class="dep-strength ${d.strength}">${d.strength === 'hard' ? '必须' : '建议'}</span>
      </div>
      ${d.reason ? `<div class="dep-reason">${escapeHtml(d.reason)}</div>` : ''}
    `;
  }).join('');
}

function focusNodeById(id) {
  const node = nodeById.get(id);
  if (node) {
    // 需要从 Three.js 场景中找到实际节点对象
    const graphNode = graph.graphData().nodes.find(n => n.id === id);
    if (graphNode) focusNode(graphNode);
  }
}

function closeDetail() {
  document.getElementById('detail-panel').classList.add('hidden');
  clearHighlight();
}

// --- 学科筛选 ---
function buildSubjectFilters() {
  const container = document.getElementById('subject-filters');
  const subjects = Object.keys(SUBJECT_COLORS);
  // 用 subjects 映射的中文名
  const subjectZhMap = {};
  for (const n of graphNodes) {
    if (!subjectZhMap[n.subject]) subjectZhMap[n.subject] = n.subjectZh || n.subject;
  }

  container.innerHTML = subjects.map(s => {
    const zh = subjectZhMap[s] || s;
    return `
      <div class="subject-toggle" data-subject="${s}" onclick="toggleSubject('${s}')">
        <span class="dot" style="background:${SUBJECT_COLORS[s]}"></span>
        <span>${zh}</span>
      </div>
    `;
  }).join('');
}

function toggleSubject(subject) {
  const el = document.querySelector(`.subject-toggle[data-subject="${subject}"]`);
  if (hiddenSubjects.has(subject)) {
    hiddenSubjects.delete(subject);
    el.classList.remove('off');
  } else {
    hiddenSubjects.add(subject);
    el.classList.add('off');
  }
  updateGraphColors();
}

// --- 图例 ---
function buildLegend() {
  const legend = document.getElementById('legend');
  const subjects = Object.keys(SUBJECT_COLORS);
  const subjectZhMap = {};
  for (const n of graphNodes) {
    if (!subjectZhMap[n.subject]) subjectZhMap[n.subject] = n.subjectZh || n.subject;
  }

  legend.innerHTML = `
    <div class="legend-title">学科</div>
    <div class="legend-items">
      ${subjects.map(s => `
        <div class="legend-item">
          <span class="dot" style="background:${SUBJECT_COLORS[s]}"></span>
          <span>${subjectZhMap[s] || s}</span>
        </div>
      `).join('')}
    </div>
  `;
}

// --- 搜索 ---
let searchTimer;
document.getElementById('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim().toLowerCase();
  if (!q) {
    clearHighlight();
    return;
  }
  searchTimer = setTimeout(() => {
    // 找到匹配的节点
    const matches = graphNodes.filter(n =>
      n.name.toLowerCase().includes(q) ||
      (n.domainZh && n.domainZh.toLowerCase().includes(q)) ||
      n.id.toLowerCase().includes(q)
    );
    if (matches.length > 0) {
      highlightedNodes = new Set(matches.map(n => n.id));
      updateGraphColors();
      // 聚焦第一个匹配
      const first = graph.graphData().nodes.find(n => n.id === matches[0].id);
      if (first) {
        graph.cameraPosition(
          { x: first.x, y: first.y, z: first.z + 200 },
          { x: first.x, y: first.y, z: first.z },
          800
        );
      }
    }
  }, 300);
});

// --- 工具 ---
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// 点击空白处取消高亮
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeDetail();
    document.getElementById('search').value = '';
    clearHighlight();
  }
});

// 启动
init().catch(err => {
  console.error('初始化失败:', err);
  document.getElementById('loading-overlay').innerHTML = `<p style="color:#f85149;">加载失败: ${escapeHtml(err.message)}</p>`;
});
