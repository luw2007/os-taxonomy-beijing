import { findNextUnmastered } from './path-navigation.js';
import { buildPathSequence, classifyPathGesture, applyKnowledgeDecision } from './mobile-path-state.js';

'use strict';

// ============================================================
// 知识脉络页(实验功能): 双 tab 壳层 + AI 标记 + ego 三栏
// 数据: GET /api/path-data(全量紧凑 nodes/edges/presets)
// 所有用户数据(档案/掌握集/画像)只存 localStorage。
// ============================================================

async function boot() {
const pathResponse = await fetch('/api/path-data');
if (!pathResponse.ok) throw new Error(`知识数据加载失败（HTTP ${pathResponse.status}）`);
const XDATA = await pathResponse.json();
const { subjects: SUBJ, nodes: NODES, edges: EDGES, presets: PRESETS } = XDATA;

// --- 邻接索引 ---
const inbound = new Map(), outbound = new Map();
for (const e of EDGES) {
  if (!inbound.has(e.t)) inbound.set(e.t, []);
  inbound.get(e.t).push(e);
  if (!outbound.has(e.f)) outbound.set(e.f, []);
  outbound.get(e.f).push(e);
}
const N = (id) => { const n = NODES[id]; return n ? { name: n[0], subject: n[1], age: n[2] } : null; };
const sz = (s) => SUBJ[s] || s;
const esc = (s) => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const NAV_NODES = Object.fromEntries(Object.entries(NODES).map(([id, node]) => [id, { name: node[0], age: node[2] }]));

// --- toast ---
let toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// === 本地状态(全部 localStorage) ===
// 多用户档案: kg-demo-users = { list: [{id,name}], activeId }
// 每个用户独立命名空间: kg-demo-u-<id>-mastered / kg-demo-u-<id>-profile
// 协议同意是浏览器级(整机一次即可),不随档案。
const AKEY = 'kg-demo-agreed', UKEY = 'kg-demo-users';
const LEGACY_KEYS = ['kg-demo-mastered', 'kg-demo-role', 'kg-demo-profile'];
let agreed = localStorage.getItem(AKEY) === '1';

let users = JSON.parse(localStorage.getItem(UKEY) || 'null');
if (!users || !Array.isArray(users.list) || users.list.length === 0) {
  users = { list: [{ id: 'u' + Date.now().toString(36), name: '默认' }], activeId: null };
  users.activeId = users.list[0].id;
  // 老单用户数据迁移到默认档案
  const legacyM = localStorage.getItem('kg-demo-mastered');
  const legacyP = localStorage.getItem('kg-demo-profile');
  if (legacyM) localStorage.setItem(`kg-demo-u-${users.activeId}-mastered`, legacyM);
  if (legacyP) localStorage.setItem(`kg-demo-u-${users.activeId}-profile`, legacyP);
  for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  localStorage.setItem(UKEY, JSON.stringify(users));
}
if (!users.list.some(u => u.id === users.activeId)) users.activeId = users.list[0].id;
const saveUsers = () => localStorage.setItem(UKEY, JSON.stringify(users));
const activeUser = () => users.list.find(u => u.id === users.activeId);
const mKey = () => `kg-demo-u-${users.activeId}-mastered`;
const pKey = () => `kg-demo-u-${users.activeId}-profile`;
const nrKey = () => `kg-demo-u-${users.activeId}-needs-review`;
const userKeys = (id) => [`kg-demo-u-${id}-mastered`, `kg-demo-u-${id}-profile`, `kg-demo-u-${id}-needs-review`];

let mastered, profile, needsReview;
let refreshMobilePath = () => {};
function loadActiveUser() {
  mastered = new Set(JSON.parse(localStorage.getItem(mKey()) || '[]').filter(id => NODES[id]));
  profile = JSON.parse(localStorage.getItem(pKey()) || '{}');
  needsReview = new Set(JSON.parse(localStorage.getItem(nrKey()) || '[]').filter(id => NODES[id]));
  refreshMobilePath();
}
loadActiveUser();
const saveMastered = () => localStorage.setItem(mKey(), JSON.stringify([...mastered]));
const saveProfile = () => localStorage.setItem(pKey(), JSON.stringify(profile));
const saveNeedsReview = () => localStorage.setItem(nrKey(), JSON.stringify([...needsReview]));

const PROFILE_LABEL = { age: '年龄', grade: '年级', region: '地区', gender: '性别', textbook: '教材', interests: '兴趣', other: '备注' };
const fmtProfileVal = (k, v) => k === 'age' ? v + '岁' : Array.isArray(v) ? v.join('、') : String(v);

function renderUserBar() {
  document.getElementById('ub-profile-btn').textContent = '👤 ' + activeUser().name + ' ▾';
  const parts = ['age', 'grade', 'region'].filter(k => profile[k] != null).map(k => fmtProfileVal(k, profile[k]));
  document.getElementById('ub-profile').textContent = parts.join(' · ');
  document.getElementById('mark-input').placeholder =
    `记录「${activeUser().name}」已掌握的知识,如:会两位数乘法和分数初步认识,拼音全部掌握了`;
}

function mergeProfile(mem) {
  if (!mem || !Object.keys(mem).length) return false;
  for (const [k, v] of Object.entries(mem)) {
    if (k === 'interests') profile.interests = [...new Set([...(profile.interests || []), ...v])];
    else profile[k] = v;
  }
  saveProfile(); renderUserBar();
  return true;
}

function notifyMasteryChange() {
  if (graphLoaded) graphFrame.contentWindow.dispatchEvent(new Event('masterychanged'));
}

// 档案切换后的全量刷新
function switchUser(id) {
  if (users.activeId === id) return;
  users.activeId = id; saveUsers();
  loadActiveUser();
  notifyMasteryChange();
  openSubject = null;
  renderUserBar(); renderMasteredBar(); renderNext(); renderPresets();
  if (curId) show(curId, false);
  toast('已切换到「' + activeUser().name + '」');
}

// === 弹层 ===
const openMask = (id) => { document.getElementById(id).hidden = false; };
const closeMask = (id) => { document.getElementById(id).hidden = true; };
document.querySelectorAll('.modal-mask').forEach(m => m.addEventListener('click', (e) => {
  if (e.target === m && m.id !== 'agreement-mask') m.hidden = true;
}));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.modal-mask:not([hidden])').forEach(m => { if (m.id !== 'agreement-mask') m.hidden = true; });
});

// 协议
let pendingAfterAgree = null;
document.getElementById('agree-btn').addEventListener('click', () => {
  agreed = true; localStorage.setItem(AKEY, '1');
  closeMask('agreement-mask');
  if (pendingAfterAgree) { const f = pendingAfterAgree; pendingAfterAgree = null; f(); }
});
document.getElementById('disagree-btn').addEventListener('click', () => {
  closeMask('agreement-mask'); pendingAfterAgree = null;
});
document.getElementById('ub-agreement').addEventListener('click', () => openMask('agreement-mask'));

