#!/usr/bin/env node
/**
 * translate.mjs — 零依赖批量翻译流水线。
 *
 * 用公开翻译 API（Google 免费端点 = Chrome 翻译后端，MyMemory 备选）
 * 把上游 os-taxonomy 的英文微主题翻译为中文，写入 topics.zh.json +
 * dependencies.zh.json。不用模型。
 *
 *   node scripts/translate.mjs [options]
 *
 * 选项：
 *   --subject <Subject>   只翻译指定学科（如 Mathematics, Science）
 *   --limit <n>           只翻译 n 条 topic（测试用）
 *   --dry-run             只显示翻译结果，不写文件
 *   --no-deps             跳过依赖 reason 翻译
 *   --concurrency <n>     并发数（默认 5）
 *   --upstream <path>     上游仓库路径（默认 ../os-taxonomy）
 *   --force               覆盖已翻译的条目（默认跳过 reviewed/machine）
 *
 * 保护机制：
 *   - {{name}} 占位符翻译前替换为 token，翻译后还原
 *   - evidence 数组逐条翻译，数量严格对齐上游
 *   - 断点续传：进度存 data/.translate-progress.json，Ctrl+C 后重跑自动跳过
 *   - 并发 5 请求 + 失败重试 3 次 + Google→MyMemory 自动降级
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const PROGRESS_FILE = resolve(DATA, '.translate-progress.json');

// --- 参数解析 -------------------------------------------------------------
const args = process.argv.slice(2);
const getOpt = (name) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : null;
};
const hasFlag = (name) => args.includes(name);

const subjectFilter = getOpt('--subject');
const limit = getOpt('--limit') ? parseInt(getOpt('--limit'), 10) : null;
const dryRun = hasFlag('--dry-run');
const noDeps = hasFlag('--no-deps');
const force = hasFlag('--force');
const concurrency = getOpt('--concurrency') ? parseInt(getOpt('--concurrency'), 10) : 5;

let upstreamPath = getOpt('--upstream') || resolve(ROOT, '..', 'os-taxonomy');
const UPSTREAM_DATA = resolve(upstreamPath, 'data');

// --- 加载数据 -------------------------------------------------------------
const load = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));

if (!existsSync(resolve(UPSTREAM_DATA, 'topics.json'))) {
  console.error(`✗ 上游未找到: ${upstreamPath}`);
  console.error(`  克隆 os-taxonomy 后重试: git clone https://github.com/withmarbleapp/os-taxonomy "${upstreamPath}"`);
  process.exit(1);
}

const upstreamTopics = load(UPSTREAM_DATA, 'topics.json');
const upstreamDeps = load(UPSTREAM_DATA, 'dependencies.json');
const zhTopics = load(DATA, 'topics.zh.json');
const zhDeps = load(DATA, 'dependencies.zh.json');

// 术语表
let glossary = {};
const glossaryFile = resolve(DATA, 'glossary.json');
if (existsSync(glossaryFile)) {
  glossary = load(DATA, 'glossary.json').terms || {};
}

// --- 进度文件（断点续传）---------------------------------------------------
let progress = { topics: {}, deps: {} };
if (existsSync(PROGRESS_FILE) && !force && !dryRun) {
  try {
    progress = load(DATA, '.translate-progress.json');
    if (!progress.topics) progress.topics = {};
    if (!progress.deps) progress.deps = {};
  } catch { /* ignore corrupt progress */ }
}

function saveProgress() {
  if (dryRun) return;
  writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

// --- 翻译引擎 -------------------------------------------------------------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Google 免费端点翻译（Chrome 翻译 / Google Translate 网页版后端）。
 */
async function translateGoogle(text, retries = 3) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q='
        + encodeURIComponent(text);
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.status === 429 || res.status === 503) throw new Error(`rate-limited ${res.status}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      let result = '';
      if (json[0] && Array.isArray(json[0])) {
        for (const seg of json[0]) {
          if (seg[0]) result += seg[0];
        }
      }
      if (result) return result;
      throw new Error('empty response');
    } catch (err) {
      if (attempt < retries - 1) {
        await sleep(800 * Math.pow(2, attempt)); // 指数退避
        continue;
      }
      throw err;
    }
  }
}

/**
 * MyMemory 备选翻译（免费，无需 key）。
 */
async function translateMyMemory(text) {
  const url = 'https://api.mymemory.translated.net/get?langpair=en|zh-CN&q='
    + encodeURIComponent(text.slice(0, 500));
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`);
  const json = await res.json();
  const translated = json.responseData?.translatedText;
  if (!translated || translated.includes('MYMEMORY WARNING')) {
    throw new Error('MyMemory: ' + (json.responseDetails || 'unknown'));
  }
  return translated;
}

