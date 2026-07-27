#!/usr/bin/env node
/**
 * translate-clusters.mjs — 翻译上游领域聚类摘要为中文。
 *
 *   node scripts/translate-clusters.mjs --dry-run
 *   node scripts/translate-clusters.mjs --concurrency 3
 *   node scripts/translate-clusters.mjs --force
 *
 * 每个 cluster 的稳定键是 subject|domain|ageRangeStart。已有 matching 译文不会覆盖；
 * 本地 orphan 自动移除，防止 serve 在加载上游时静默丢弃它。进度存在 gitignored
 * data/.translate-clusters-progress.json，故中断后可续跑。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const PROGRESS = resolve(DATA, '.translate-clusters-progress.json');
const args = process.argv.slice(2);
const option = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] || fallback;
};
const dryRun = args.includes('--dry-run');
const force = args.includes('--force');
const concurrency = Number(option('--concurrency', '3'));
const upstreamRoot = option('--upstream', resolve(ROOT, '..', 'os-taxonomy'));
const load = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));

export const clusterKey = (cluster) => `${cluster.subject}|${cluster.domain}|${cluster.ageRangeStart}`;

export function buildClusterOutput({ upstreamClusters, currentClusters, generated }) {
  const current = new Map(currentClusters.clusters.map(cluster => [clusterKey(cluster), cluster]));
  const clusters = upstreamClusters.clusters.map(upstream => {
    const key = clusterKey(upstream);
    const existing = current.get(key);
    // 既有匹配译文是人工历史资产，绝不覆盖；orphan 不在 upstream 遍历中，天然被剔除。
    if (existing) return existing;
    const translation = generated.get(key);
    if (!translation) throw new Error(`缺少 cluster 翻译: ${key}`);
    return {
      subject: upstream.subject,
      domain: upstream.domain,
      domainZh: translation.domainZh,
      ageRangeStart: upstream.ageRangeStart,
      summary: translation.summary,
      translationStatus: 'machine',
    };
  });
  return {
    version: currentClusters.version,
    upstreamVersion: upstreamClusters.version,
    clusterCount: clusters.length,
    clusters,
  };
}

const sleep = ms => new Promise(resolvePromise => setTimeout(resolvePromise, ms));
async function google(text) {
  const url = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-CN&dt=t&q=' + encodeURIComponent(text);
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Google HTTP ${response.status}`);
  const json = await response.json();
  const result = (json[0] ?? []).map(part => part[0] ?? '').join('');
  if (!result) throw new Error('Google empty response');
  return result;
}
async function myMemory(text) {
  const url = 'https://api.mymemory.translated.net/get?langpair=en|zh-CN&q=' + encodeURIComponent(text.slice(0, 500));
  const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`MyMemory HTTP ${response.status}`);
  const result = (await response.json()).responseData?.translatedText;
  if (!result || result.includes('MYMEMORY WARNING')) throw new Error('MyMemory empty response');
  return result;
}
async function translate(text) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await google(text); }
    catch (error) { if (attempt < 2) await sleep(800 * (2 ** attempt)); }
  }
  return myMemory(text);
}

async function main() {
  const upstreamData = resolve(upstreamRoot, 'data');
  if (!existsSync(resolve(upstreamData, 'clusters.json'))) throw new Error(`找不到上游 ${upstreamData}/clusters.json`);
  const upstream = load(upstreamData, 'clusters.json');
  const current = load(DATA, 'clusters.zh.json');
  const progress = existsSync(PROGRESS) && !force ? JSON.parse(readFileSync(PROGRESS, 'utf8')) : {};
  const currentByKey = new Map(current.clusters.map(cluster => [clusterKey(cluster), cluster]));
  const pending = upstream.clusters.filter(cluster => !currentByKey.has(clusterKey(cluster)));
  console.log(`领域聚类：上游 ${upstream.clusters.length}，待翻译 ${pending.length}，保留已有译文 ${upstream.clusters.length - pending.length}`);

  let next = 0;
  async function worker() {
    while (next < pending.length) {
      const cluster = pending[next++];
      const key = clusterKey(cluster);
      if (progress[key] && !force) continue;
      progress[key] = { summary: await translate(cluster.summary), domainZh: await translate(cluster.domain) };
      if (!dryRun) writeFileSync(PROGRESS, JSON.stringify(progress, null, 2) + '\n');
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, pending.length)) }, worker));
  const output = buildClusterOutput({ upstreamClusters: upstream, currentClusters: current, generated: new Map(Object.entries(progress)) });
  if (dryRun) {
    console.log(JSON.stringify(output.clusters.slice(0, 3), null, 2));
    return;
  }
  writeFileSync(resolve(DATA, 'clusters.zh.json'), JSON.stringify(output, null, 2) + '\n');
  const retained = current.clusters.filter(cluster => upstream.clusters.some(upstreamCluster => clusterKey(upstreamCluster) === clusterKey(cluster))).length;
  console.log(`✓ clusters.zh.json: ${output.clusterCount} 条（已移除 ${current.clusterCount - retained} 条 orphan）`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`Fatal: ${error.message}`); process.exit(1); });
}
