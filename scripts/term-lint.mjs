#!/usr/bin/env node
/**
 * term-lint.mjs — 中文数学/科学术语命名发现与纠错。
 *
 * 机制一句话：Wikidata 当裁判。
 *   上游英文专名 ──查 Wikidata──▶ 标准中文名 ──比对──▶ 中文译文
 *                                                 ├─ 一致 → 放行
 *                                                 └─ 不一致 → 实锤错译（正解同时到手）
 *
 * 两种职责：
 *   1. 发现（默认）：扫描中文译文，对照 terminology.json 的 bad[]→good 报告错译。
 *      顺带用上游英文专名查 Wikidata 补充候选词（缓存到 .terminology-cache.json）。
 *   2. 修复（--fix）：对每条命中用 good 替换译文里的错词，精确到文本字段。
 *
 * 用法：
 *   node scripts/term-lint.mjs                扫描并报告（exit 0）
 *   node scripts/term-lint.mjs --strict        命中即 exit 1（供 CI）
 *   node scripts/term-lint.mjs --fix           打印 diff 预览（不落盘）
 *   node scripts/term-lint.mjs --fix --yes     落盘修复
 *   node scripts/term-lint.mjs --no-network    仅用本地缓存 + terminology，不联网
 *
 * 依赖零，纯 Node（fetch 需 Node≥18）。频次：串行 + 1.2s 间隔，绝不并发。
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const UPSTREAM_DATA = resolve(ROOT, '..', 'os-taxonomy', 'data');

// --- 参数 -----------------------------------------------------------------
const args = process.argv.slice(2);
const strictMode = args.includes('--strict');
const fixMode = args.includes('--fix');
const autoYes = args.includes('--yes');
const noNetwork = args.includes('--no-network');

// --- 工具 -----------------------------------------------------------------
const load = (dir, name) => {
  const p = resolve(dir, name);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8'));
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 中文文本字段白名单（--fix 只动这些，绝不碰 id/cnStandards 等结构字段）
const TOPIC_TEXT_FIELDS = ['name', 'description', 'assessmentPrompt'];
const DEP_TEXT_FIELDS = ['reason'];

// --- 加载数据 -------------------------------------------------------------
const terminology = load(DATA, 'terminology.json');
const cachePath = resolve(DATA, '.terminology-cache.json');
const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {};

if (!terminology) {
  console.error('✗ data/terminology.json 不存在，请先建立术语规范表。');
  process.exit(2);
}

const zhTopics = load(DATA, 'topics.zh.json');
const zhDeps = load(DATA, 'dependencies.zh.json');
const upstreamTopics = load(UPSTREAM_DATA, 'topics.json');
const upstreamDeps = load(UPSTREAM_DATA, 'dependencies.json');

// --- 上游英文专名候选抽取 -------------------------------------------------
// 泛义词黑名单：这些 name 含 theorem/law/principle/equation 但不是具名专名
const GENERIC_BLACKLIST = new Set([
  'Two-Step Equations',
  'Equations with Two Unknowns',
  'Writing Algebraic Equations',
  'Expressions & Equations Vocabulary',
  'Solving Linear Equations',
  'Simultaneous Equations',
]);

/**
 * 从英文文本抽取疑似具名专名候选。
 * 规则：<大写词>('s)? + (theorem|law|principle|paradox|equation|dogma|conjecture)
 * 去泛用语境（小写 equation=等式、principle=原理/原则 的陈述句不在范围）。
 */