/**
 * 主翻译函数：Google → MyMemory 降级。保护 {{name}} 占位符。
 */
async function translate(text) {
  if (!text || typeof text !== 'string') return text;

  // 保护 {{name}} 占位符
  const hasName = text.includes('{{name}}');
  const safe = hasName ? text.replace(/\{\{name\}\}/g, '孩子X名X') : text;

  let result;
  try {
    result = await translateGoogle(safe);
  } catch (googleErr) {
    try {
      result = await translateMyMemory(safe);
    } catch (myMemErr) {
      // 最终降级：返回原文
      totalFailed++;
      return text;
    }
  }

  // 还原占位符
  if (hasName) {
    result = result.replace(/孩子X?名X?/g, '{{name}}');
  }

  // 术语表后处理
  for (const [en, zh] of Object.entries(glossary)) {
    const re = new RegExp(`\\b${en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    if (re.test(result)) {
      result = result.replace(re, zh);
    }
  }

  return result;
}

// --- 并发池 ----------------------------------------------------------------
let totalRequests = 0;
let totalFailed = 0;
let totalCached = 0;

/**
 * 并发执行器：items 是任务数组，worker 并发处理 concurrency 个。
 * onResult(index, result) 回调用于收集结果。
 */
async function pool(items, worker, concurrencySize, label) {
  let index = 0;
  let done = 0;
  const total = items.length;
  const errors = [];

  async function run() {
    while (index < items.length) {
      const myIndex = index++;
      try {
        await worker(items[myIndex], myIndex);
      } catch (err) {
        errors.push({ index: myIndex, error: err.message });
      }
      done++;
      if (done % 20 === 0 || done === total) {
        process.stdout.write(`\r  ${label}: [${done}/${total}] ${((done / total) * 100).toFixed(0)}%`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrencySize, total) }, () => run());
  await Promise.all(workers);
  process.stdout.write('\n');
  return errors;
}

// --- 翻译 topics ----------------------------------------------------------
async function translateTopics() {
  const zhById = new Map();
  for (const t of zhTopics.topics) zhById.set(t.id, t);

  let pending = upstreamTopics.topics;
  if (subjectFilter) pending = pending.filter(t => t.subject === subjectFilter);

  const toTranslate = [];
  for (const t of pending) {
    const existing = zhById.get(t.id);
    if (existing && existing.translationStatus === 'reviewed' && !force) continue;
    if (progress.topics[t.id] && !force) {
      totalCached++;
      continue;
    }
    toTranslate.push(t);
  }

  if (limit) toTranslate.length = Math.min(toTranslate.length, limit);

  console.log(`\n📝 Topics: ${pending.length} 个中待翻译 ${toTranslate.length} 个（跳过 ${pending.length - toTranslate.length}）`);

  if (toTranslate.length === 0) return;

  let flushCounter = 0;
  const errors = await pool(toTranslate, async (topic) => {
    // 并发翻译所有字段
    const [nameZh, descZh, assessmentZh] = await Promise.all([
      translate(topic.name),
      translate(topic.description || ''),
      topic.assessmentPrompt ? translate(topic.assessmentPrompt) : Promise.resolve(null),
    ]);
    // evidence 并发翻译
    const evidenceZh = topic.evidence && topic.evidence.length > 0
      ? await Promise.all(topic.evidence.map(ev => translate(ev)))
      : [];

    totalRequests += 1 + 1 + evidenceZh.length + (assessmentZh ? 1 : 0);

    progress.topics[topic.id] = {
      id: topic.id,
      name: nameZh,
      description: descZh,
      evidence: evidenceZh,
      assessmentPrompt: assessmentZh,
      cnStandards: [],
      translationStatus: 'machine',
    };

    flushCounter++;
    if (flushCounter % 20 === 0) saveProgress();
  }, concurrency, 'Topics');

  saveProgress();
  if (errors.length) console.log(`  ⚠️  ${errors.length} 个 topic 翻译出错（已保留英文原文）`);
}

// --- 翻译 dependencies ----------------------------------------------------
async function translateDeps() {
  if (noDeps) {
    console.log('\n🔗 Dependencies: --no-deps 跳过');
    return;
  }

  const zhDepSet = new Set();
  for (const d of zhDeps.dependencies) {
    zhDepSet.add(`${d.topicId}->${d.prerequisiteId}`);
  }

  const topicMap = new Map(upstreamTopics.topics.map(t => [t.id, t]));

  const toTranslate = [];
  for (const d of upstreamDeps.dependencies) {
    const key = `${d.topicId}->${d.prerequisiteId}`;
    if (zhDepSet.has(key) && !force) continue;
    if (progress.deps[key] && !force) {
      totalCached++;
      continue;
    }
    if (subjectFilter) {
      const t = topicMap.get(d.topicId);
      if (!t || t.subject !== subjectFilter) continue;
    }
    toTranslate.push(d);
  }

  console.log(`\n🔗 Dependencies: 待翻译 ${toTranslate.length} 条`);

  if (toTranslate.length === 0) return;

  let flushCounter = 0;
  const errors = await pool(toTranslate, async (dep) => {
    const reasonZh = dep.reason ? await translate(dep.reason) : null;
    totalRequests++;

    progress.deps[`${dep.topicId}->${dep.prerequisiteId}`] = {
      topicId: dep.topicId,
      prerequisiteId: dep.prerequisiteId,
      strength: dep.strength,
      reason: reasonZh,
    };

    flushCounter++;
    if (flushCounter % 50 === 0) saveProgress();
  }, concurrency, 'Deps');

  saveProgress();
  if (errors.length) console.log(`  ⚠️  ${errors.length} 条 dep 翻译出错`);
}

// --- 写入最终文件 ---------------------------------------------------------
function writeOutput() {
  if (dryRun) {
    console.log('\n🏃 dry-run：不写入文件。样本预览：');
    const samples = Object.values(progress.topics).slice(0, 5);
    for (const s of samples) {
      console.log(`\n  ${s.id}: ${s.name}`);
      console.log(`    ${s.description}`);
      if (s.evidence[0]) console.log(`    证据[0]: ${s.evidence[0]}`);
    }
    return;
  }

  // --- 合并 topics.zh.json ---
  const zhById = new Map();
  for (const t of zhTopics.topics) zhById.set(t.id, t);

  const finalTopics = [];
  const seenIds = new Set();

  for (const up of upstreamTopics.topics) {
    const id = up.id;
    let topic = null;

    const existing = zhById.get(id);
    if (existing && existing.translationStatus === 'reviewed') {
      topic = existing;
    } else if (progress.topics[id]) {
      topic = progress.topics[id];
    } else if (existing) {
      topic = existing;
    } else {
      continue;
    }

    finalTopics.push(topic);
    seenIds.add(id);
  }

  // 孤儿（zh 有但上游没有）
  for (const t of zhTopics.topics) {
    if (!seenIds.has(t.id)) finalTopics.push(t);
  }

  const output = {
    version: zhTopics.version,
    upstreamVersion: upstreamTopics.version,
    locale: 'zh-CN',
    topicCount: finalTopics.length,
    topics: finalTopics,
  };

  writeFileSync(resolve(DATA, 'topics.zh.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(`\n✓ topics.zh.json: ${finalTopics.length} 条`);

  // --- 合并 dependencies.zh.json ---
  const zhDepMap = new Map();
  for (const d of zhDeps.dependencies) {
    zhDepMap.set(`${d.topicId}->${d.prerequisiteId}`, d);
  }

  const finalDeps = [];
  for (const d of upstreamDeps.dependencies) {
    const key = `${d.topicId}->${d.prerequisiteId}`;
    if (progress.deps[key]) {
      finalDeps.push(progress.deps[key]);
    } else if (zhDepMap.has(key)) {
      finalDeps.push(zhDepMap.get(key));
    } else {
      finalDeps.push({ topicId: d.topicId, prerequisiteId: d.prerequisiteId, strength: d.strength, reason: d.reason });
    }
  }

  const depOutput = {
    version: zhDeps.version,
    upstreamVersion: upstreamDeps.version,
    edgeCount: finalDeps.length,
    dependencies: finalDeps,
  };

  writeFileSync(resolve(DATA, 'dependencies.zh.json'), JSON.stringify(depOutput, null, 2) + '\n');
  console.log(`✓ dependencies.zh.json: ${finalDeps.length} 条`);
}

// --- 主流程 ----------------------------------------------------------------
(async () => {
  console.log('═══════════════════════════════════════════════');
  console.log('  翻译流水线 · Google(免费) + MyMemory(备选)');
  console.log('═══════════════════════════════════════════════');
  if (subjectFilter) console.log(`  学科筛选: ${subjectFilter}`);
  if (limit) console.log(`  数量限制: ${limit}`);
  if (dryRun) console.log('  模式: dry-run（不写入）');
  if (force) console.log('  模式: force（覆盖已翻译）');
  console.log(`  并发数: ${concurrency}`);
  console.log(`  上游: ${upstreamPath}`);
  console.log('');

  const startTime = Date.now();

  await translateTopics();
  await translateDeps();
  writeOutput();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n───────────────────────────────────────────────`);
  console.log(`  完成！耗时 ${elapsed}s`);
  console.log(`  API 请求: ${totalRequests}  失败: ${totalFailed}`);
  console.log(`  下一步: node scripts/checksum.mjs && node scripts/validate.mjs`);
  console.log('');
})();