// 用户档案管理
function renderProfileModal() {
  const list = document.getElementById('profile-list');
  list.innerHTML = users.list.map(u => {
    const m = JSON.parse(localStorage.getItem(`kg-demo-u-${u.id}-mastered`) || '[]').length;
    const p = JSON.parse(localStorage.getItem(`kg-demo-u-${u.id}-profile`) || '{}');
    const meta = [p.age != null ? p.age + '岁' : null, p.grade, `已掌握 ${m} 个`].filter(Boolean).join(' · ');
    return `<div class="profile-row ${u.id === users.activeId ? 'active' : ''}" data-id="${esc(u.id)}">
      <span class="pname">${esc(u.name)}</span><span class="pmeta">${esc(meta)}</span>
      <span class="pspacer"></span>
      ${u.id === users.activeId ? '<span class="pmeta">当前</span>' : ''}
      ${users.list.length > 1 ? `<span class="pdel" data-del="${esc(u.id)}" title="删除档案">🗑</span>` : ''}
    </div>`;
  }).join('');
  list.querySelectorAll('.profile-row').forEach(r => r.addEventListener('click', (e) => {
    if (e.target.dataset.del) return;
    switchUser(r.dataset.id);
    renderProfileModal();
  }));
  list.querySelectorAll('.pdel').forEach(d => d.addEventListener('click', (e) => {
    e.stopPropagation();
    const id = d.dataset.del;
    const u = users.list.find(x => x.id === id);
    if (!confirm(`删除档案「${u.name}」及其全部数据?不可恢复。`)) return;
    for (const k of userKeys(id)) localStorage.removeItem(k);
    users.list = users.list.filter(x => x.id !== id);
    if (users.activeId === id) { users.activeId = users.list[0].id; loadActiveUser(); renderUserBar(); renderMasteredBar(); renderNext(); if (curId) show(curId, false); }
    saveUsers();
    renderProfileModal();
    toast('已删除档案「' + u.name + '」');
  }));
}
document.getElementById('profile-add-btn').addEventListener('click', () => {
  const inp = document.getElementById('profile-new-name');
  const name = inp.value.trim();
  if (!name) { inp.focus(); return; }
  if (users.list.some(u => u.name === name)) { toast('已有同名档案'); return; }
  const u = { id: 'u' + Date.now().toString(36), name };
  users.list.push(u); saveUsers();
  inp.value = '';
  switchUser(u.id);
  renderProfileModal();
});
document.getElementById('profile-new-name').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('profile-add-btn').click();
});
document.getElementById('ub-profile-btn').addEventListener('click', () => { renderProfileModal(); openMask('profile-mask'); });
document.getElementById('profile-close').addEventListener('click', () => closeMask('profile-mask'));

// 本地记忆
function renderMemoryModal() {
  const body = document.getElementById('memory-body');
  const profRows = Object.entries(profile).filter(([, v]) => v != null && !(Array.isArray(v) && !v.length));
  const profHtml = profRows.length
    ? profRows.map(([k, v]) => `<div class="mem-kv"><span class="k">${PROFILE_LABEL[k] || k}</span><span>${esc(fmtProfileVal(k, v))}</span><span class="del" data-k="${k}" title="删除这条">×</span></div>`).join('')
    : `<p class="mem-empty">暂无。在记录时顺带说"8岁在海淀上三年级"之类,AI 会自动记住。</p>`;
  const allKeys = [AKEY, UKEY, ...users.list.flatMap(u => userKeys(u.id))];
  const rawDump = Object.fromEntries(allKeys.map(k => [k, localStorage.getItem(k)]).filter(([, v]) => v != null));
  body.innerHTML = `
    <div class="mem-sec"><h4>👤 当前档案</h4><div class="mem-kv"><span>${esc(activeUser().name)}(共 ${users.list.length} 个档案)</span></div></div>
    <div class="mem-sec"><h4>🧒 「${esc(activeUser().name)}」的画像(AI 从你的描述里提取)</h4>${profHtml}</div>
    <div class="mem-sec"><h4>✅ 「${esc(activeUser().name)}」已掌握知识点</h4><div class="mem-kv"><span>${mastered.size} 个(详见页面绿色学科栏)</span></div></div>
    <div class="mem-sec"><h4>🔍 原始存储(localStorage 全量,含所有档案,即本功能持有的你的全部数据)</h4><div class="mem-raw">${esc(JSON.stringify(rawDump, null, 1))}</div></div>`;
  body.querySelectorAll('.del').forEach(d => d.addEventListener('click', () => {
    if (d.dataset.k === 'interests') profile.interests = [];
    else delete profile[d.dataset.k];
    saveProfile(); renderUserBar(); renderMemoryModal();
  }));
}
document.getElementById('ub-memory').addEventListener('click', () => { renderMemoryModal(); openMask('memory-mask'); });
document.getElementById('memory-close').addEventListener('click', () => closeMask('memory-mask'));

// 数据清理(全部档案)
document.getElementById('ub-wipe').addEventListener('click', () => {
  if (!confirm(`清除本功能在你浏览器里的全部数据?\n(全部 ${users.list.length} 个档案的掌握标记和画像、协议同意状态)`)) return;
  for (const u of users.list) for (const k of userKeys(u.id)) localStorage.removeItem(k);
  localStorage.removeItem(UKEY); localStorage.removeItem(AKEY);
  location.reload();
});

// === AI 标记流 ===
const markBtn = document.getElementById('mark-btn');
const markInput = document.getElementById('mark-input');
const confirmArea = document.getElementById('confirm-area');

markBtn.addEventListener('click', () => {
  if (!agreed) { pendingAfterAgree = doResolve; openMask('agreement-mask'); return; }
  doResolve();
});
markInput.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') markBtn.click();
});

async function doResolve() {
  const text = markInput.value.trim();
  if (!text) { markInput.focus(); return; }
  markBtn.disabled = true; markBtn.textContent = '解析中…';
  confirmArea.hidden = false;
  confirmArea.innerHTML = '<div class="parsing"><div class="spinner"></div>AI 正在拆解你的描述并匹配知识点…(约 10-20 秒)</div>';
  try {
    const resp = await fetch('/api/resolve', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, profile }),
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data.error) throw new Error(data.error);
    const remembered = mergeProfile(data.memory);
    renderConfirm(data.claims, remembered);
  } catch (e) {
    confirmArea.innerHTML = `<p class="cand-none">解析失败: ${esc(e.message)}。稍后重试,或确认 AI 服务已启动。</p>`;
  } finally {
    markBtn.disabled = false; markBtn.textContent = 'AI 解析';
  }
}