function extractCandidates(text) {
  if (!text) return [];
  // 匹配 "Pythagorean theorem" / "Ohm's law" / "Newton's first law" / "Fermi paradox" 等
  const re = /\b([A-Z][\w''-]+(?:\s+[A-Za-z][\w''-]+){0,3}?(?:'s)?)\s+(theorem|law|principle|paradox|equation|dogma|conjecture)\b/gi;
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const full = `${m[1]} ${m[2]}`.trim();
    // 规范化撇号
    const normalized = full.replace(/'/g, "'").replace(/\s+/g, ' ');
    out.push(normalized);
  }
  return out;
}

// --- Wikidata 查询（带频控、降级、缓存）-------------------------------------
const UA = 'os-taxonomy-beijing/1.0 (research; contact via github.com/withmarbleapp)';
const REQ_INTERVAL_MS = 2000; // 礼貌限速：0.5 req/s，串行（Wikidata 匿名限额紧）

let rateLimited = false;
let networkErrors = 0;

async function wikidataZhLabel(en) {
  // 缓存命中直接返回
  if (cache[en]) return cache[en];

  if (noNetwork) return null;

  // 路径 1：wbgetentities by enwiki title
  let result = await queryByTitle(en);
  // 路径 2（降级）：wbsearchentities 模糊查 + 再取 zh label
  if (!result) result = await queryBySearch(en);

  // 写缓存（含 null，避免反复查不存在的）
  cache[en] = result;
  return result;
}

async function queryByTitle(en) {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbgetentities` +
    `&sites=enwiki&titles=${encodeURIComponent(en)}` +
    `&props=labels&languages=zh|zh-cn|zh-hans&format=json`;
  const d = await fetchJson(url);
  if (!d) return null;
  const entities = d.entities || {};
  for (const [qid, v] of Object.entries(entities)) {
    if (qid.startsWith('-')) continue; // missing
    const labels = v.labels || {};
    const zh =
      (labels['zh-cn'] || labels['zh-hans'] || labels['zh'] || {}).value || null;
    if (zh) return { qid, zh };
  }
  return null;
}

async function queryBySearch(en) {
  const url =
    `https://www.wikidata.org/w/api.php?action=wbsearchentities` +
    `&search=${encodeURIComponent(en)}&language=en&limit=3&format=json`;
  const d = await fetchJson(url);
  if (!d || !d.search || !d.search.length) return null;
  // 取第一个有 description 且像科学概念的（跳过电影/画作等干扰）
  for (const item of d.search) {
    const desc = (item.description || '').toLowerCase();
    if (/(film|painting|song|album|book)/.test(desc)) continue;
    const qid = item.id;
    const labelUrl =
      `https://www.wikidata.org/w/api.php?action=wbgetentities` +
      `&ids=${qid}&props=labels&languages=zh|zh-cn|zh-hans&format=json`;
    await sleep(REQ_INTERVAL_MS);
    const d2 = await fetchJson(labelUrl);
    if (!d2) continue;
    const ent = (d2.entities || {})[qid] || {};
    const labels = ent.labels || {};
    const zh =
      (labels['zh-cn'] || labels['zh-hans'] || labels['zh'] || {}).value || null;
    if (zh) return { qid, zh };
  }
  return null;
}

async function fetchJson(url) {
  if (rateLimited) return null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.status === 429) {
        rateLimited = true;
        const retryAfter = res.headers.get('retry-after');
        const waitHint = retryAfter ? `建议等待 ${retryAfter}s` : '建议等几分钟后重跑';
        console.error(`⚠  Wikidata 返回 429（频次限制），停止联网查询。${waitHint}。`);
        console.error(`   已查询结果已缓存，重跑可继续（增量，仅查未见过的词）。`);
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      networkErrors++;
      if (attempt < 2) {
        const backoff = 1500 * Math.pow(2, attempt); // 1.5s, 3s, 6s
        await sleep(backoff);
      }
    }
  }
  return null;
}

// --- 检测：扫描中文译文找 bad 词 -------------------------------------------
/**
 * 返回命中数组：{ file, topicId, field, index?, bad, good, en, qid, preview }
 */