function renderConfirm(claims, remembered) {
  const memNote = remembered
    ? `<p class="mem-note">🧠 已记住「${esc(activeUser().name)}」的情况(仅存本地,<a id="mem-note-link">查看</a>)</p>`
    : '';
  if (!claims.length) {
    confirmArea.innerHTML = memNote + '<p class="cand-none">没有识别出知识点声明,换个说法试试。</p>';
    bindMemNote();
    return;
  }
  let html = memNote;
  for (const c of claims) {
    html += `<div class="claim-block"><div class="claim-txt">你说的「<b>${esc(c.claim)}</b>」,是指:</div>`;
    if (!c.candidates.length) {
      html += '<p class="cand-none">图谱里没找到匹配,可能超纲或表述太宽泛。</p>';
    } else {
      for (const [ki, k] of c.candidates.entries()) {
        const on = ki === 0 && k.confidence >= 0.8 && !mastered.has(k.id);
        html += `<span class="cand ${on ? 'on' : ''}" data-id="${esc(k.id)}"><span class="ck">${on ? '✓' : ''}</span>
          <span>${esc(k.name)}</span><span class="s">${esc(k.subjectZh)}${k.age >= 0 ? ' · ' + k.age + '岁' : ''}</span>
          <span class="cf">${Math.round(k.confidence * 100)}%</span></span>`;
        if (k.note) html += `<div class="cand-note">↳ ${esc(k.note)}</div>`;
      }
    }
    html += '</div>';
  }
  html += `<div class="confirm-actions">
    <button class="btn primary" id="confirm-ok">✓ 确认勾选的知识点</button>
    <button class="btn" id="confirm-cancel">取消</button></div>`;
  confirmArea.innerHTML = html;
  bindMemNote();
  confirmArea.querySelectorAll('.cand').forEach(el => el.addEventListener('click', () => {
    el.classList.toggle('on');
    el.querySelector('.ck').textContent = el.classList.contains('on') ? '✓' : '';
  }));
  document.getElementById('confirm-ok').addEventListener('click', () => {
    const picked = [...confirmArea.querySelectorAll('.cand.on')].map(el => el.dataset.id);
    for (const id of picked) { mastered.add(id); needsReview.delete(id); }
    saveMastered(); saveNeedsReview();
    notifyMasteryChange();

    confirmArea.hidden = true; confirmArea.innerHTML = ''; markInput.value = '';
    renderMasteredBar(); renderNext(); renderPresets();
    const nextId = curId && picked.includes(curId)
      ? findNextUnmastered(curId, mastered, NAV_NODES, EDGES)
      : curId;
    if (nextId) show(nextId, false);
    toast(picked.length ? `已标记 ${picked.length} 个知识点为已掌握` : '未勾选任何知识点');
  });
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    confirmArea.hidden = true; confirmArea.innerHTML = '';
  });
}
function bindMemNote() {
  const a = document.getElementById('mem-note-link');
  if (a) a.addEventListener('click', () => { renderMemoryModal(); openMask('memory-mask'); });
}

// === 已掌握: 学科聚合 + 抽屉 ===
let openSubject = null;

function toggleMastered(id) {
  const was = mastered.has(id);
  if (was) mastered.delete(id); else { mastered.add(id); needsReview.delete(id); }
  saveMastered(); saveNeedsReview();
  notifyMasteryChange();
  renderMasteredBar(); renderNext(); renderPresets();
  if (was) {
    if (curId) show(curId, false);
  } else {
    const nextId = findNextUnmastered(id, mastered, NAV_NODES, EDGES);
    show(nextId || id, false);
  }
  toast(was ? '已取消掌握标记' : '已标记为已掌握');
}

function renderMasteredBar() {
  const wrap = document.getElementById('mastered-wrap');
  const el = document.getElementById('mastered-bar');
  if (mastered.size === 0) { wrap.hidden = true; el.innerHTML = ''; openSubject = null; return; }
  wrap.hidden = false;
  const bySubj = new Map();
  for (const id of mastered) {
    const n = N(id); if (!n) continue;
    if (!bySubj.has(n.subject)) bySubj.set(n.subject, []);
    bySubj.get(n.subject).push({ id, ...n });
  }
  if (openSubject && !bySubj.has(openSubject)) openSubject = null;
  const groups = [...bySubj.entries()].sort((a, b) => b[1].length - a[1].length);
  el.innerHTML = `<div class="mb-head"><span class="lbl">✅ 已掌握 ${mastered.size} 个:</span>` +
    groups.map(([s, list]) =>
      `<span class="schip ${openSubject === s ? 'open' : ''}" data-s="${s}">${sz(s)} <span class="cnt">${list.length}</span> <span class="caret">${openSubject === s ? '▲' : '▼'}</span></span>`
    ).join('') +
    `<span class="mb-clear" id="mb-clear">全部清除</span></div>` +
    `<div class="mb-drawer" id="mb-drawer" ${openSubject ? '' : 'hidden'}></div>`;
  el.querySelectorAll('.schip').forEach(c => c.addEventListener('click', () => {
    openSubject = openSubject === c.dataset.s ? null : c.dataset.s;
    renderMasteredBar();
  }));
  document.getElementById('mb-clear').addEventListener('click', () => {
    if (!confirm(`清除全部 ${mastered.size} 个已掌握标记?`)) return;
    mastered.clear(); saveMastered(); notifyMasteryChange();
    renderMasteredBar(); renderNext(); renderPresets();
    if (curId) show(curId, false);
    toast('已清除全部掌握标记');
  });
  if (openSubject) {
    const drawer = document.getElementById('mb-drawer');
    const list = bySubj.get(openSubject).sort((a, b) => a.age - b.age);
    const byAge = new Map();
    for (const it of list) {
      const k = it.age >= 0 ? `${it.age}岁` : '年龄不详';
      if (!byAge.has(k)) byAge.set(k, []);
      byAge.get(k).push(it);
    }
    drawer.innerHTML = [...byAge.entries()].map(([ageLbl, items]) =>
      `<div class="mb-age-grp"><div class="mb-age-lbl">${ageLbl}</div>` +
      items.map(it => `<span class="mchip" data-id="${esc(it.id)}"><span>${esc(it.name)}</span><span class="rm" title="取消标记">×</span></span>`).join('') +
      `</div>`
    ).join('');
    drawer.querySelectorAll('.mchip').forEach(c => {
      c.querySelector('.rm').addEventListener('click', (ev) => { ev.stopPropagation(); toggleMastered(c.dataset.id); });
      c.addEventListener('click', () => show(c.dataset.id));
    });
  }
}

// === 推荐(可收起,展开时最多 3 行) ===
const NEXT_OPEN_KEY = 'kg-demo-next-open';
let nextOpen = localStorage.getItem(NEXT_OPEN_KEY) !== '0';

// 按实际布局行号截断: 第 4 行起隐藏(卡片高度可变,用 offsetTop 数行最稳)
function clampNextRows() {
  const grid = document.getElementById('next-grid');
  if (grid.hidden) return;
  const cards = [...grid.querySelectorAll('.tcard')];
  const rowTops = [];
  for (const c of cards) {
    c.classList.remove('row-clamped');
    if (!rowTops.includes(c.offsetTop)) rowTops.push(c.offsetTop);
    if (rowTops.length > 3) c.classList.add('row-clamped');
  }
}

function renderNextToggle() {
  const t = document.getElementById('next-toggle');
  t.textContent = nextOpen ? '收起 ▲' : '展开 ▼';
  document.getElementById('next-grid').hidden = !nextOpen;
  if (nextOpen) clampNextRows();
}
document.getElementById('next-toggle').addEventListener('click', () => {
  nextOpen = !nextOpen; localStorage.setItem(NEXT_OPEN_KEY, nextOpen ? '1' : '0');
  renderNextToggle();
});
window.addEventListener('resize', () => { clearTimeout(window.__nextClampT); window.__nextClampT = setTimeout(clampNextRows, 150); });

function renderNext() {
  const panel = document.getElementById('next-panel');
  if (mastered.size === 0) { panel.hidden = true; return; }
  const scores = new Map();
  for (const mid of mastered) {
    for (const e of (outbound.get(mid) || [])) {
      if (mastered.has(e.t)) continue;
      let s = scores.get(e.t);
      if (!s) {
        const pres = inbound.get(e.t) || [];
        s = { hit: 0, total: Math.max(pres.length, 1), viaX: false };
        scores.set(e.t, s);
      }
      s.hit++;
      if (e.x) s.viaX = true;
    }
  }
  const ranked = [...scores.entries()]
    .map(([id, s]) => ({ id, ratio: s.hit / s.total, viaX: s.viaX, n: N(id) }))
    .filter(r => r.n)
    .sort((a, b) => b.ratio - a.ratio || a.n.age - b.n.age)
    .slice(0, 12);
  panel.hidden = ranked.length === 0;
  document.getElementById('next-n').textContent = `(基于已掌握的 ${mastered.size} 个知识点推算)`;
  document.getElementById('next-grid').innerHTML = ranked.map(r => `
    <div class="tcard ${r.viaX ? 'xcard' : ''}" data-id="${esc(r.id)}">
      <div class="top">${r.viaX ? `<span class="tag x">跨学科</span>` : ''}<span class="nm">${esc(r.n.name)}</span>
        <span class="tag">${sz(r.n.subject)}</span>${r.n.age >= 0 ? `<span class="tag">${r.n.age}岁</span>` : ''}</div>
      <div class="rsn">前置就绪 ${Math.round(r.ratio * 100)}%</div>
    </div>`).join('');
  document.getElementById('next-grid').querySelectorAll('.tcard').forEach(c =>
    c.addEventListener('click', () => { show(c.dataset.id); document.getElementById('trail').scrollIntoView({ behavior: 'smooth', block: 'center' }); }));
  renderNextToggle();
}

// === ego 三栏 ===
let trail = [];
let curId = null;

function card(otherId, e, isX) {
  const n = N(otherId); if (!n) return '';
  const isM = mastered.has(otherId);
  const ageTag = n.age >= 0 ? `<span class="tag">${n.age}岁</span>` : '';
  const subjTag = isX ? `<span class="tag x">${sz(n.subject)}</span>` : '';
  const machineTag = e.m ? `<span class="tag machine">AI 推测</span>` : '';
  const mTag = isM ? `<span class="tag ok">已掌握</span>` : '';
  return `<div class="tcard ${isX ? 'xcard' : ''} ${isM ? 'mastered' : ''}" data-id="${esc(otherId)}">
    <div class="top">${subjTag}<span class="nm">${esc(n.name)}</span>${ageTag}${mTag}${machineTag}</div>
    ${e.r ? `<div class="rsn">${esc(e.r)}</div>` : ''}
  </div>`;
}

function column(edges, myId, dir) {
  const me = N(myId);
  const items = edges.map(e => {
    const other = dir === 'pre' ? e.f : e.t;
    const n = N(other);
    return n ? { e, other, isX: n.subject !== me.subject, age: n.age } : null;
  }).filter(Boolean).sort((a, b) => a.age - b.age);
  const xs = items.filter(i => i.isX), same = items.filter(i => !i.isX);
  let html = '';
  if (xs.length) html += `<div class="grp"><div class="grp-title xg">🔀 跨学科 (${xs.length})</div>${xs.map(i => card(i.other, i.e, true)).join('')}</div>`;
  if (same.length) html += `<div class="grp"><div class="grp-title">${sz(me.subject)}脉络 (${same.length})</div>${same.map(i => card(i.other, i.e, false)).join('')}</div>`;
  return { html: html || `<p class="empty">${dir === 'pre' ? '无——这是起点知识' : '暂无后续记录'}</p>`, count: items.length, xCount: xs.length };
}

// 中央卡完整详情: 描述 + 掌握证据 + 评估话术 + 课标对齐(数据来自 /api/topic/:id)
function renderMeDetail(d) {
  const t = d.topic || {};
  let html = '';
  if (t.description) html += `<div class="me-sec"><div class="me-desc">${esc(t.description)}</div></div>`;
  if (t.evidence && t.evidence.length) {
    html += `<div class="me-sec"><h4>✓ 掌握证据</h4><ul class="me-evi">${t.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul></div>`;
  }
  if (t.assessmentPrompt) {
    const a = esc(t.assessmentPrompt).replace(/\{\{name\}\}/g, `<span class="me-ph">${esc(activeUser().name)}</span>`);
    html += `<div class="me-sec"><h4>🎯 评估话术</h4><div class="me-assess">${a}</div></div>`;
  }
  if (d.standards && d.standards.length) {
    html += `<div class="me-sec"><h4>📋 中国课标对齐</h4>${d.standards.map(s =>
      `<div class="me-std"><span class="me-std-k">${esc(s.key)}</span>${s.strand ? `<span class="me-std-s">${esc(s.strand)}</span>` : ''}${s.note ? `<span class="me-std-n">${esc(s.note)}</span>` : ''}</div>`).join('')}</div>`;
  }
  return html || '<p class="me-empty">(暂无详情)</p>';
}