function scanZhTexts() {
  const hits = [];
  const rules = terminology.terms || [];

  // topics.zh.json
  for (const t of zhTopics.topics || []) {
    for (const field of TOPIC_TEXT_FIELDS) {
      const val = t[field];
      if (typeof val !== 'string') continue;
      for (const r of rules) {
        for (const bad of r.bad || []) {
          if (val.includes(bad)) {
            hits.push({
              file: 'topics.zh.json',
              topicId: t.id,
              field,
              bad,
              good: r.good,
              en: r.en,
              qid: r.qid,
              preview: val.slice(0, 60),
            });
          }
        }
      }
    }
    // evidence 数组逐条
    for (let i = 0; i < (t.evidence || []).length; i++) {
      const val = t.evidence[i];
      for (const r of rules) {
        for (const bad of r.bad || []) {
          if (val.includes(bad)) {
            hits.push({
              file: 'topics.zh.json',
              topicId: t.id,
              field: 'evidence',
              index: i,
              bad,
              good: r.good,
              en: r.en,
              qid: r.qid,
              preview: val.slice(0, 60),
            });
          }
        }
      }
    }
  }

  // dependencies.zh.json
  for (let i = 0; i < (zhDeps.dependencies || []).length; i++) {
    const d = zhDeps.dependencies[i];
    const val = d.reason;
    if (typeof val !== 'string') continue;
    for (const r of rules) {
      for (const bad of r.bad || []) {
        if (val.includes(bad)) {
          hits.push({
            file: 'dependencies.zh.json',
            topicId: `${d.topicId}→${d.prerequisiteId}`,
            field: 'reason',
            bad,
            good: r.good,
            en: r.en,
            qid: r.qid,
            preview: val.slice(0, 60),
          });
        }
      }
    }
  }

  return hits;
}

// --- 发现：上游英文专名查 Wikidata，找 terminology 未收录的候选 ------------
async function discoverNewTerms() {
  if (noNetwork) {
    console.log('ℹ  --no-network：跳过 Wikidata 发现，仅用本地 terminology。');
    return [];
  }
  if (!upstreamTopics) {
    console.log('ℹ  上游 ../os-taxonomy 不在本地，跳过英文专名发现。');
    return [];
  }

  const known = new Set((terminology.terms || []).map((t) => t.en.toLowerCase()));
  const candidateSet = new Map(); // en → { files: [{file,id,field}], }

  // 扫上游 name/description
  for (const t of upstreamTopics.topics || []) {
    for (const field of ['name', 'description']) {
      for (const cand of extractCandidates(t[field])) {
        if (GENERIC_BLACKLIST.has(t.name)) continue;
        const key = cand.toLowerCase();
        if (known.has(key)) continue;
        if (!candidateSet.has(key)) {
          candidateSet.set(key, { en: cand, sources: [] });
        }
        candidateSet.get(key).sources.push(`${t.id}.${field}`);
      }
    }
  }
  // 上游 dependencies.reason
  if (upstreamDeps) {
    for (const d of upstreamDeps.dependencies || []) {
      for (const cand of extractCandidates(d.reason)) {
        const key = cand.toLowerCase();
        if (known.has(key)) continue;
        if (!candidateSet.has(key)) candidateSet.set(key, { en: cand, sources: [] });
        candidateSet.get(key).sources.push(`dep:${d.topicId}`);
      }
    }
  }

  // 逐个查 Wikidata（串行 + 限速）
  const newTerms = [];
  const candidates = [...candidateSet.values()];
  let queried = 0;
  for (const c of candidates) {
    if (rateLimited) break;
    const res = await wikidataZhLabel(c.en);
    queried++;
    await sleep(REQ_INTERVAL_MS);
    if (res && res.zh) {
      newTerms.push({ en: c.en, good: res.zh, qid: res.qid, sources: c.sources });
    }
  }
  console.log(
    `ℹ  英文专名发现：${candidates.length} 个候选，查询 Wikidata ${queried} 次` +
      (rateLimited ? '（因限流中断）' : '') + '。',
  );
  return newTerms;
}