function show(id, pushTrail = true) {
  const me = N(id); if (!me) return;
  curId = id;
  if (pushTrail) {
    trail = trail.filter(t => t !== id); trail.push(id);
    if (trail.length > 8) trail.shift();
  }
  const pre = column(inbound.get(id) || [], id, 'pre');
  const post = column(outbound.get(id) || [], id, 'post');
  document.getElementById('pre').innerHTML = pre.html;
  document.getElementById('post').innerHTML = post.html;
  document.getElementById('n-pre').textContent = pre.count ? `(${pre.count}${pre.xCount ? ` · 跨学科 ${pre.xCount}` : ''})` : '';
  document.getElementById('n-post').textContent = post.count ? `(${post.count}${post.xCount ? ` · 跨学科 ${post.xCount}` : ''})` : '';
  const isM = mastered.has(id);
  document.getElementById('me').innerHTML = `<div class="me">
    <div class="me-action"><button id="me-toggle" class="mastery-action ${isM ? 'mastered' : ''}">${isM ? '↩︎ 取消掌握标记' : '✓ 标记为已掌握'}</button><a id="me-graph-link">在图谱中查看 ↗</a></div>
    <div class="nm">${esc(me.name)}</div>
    <div class="meta"><span class="tag">${sz(me.subject)}</span>${me.age >= 0 ? `<span class="tag">${me.age}岁</span>` : ''}${isM ? '<span class="tag ok">已掌握</span>' : ''}</div>
    <div class="me-detail" id="me-detail"><div class="skel skel-card" style="height:80px"></div></div>

  </div>`;
  document.getElementById('me-toggle').addEventListener('click', () => toggleMastered(id));
  document.getElementById('me-graph-link').addEventListener('click', () => showGraphTopic(id));
  fetch(`/api/topic/${encodeURIComponent(id)}`).then(r => r.json()).then(d => {
    if (curId !== id) return;
    const el = document.getElementById('me-detail');
    if (el) el.innerHTML = renderMeDetail(d);
  }).catch(() => {
    if (curId !== id) return;
    const el = document.getElementById('me-detail');
    if (el) el.innerHTML = '<p class="me-empty">详情加载失败</p>';
  });
  renderTrail();
  document.querySelectorAll('.cols .tcard').forEach(c => c.addEventListener('click', () => show(c.dataset.id)));
  syncMobileWithId(id);
}

function renderTrail() {
  document.getElementById('trail').innerHTML = trail.length < 2 ? '' :
    '走过:' + trail.map((id, i) => `<a data-i="${i}">${esc(N(id).name)}</a>`).join('<span class="sep">›</span>');
  document.querySelectorAll('#trail a').forEach(a => a.addEventListener('click', () => show(trail[+a.dataset.i], false)));
}

// === 搜索 ===
const qEl = document.getElementById('q'), sgEl = document.getElementById('sugg');
let qTimer;
qEl.addEventListener('input', () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    const q = qEl.value.trim().toLowerCase();
    if (!q) { sgEl.innerHTML = ''; return; }
    const hits = [];
    for (const [id, n] of Object.entries(NODES)) {
      if (n[0].toLowerCase().includes(q)) { hits.push([id, n]); if (hits.length >= 20) break; }
    }
    sgEl.innerHTML = hits.map(([id, n]) =>
      `<div class="sg" data-id="${esc(id)}"><span class="s">${sz(n[1])}${n[2] >= 0 ? ' · ' + n[2] + '岁' : ''}</span>${esc(n[0])}</div>`).join('')
      || '<div class="sg">无结果</div>';
    sgEl.querySelectorAll('.sg[data-id]').forEach(d => d.addEventListener('click', () => {
      sgEl.innerHTML = ''; qEl.value = '';
      show(d.dataset.id);
    }));
  }, 200);
});
document.addEventListener('click', (e) => { if (!e.target.closest('.sb-search')) sgEl.innerHTML = ''; });
function renderPresets() {
  const presets = PRESETS.filter(id => !mastered.has(id));
  const el = document.getElementById('presets');
  el.innerHTML = presets.length
    ? presets.map(id => `<button class="preset" data-id="${esc(id)}">${esc(N(id)?.name || id)}</button>`).join(' ')
    : '<span class="preset-empty">入口知识点均已掌握</span>';
  el.querySelectorAll('.preset').forEach(button => button.addEventListener('click', () => show(button.dataset.id)));
}


// presets
renderPresets();

// === 共享侧边栏: 可收起 + 学科目录树(/api/subjects) ===
const SBKEY = 'kg-demo-sb-open';
let sbOpen = localStorage.getItem(SBKEY) !== '0' && window.innerWidth > 900;
function applySb() { document.body.classList.toggle('sb-open', sbOpen); }
document.getElementById('sb-toggle').addEventListener('click', () => {
  sbOpen = !sbOpen; localStorage.setItem(SBKEY, sbOpen ? '1' : '0'); applySb();
});
applySb();

// 目录树: 维度 → subject → domain → 知识点(懒填充)。脉络/图谱两个 tab 共用:
// 点知识点 → 当前 tab 是脉络就 show(),是图谱就驱动 iframe 路由。
// 维度与主 viewer 相同(us=美版 / bj-primary / bj-junior / bj-senior),切维度重载树并同步 iframe。
let curDim = 'us';
let dimsCfg = null;
async function loadDims() {
  try {
    dimsCfg = await (await fetch('/api/dimensions')).json();
    curDim = dimsCfg.defaultDimension || 'us';
  } catch { dimsCfg = { dimensions: { us: { label: '美版' } } }; }
  renderDims();
}
function renderDims() {
  const el = document.getElementById('sb-dims');
  el.innerHTML = Object.entries(dimsCfg.dimensions).map(([id, d]) =>
    `<button class="sb-dim ${id === curDim ? 'active' : ''}" data-dim="${id}">${esc(d.label)}</button>`).join('');
  el.querySelectorAll('.sb-dim').forEach(b => b.addEventListener('click', () => {
    if (curDim === b.dataset.dim) return;
    curDim = b.dataset.dim;
    renderDims();
    treeLoaded = false; loadTree();
    // 图谱 iframe 同步维度(主 viewer 路由含 ?dim=)
    if (graphLoaded) { try { graphFrame.contentWindow.location.hash = `#/?dim=${curDim}`; } catch { } }
  }));
}

let treeLoaded = false;
async function loadTree() {
  if (treeLoaded) return;
  treeLoaded = true;
  const el = document.getElementById('sb-tree');
  el.innerHTML = '<p class="sb-loading">加载目录…</p>';
  try {
    const tree = await (await fetch(`/api/subjects?dimension=${curDim}`)).json();
    const entries = Object.entries(tree).sort((a, b) => b[1].count - a[1].count);
    el.innerHTML = entries.map(([s, sv]) => `
      <div class="sb-subject" data-s="${esc(s)}">
        <div class="sb-subject-h"><span class="arrow">▶</span><span>${esc(sv.subjectZh || s)}</span><span class="cnt">${sv.count}</span></div>
        <div class="sb-domains">${Object.entries(sv.domains).map(([d, dv]) => `
          <div class="sb-domain" data-s="${esc(s)}" data-d="${esc(d)}">
            <div class="sb-domain-h"><span>${esc(dv.domainZh || d)}</span><span class="cnt">${dv.count}</span></div>
            <div class="sb-topics"></div>
          </div>`).join('')}</div>
      </div>`).join('');
    el.querySelectorAll('.sb-subject-h').forEach(h => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));
    el.querySelectorAll('.sb-domain-h').forEach(h => h.addEventListener('click', () => {
      const dEl = h.parentElement;
      const open = dEl.classList.toggle('open');
      if (open && !dEl.dataset.filled) fillTopics(dEl);
    }));
  } catch {
    el.innerHTML = '<p class="sb-loading">目录加载失败</p>';
  }
}
// 领域下的知识点: 调 /api/topics?dimension=&subject=&domain= 拉该桶列表(一次一桶,量小)。
async function fillTopics(dEl) {
  dEl.dataset.filled = '1';
  const box = dEl.querySelector('.sb-topics');
  box.innerHTML = '<p class="sb-loading" style="padding:4px 48px">…</p>';
  try {
    const data = await (await fetch(`/api/topics?dimension=${curDim}&subject=${encodeURIComponent(dEl.dataset.s)}&domain=${encodeURIComponent(dEl.dataset.d)}`)).json();
    const tops = data.topics.sort((a, b) => (a.ageRangeStart ?? 99) - (b.ageRangeStart ?? 99));
    box.innerHTML = tops.map(t =>
      `<a class="sb-topic" data-id="${esc(t.id)}">${esc(t.name)}${t.ageRangeStart != null ? `<span class="age">${t.ageRangeStart}岁</span>` : ''}</a>`).join('');
    box.querySelectorAll('.sb-topic').forEach(a => a.addEventListener('click', () => openTopic(a.dataset.id)));
  } catch {
    box.innerHTML = '<p class="sb-loading" style="padding:4px 48px">加载失败</p>';
  }
}
// 统一入口: 按当前 tab 决定去脉络还是图谱
function openTopic(id) {
  if (activeTab === 'graph') showGraphTopic(id);
  else if (NODES[id]) show(id);
  else showGraphTopic(id); // 脉络数据没有的节点(不该发生)兜底进图谱
  if (window.innerWidth <= 900) { sbOpen = false; applySb(); }
}

// === Tab 切换: 知识脉络 / 知识图谱 ===
// 图谱 = iframe 懒加载主 viewer(同源)。首次切换才加载;之后隐藏保留状态。
// 同源可直接驱动 iframe 内 hash 路由,实现"在图谱中查看"联动。
const graphFrame = document.getElementById('graph-frame');
let graphLoaded = false;
let activeTab = 'path';
// 图谱 hero 标题 = 当前维度标签(美版 / 小学·北京 / 初中·北京 / 高中·北京)
function updateGraphHero() {
  try {
    const doc = graphFrame.contentDocument;
    const hero = doc.querySelector('.overview-hero h2');
    if (!hero) return;
    const m = graphFrame.contentWindow.location.hash.match(/[?&]dim=([\w-]+)/);
    const dim = (m && m[1]) || curDim;
    const label = dimsCfg?.dimensions?.[dim]?.label;
    if (label) hero.textContent = label;
  } catch { }
}


function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.getElementById('path-pane').style.display = tab === 'path' ? '' : 'none';
  document.getElementById('graph-pane').hidden = tab !== 'graph';
  if (tab === 'graph' && !graphLoaded) {
    graphFrame.src = '/graph.html';
    graphLoaded = true;
    // 壳层已提供共享侧栏,注入 CSS 隐藏 iframe 内主 viewer 自己的侧栏,避免双侧栏
    graphFrame.addEventListener('load', () => {
      try {
        const doc = graphFrame.contentDocument;
        const st = doc.createElement('style');
        st.textContent = '.sidebar{display:none!important}.content{max-width:none!important}';
        doc.head.appendChild(st);
        // hero 标题跟随维度,iframe 内 hash 变化也同步
        updateGraphHero();
        graphFrame.contentWindow.addEventListener('hashchange', updateGraphHero);
      } catch { }
    }, { once: true });
  }
}
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

// 脉络 → 图谱联动: 切 tab 并把 iframe 路由到该知识点详情
function showGraphTopic(id) {
  switchTab('graph');
  const nav = () => { try { graphFrame.contentWindow.location.hash = `#/${id}?dim=${curDim}`; } catch { } };
  if (graphFrame.contentDocument?.readyState === 'complete' && graphFrame.src) nav();
  else graphFrame.addEventListener('load', nav, { once: true });
}

// === 移动端知识路径 ===
const mobEl = (id) => document.getElementById(id);
let mobileSeq = [];
let mobilePos = 0;
let mobileUndo = null;
let mobilePointerId = null;
let mobileGestureStart = null;

function mobileAnnounce(msg) {
  const el = mobEl('mobile-live');
  if (el) el.textContent = msg;
}

function updateMobileControls() {
  const empty = mobileSeq.length === 0;
  const prev = mobEl('mobile-prev'), next = mobEl('mobile-next');
  if (prev) prev.disabled = empty || mobilePos === 0;
  if (next) next.disabled = empty || mobilePos === mobileSeq.length - 1;
  const id = mobileSeq[mobilePos];
  const masteredBtn = mobEl('mobile-decision-mastered'), reviewBtn = mobEl('mobile-decision-review');
  if (masteredBtn) { masteredBtn.disabled = empty; masteredBtn.setAttribute('aria-pressed', String(Boolean(id && mastered.has(id)))); }
  if (reviewBtn) { reviewBtn.disabled = empty; reviewBtn.setAttribute('aria-pressed', String(Boolean(id && needsReview.has(id)))); }
  const undoBtn = mobEl('mobile-undo');
  if (undoBtn) { undoBtn.hidden = !mobileUndo; undoBtn.disabled = !mobileUndo; }
  const position = mobEl('mobile-position');
  if (position) position.textContent = empty ? '0 / 0' : `${mobilePos + 1} / ${mobileSeq.length}`;
}