// --- 修复：--fix ----------------------------------------------------------
function applyFixes(hits) {
  if (!hits.length) {
    console.log('✓ 无需修复的术语错译。');
    return;
  }
  let planned = 0;
  let applied = 0;

  // 按文件分组命中
  const byFile = { 'topics.zh.json': [], 'dependencies.zh.json': [] };
  for (const h of hits) byFile[h.file].push(h);

  for (const fname of Object.keys(byFile)) {
    if (!byFile[fname].length) continue;
    const data = fname === 'topics.zh.json' ? zhTopics : zhDeps;

    for (const h of byFile[fname]) {
      // 定位到目标字符串
      let target;
      if (fname === 'topics.zh.json') {
        const t = data.topics.find((x) => x.id === h.topicId);
        if (!t) continue;
        target = h.field === 'evidence' ? t.evidence : t;
      } else {
        const d = data.dependencies.find(
          (x) => `${x.topicId}→${x.prerequisiteId}` === h.topicId,
        );
        if (!d) continue;
        target = d;
      }

      const fieldKey = h.field;
      const oldVal = h.index != null ? target[fieldKey][h.index] : target[fieldKey];
      if (typeof oldVal !== 'string' || !oldVal.includes(h.bad)) continue;

      const newVal = oldVal.split(h.bad).join(h.good); // 全量替换该字段内所有 bad
      planned++;

      if (!autoYes) {
        console.log(
          `  ${fname} ${h.topicId} [${h.field}${h.index != null ? `[${h.index}]` : ''}]\n` +
            `    - ${oldVal.slice(0, 70)}\n` +
            `    + ${newVal.slice(0, 70)}`,
        );
      }

      if (autoYes) {
        if (h.index != null) target[fieldKey][h.index] = newVal;
        else target[fieldKey] = newVal;
        applied++;
      }
    }
  }

  if (!autoYes) {
    console.log(`\nℹ  预览 ${planned} 处修复（未落盘）。加 --yes 真正写入。`);
    return;
  }

  // 落盘
  if (applied > 0) {
    writeFileSync(resolve(DATA, 'topics.zh.json'), JSON.stringify(zhTopics, null, 2) + '\n');
    writeFileSync(
      resolve(DATA, 'dependencies.zh.json'),
      JSON.stringify(zhDeps, null, 2) + '\n',
    );
    console.log(`✓ 已修复 ${applied} 处术语错译并落盘。`);
    console.log(`  💡 记得跑 npm run checksum 重算 manifest。`);
  } else {
    console.log(`ℹ  无可落盘的修复。`);
  }
}

// --- 主流程 ----------------------------------------------------------------
async function main() {
  console.log('term-lint — 中文术语命名检查\n');

  // 1) 检测已知错译
  const hits = scanZhTexts();

  // 2) 上游英文专名发现（联网）
  const newTerms = await discoverNewTerms();

  // 3) 持久化缓存（无论是否联网，有新查询就写回）
  writeFileSync(cachePath, JSON.stringify(cache, null, 2) + '\n');

  // --- 报告 ---
  if (hits.length) {
    console.error(`\n✗ 发现 ${hits.length} 处疑似术语错译：`);
    for (const h of hits) {
      const loc = `${h.file}:${h.topicId}:${h.field}${h.index != null ? `[${h.index}]` : ''}`;
      console.error(
        `  ${loc}\n` +
          `    "${h.bad}" → "${h.good}"` +
          (h.en ? `  (en: ${h.en}${h.qid ? `, ${h.qid}` : ''})` : '') +
          `\n    …${h.preview}…`,
      );
    }
  } else {
    console.log('\n✓ 已知术语错译：0（对照 terminology.json 的 bad 规则）。');
  }

  if (newTerms.length) {
    console.log(`\nℹ  Wikidata 发现 ${newTerms.length} 个 terminology 未收录的标准中文名（候选，待评审）：`);
    for (const n of newTerms) {
      console.log(`  ${n.en} → ${n.good}  (${n.qid})  [出现在 ${n.sources.length} 处]`);
    }
    console.log(`  评审后可加入 data/terminology.json 并设置 bad[]。`);
  }

  // 模式分流
  if (fixMode) {
    console.log('');
    applyFixes(hits);
  }

  // 退出码
  if (rateLimited || networkErrors > 0) {
    console.log(`\n⚠  本次有 ${networkErrors} 次网络错误${rateLimited ? ' + 频次限流' : ''}，结果可能不完整。`);
  }
  if (strictMode && hits.length) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('✗ 运行错误:', e);
  process.exit(2);
});