function renderMobileCard() {
  const card = mobEl('mobile-path-card');
  const scroll = mobEl('mobile-card-scroll');
  const title = mobEl('mobile-card-title');
  const tags = mobEl('mobile-card-tags');
  const detail = mobEl('mobile-card-detail');
  const emptyState = mobEl('mobile-card-empty');
  const errorState = mobEl('mobile-card-error');
  if (!mobileSeq.length) {
    if (card) card.dataset.state = 'empty';
    if (title) title.textContent = '当前范围没有知识点';
    if (tags) tags.textContent = '';
    if (detail) detail.hidden = true;
    if (emptyState) emptyState.hidden = false;
    if (errorState) errorState.hidden = true;
    const ctx = mobEl('mobile-context'); if (ctx) ctx.textContent = '清除筛选或打开目录选择知识点';
    updateMobileControls();
    return;
  }
  const id = mobileSeq[mobilePos];
  const n = N(id);
  const isM = mastered.has(id), isR = needsReview.has(id);
  if (card) card.dataset.state = isM ? 'mastered' : isR ? 'needs-review' : 'ready';
  if (title) title.textContent = n.name;
  if (tags) tags.innerHTML = `<span class="tag">${esc(sz(n.subject))}</span>${n.age >= 0 ? `<span class="tag">${n.age}岁</span>` : ''}<span class="tag">${isM ? '已掌握' : isR ? '暂未掌握' : '待判断'}</span>`;
  if (detail) { detail.hidden = false; detail.innerHTML = '<div class="skel skel-card" style="height:60px"></div>'; }
  if (emptyState) emptyState.hidden = true;
  if (errorState) errorState.hidden = true;
  const preNames = (inbound.get(id) || []).map(e => N(e.f)?.name).filter(Boolean).slice(0, 3);
  const postNames = (outbound.get(id) || []).map(e => N(e.t)?.name).filter(Boolean).slice(0, 3);
  const ctx = mobEl('mobile-context');
  if (ctx) ctx.textContent = `前置 ${preNames.length ? preNames.join('、') : '无'} · 后续 ${postNames.length ? postNames.join('、') : '无'}`;
  if (scroll) scroll.scrollTop = 0;
  updateMobileControls();
  fetch(`/api/topic/${encodeURIComponent(id)}`).then(r => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }).then(d => {
    if (mobileSeq[mobilePos] === id && detail) detail.innerHTML = renderMeDetail(d);
  }).catch(() => {
    if (mobileSeq[mobilePos] !== id) return;
    if (detail) detail.hidden = true;
    if (errorState) errorState.hidden = false;
  });
}

function syncMobileWithId(id) {
  if (!mobEl('mobile-path-card')) return;
  const idx = mobileSeq.indexOf(id);
  if (idx !== -1) { mobilePos = idx; renderMobileCard(); }
}

function mobileStep(delta) {
  if (!mobileSeq.length) return;
  const next = Math.max(0, Math.min(mobileSeq.length - 1, mobilePos + delta));
  if (next === mobilePos) return;
  mobilePos = next;
  show(mobileSeq[mobilePos], false);
}

function decideMobile(id, decision) {
  mobileUndo = { id, prevMastered: mastered.has(id), prevNeedsReview: needsReview.has(id) };
  const next = applyKnowledgeDecision({ mastered, needsReview }, id, decision);
  mastered = next.mastered; needsReview = next.needsReview;
  saveMastered(); saveNeedsReview(); notifyMasteryChange();
  renderMasteredBar(); renderNext(); renderPresets();
  const nextIndex = Math.min(mobilePos + 1, mobileSeq.length - 1);
  mobileAnnounce(`${decision === 'mastered' ? '已标记为已掌握' : '已标记为暂未掌握'}${nextIndex !== mobilePos ? `，已切换到${N(mobileSeq[nextIndex]).name}` : ''}`);
  mobilePos = nextIndex;
  show(mobileSeq[mobilePos], false);
}

function undoMobile() {
  if (!mobileUndo) return;
  const { id, prevMastered, prevNeedsReview } = mobileUndo;
  const restored = applyKnowledgeDecision({ mastered, needsReview }, id,
    prevMastered ? 'mastered' : prevNeedsReview ? 'needs-review' : 'clear');
  mastered = restored.mastered; needsReview = restored.needsReview;
  saveMastered(); saveNeedsReview(); notifyMasteryChange();
  renderMasteredBar(); renderNext(); renderPresets();
  const idx = mobileSeq.indexOf(id);
  if (idx !== -1) mobilePos = idx;
  mobileUndo = null;
  mobileAnnounce('已撤销上次判定');
  if (mobileSeq.length) show(mobileSeq[mobilePos], false); else renderMobileCard();
}

function populateMobileFilters() {
  const subjSel = mobEl('mobile-subject-filter');
  const ageSel = mobEl('mobile-age-filter');
  if (subjSel) {
    const subjects = [...new Set(Object.values(NODES).map(n => n[1]))].sort((a, b) => sz(a).localeCompare(sz(b), 'zh-Hans-CN'));
    subjSel.innerHTML = '<option value="">全部学科</option>' + subjects.map(s => `<option value="${esc(s)}">${esc(sz(s))}</option>`).join('');
  }
  if (ageSel) {
    const ages = [...new Set(Object.values(NODES).map(n => n[2]).filter(a => a >= 0))].sort((a, b) => a - b);
    ageSel.innerHTML = '<option value="">全部年龄</option>' + ages.map(a => `<option value="${a}">${a}岁（学年参考）</option>`).join('');
  }
}

function applyMobileFilters() {
  const subject = mobEl('mobile-subject-filter')?.value || '';
  const age = mobEl('mobile-age-filter')?.value || '';
  const filters = {};
  if (subject) filters.subject = subject;
  if (age) filters.age = Number(age);
  mobileSeq = buildPathSequence(NODES, EDGES, filters);
  const firstUnmastered = mobileSeq.findIndex(id => !mastered.has(id));
  mobilePos = mobileSeq.length ? (firstUnmastered === -1 ? 0 : firstUnmastered) : 0;
  mobileUndo = null;
  if (mobileSeq.length) show(mobileSeq[mobilePos], false); else renderMobileCard();
  mobileAnnounce(mobileSeq.length ? `筛选范围已更新，共 ${mobileSeq.length} 个知识点` : '当前筛选范围没有知识点');
}

function clearMobileFilters() {
  const subjSel = mobEl('mobile-subject-filter'); if (subjSel) subjSel.value = '';
  const ageSel = mobEl('mobile-age-filter'); if (ageSel) ageSel.value = '';
  applyMobileFilters();
}

function setupMobileGestures() {
  const scroll = mobEl('mobile-card-scroll');
  const card = mobEl('mobile-path-card');
  if (!scroll || !card) return;
  scroll.addEventListener('pointerdown', (e) => {
    if (!e.isPrimary || mobilePointerId !== null) return;
    mobilePointerId = e.pointerId;
    mobileGestureStart = { x: e.clientX, y: e.clientY };
    scroll.setPointerCapture?.(e.pointerId);
  });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  scroll.addEventListener('pointermove', (e) => {
    if (e.pointerId !== mobilePointerId || !mobileGestureStart || reducedMotion.matches) return;
    const dx = e.clientX - mobileGestureStart.x;
    const dy = e.clientY - mobileGestureStart.y;
    if (Math.abs(dx) > Math.abs(dy) * 1.25) card.style.transform = `translateX(${Math.max(-20, Math.min(20, dx))}px)`;
  });
  const finish = (e) => {
    if (e.pointerId !== mobilePointerId || !mobileGestureStart) return;
    const dx = e.clientX - mobileGestureStart.x;
    const dy = e.clientY - mobileGestureStart.y;
    const result = e.type === 'pointercancel' ? null : classifyPathGesture({ dx, dy }, {
      atTop: scroll.scrollTop <= 0,
      atBottom: scroll.scrollTop + scroll.clientHeight >= scroll.scrollHeight - 1,
    });
    card.style.transform = '';
    mobilePointerId = null; mobileGestureStart = null;
    if (!result || !mobileSeq.length) return;
    if (result === 'mastered' || result === 'needs-review') decideMobile(mobileSeq[mobilePos], result);
    else mobileStep(result === 'next' ? 1 : -1);
  };
  scroll.addEventListener('pointerup', finish);
  scroll.addEventListener('pointercancel', finish);
}

function setupMobileKeyboard() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (['input', 'select', 'textarea', 'button'].includes(tag)) return;
    if (document.querySelectorAll('.modal-mask:not([hidden])').length) return;
    if (!mobileSeq.length) return;
    const id = mobileSeq[mobilePos];
    if (e.key === 'ArrowUp') mobileStep(1);
    else if (e.key === 'ArrowDown') mobileStep(-1);
    else if (e.key === 'ArrowLeft') decideMobile(id, 'mastered');
    else if (e.key === 'ArrowRight') decideMobile(id, 'needs-review');
    else return;
    e.preventDefault();
  });
}

function setupMobileBottomNav() {
  const activate = (tab) => document.querySelectorAll('#mobile-bottom-nav [data-mobile-tab]').forEach(btn => {
    if (btn.dataset.mobileTab === tab) btn.setAttribute('aria-current', 'page'); else btn.removeAttribute('aria-current');
  });
  document.querySelectorAll('#mobile-bottom-nav [data-mobile-tab]').forEach(btn => btn.addEventListener('click', () => {
    const tab = btn.dataset.mobileTab;
    activate(tab);
    if (tab === 'path') {
      sbOpen = false; applySb();
      document.querySelectorAll('.modal-mask:not([hidden])').forEach(mask => { if (mask.id !== 'agreement-mask') mask.hidden = true; });
    } else if (tab === 'catalog') {
      sbOpen = true; applySb();
      mobEl('q')?.focus();
    } else {
      renderProfileModal(); openMask('profile-mask');
    }
  }));
  mobEl('mobile-sidebar-close')?.addEventListener('click', () => { sbOpen = false; applySb(); activate('path'); });
  mobEl('mobile-card-open-catalog')?.addEventListener('click', () => { sbOpen = true; applySb(); activate('catalog'); });
}

function setupMobileAI() {
  const openBtn = mobEl('mobile-ai-open');
  const mask = mobEl('mobile-ai-mask');
  const closeBtn = mobEl('mobile-ai-close');
  const loginBtn = mobEl('mobile-ai-login-unavailable');
  if (!openBtn || !mask || !closeBtn || !loginBtn) return;
  let lastTrigger = null;
  const closeAI = () => {
    mask.hidden = true;
    lastTrigger?.focus();
  };
  openBtn.addEventListener('click', () => {
    lastTrigger = document.activeElement;
    mask.hidden = false;
    mobEl('mobile-ai-title')?.focus();
  });
  closeBtn.addEventListener('click', closeAI);
  loginBtn.addEventListener('click', () => toast('真实登录服务尚未接入'));
  mobEl('mobile-login-btn')?.addEventListener('click', () => toast('真实登录服务尚未接入'));
  mask.addEventListener('click', (e) => { if (e.target === mask) closeAI(); });
  mask.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeAI(); return; }
    if (e.key !== 'Tab') return;
    const first = loginBtn, last = closeBtn;
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  const updateAIAvailability = () => {
    const online = navigator.onLine;
    openBtn.disabled = !online;
    openBtn.textContent = online ? 'AI 伙伴' : 'AI 伙伴（离线）';
    const offline = mobEl('mobile-card-offline'); if (offline) offline.hidden = online;
  };
  window.addEventListener('online', updateAIAvailability);
  window.addEventListener('offline', updateAIAvailability);
  updateAIAvailability();
}

function setupMobilePath() {
  if (!mobEl('mobile-path-card') || !window.matchMedia('(max-width: 767px)').matches) return;
  populateMobileFilters();
  mobEl('mobile-filter-apply')?.addEventListener('click', applyMobileFilters);
  mobEl('mobile-filter-clear')?.addEventListener('click', clearMobileFilters);
  mobEl('mobile-card-clear-filter')?.addEventListener('click', clearMobileFilters);
  mobEl('mobile-card-retry')?.addEventListener('click', renderMobileCard);
  mobEl('mobile-decision-mastered')?.addEventListener('click', () => { if (mobileSeq.length) decideMobile(mobileSeq[mobilePos], 'mastered'); });
  mobEl('mobile-decision-review')?.addEventListener('click', () => { if (mobileSeq.length) decideMobile(mobileSeq[mobilePos], 'needs-review'); });
  mobEl('mobile-undo')?.addEventListener('click', undoMobile);
  mobEl('mobile-prev')?.addEventListener('click', () => mobileStep(-1));
  mobEl('mobile-next')?.addEventListener('click', () => mobileStep(1));
  setupMobileGestures();
  setupMobileKeyboard();
  setupMobileBottomNav();
  setupMobileAI();
  refreshMobilePath = applyMobileFilters;
  applyMobileFilters();
}

// === 启动 ===
renderUserBar();
renderMasteredBar(); renderNext();
show(PRESETS[0]);
loadDims().then(loadTree);
setupMobilePath();

}
boot().catch(err => {
  console.error('初始化失败:', err);
  const card = document.getElementById('mobile-path-card'); if (card) card.dataset.state = 'error';
  const title = document.getElementById('mobile-card-title'); if (title) title.textContent = '知识数据加载失败';
  const desktopError = document.getElementById('me');
  if (desktopError) { desktopError.innerHTML = '<div class="me"><div class="nm">加载失败</div><div class="desc"></div></div>'; desktopError.querySelector('.desc').textContent = String(err.message); }
  const errorState = document.getElementById('mobile-card-error'); if (errorState) errorState.hidden = false;
  const retry = document.getElementById('mobile-card-retry'); if (retry) retry.addEventListener('click', () => location.reload());
});
