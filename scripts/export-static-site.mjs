#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = name => {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
};
const upstream = resolve(argument('--upstream') || resolve(root, '..', 'os-taxonomy'));
const out = resolve(argument('--out') || resolve(root, 'dist'));
const basePath = argument('--base-path') || '/';
if (!existsSync(resolve(upstream, 'data', 'topics.json'))) throw new Error(`Static export requires upstream data: ${upstream}`);

process.argv.push('--upstream', upstream);
const { apiResponse } = await import('./serve.mjs');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(resolve(root, 'viewer'), out, { recursive: true });

const writeJson = (file, value) => {
  const path = resolve(out, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
};
const dimensions = apiResponse('/api/dimensions', '');
const readPaths = ['/api/dimensions', '/api/summary', '/api/topics', '/api/clusters', '/api/standards', '/api/subjects', '/api/path-data', '/api/textbook-gaps'];
for (const path of readPaths) writeJson(`${path.slice(1)}.json`, apiResponse(path, ''));
const topicIds = new Set();
for (const dimension of Object.keys(dimensions.dimensions)) {
  for (const path of ['/api/summary', '/api/topics', '/api/subjects']) writeJson(`${path.slice(1)}.${dimension}.json`, apiResponse(path, `?dimension=${encodeURIComponent(dimension)}`));
  for (const topic of apiResponse('/api/topics', `?dimension=${encodeURIComponent(dimension)}`).topics) topicIds.add(topic.id);
}
for (const id of topicIds) {
  for (const dimension of Object.keys(dimensions.dimensions)) writeJson(`api/topic/${encodeURIComponent(id)}.${dimension}.json`, apiResponse(`/api/topic/${encodeURIComponent(id)}`, `?dimension=${encodeURIComponent(dimension)}`));
}

const config = `<script>window.BST_STATIC_CONFIG={basePath:${JSON.stringify(basePath)},static:true};</script><script type="module" src="./static-runtime.js"></script>`;
let index = readFileSync(resolve(out, 'index.html'), 'utf8');
index = index.replace('<head>', `<head>${config}`)
  .replaceAll('"/static/', '"./')
  .replace('"/service-worker.js"', '"./service-worker.js"')
  .replace("navigator.serviceWorker.register('/service-worker.js', { scope: '/' })", "navigator.serviceWorker.register('./service-worker.js', { scope: './' })")
  .replace(/<div class="panel">[\s\S]*?<\/div>\n\n\n<!-- 图谱探索 -->/, '<!-- 图谱探索 -->')
  .replace(/<p>2\. <b>AI 功能会把必要输入发给大模型。<\/b>[\s\S]*?<\/p>\n      <p>3\. <b>AI 结果仅供参考。<\/b>[\s\S]*?<\/p>\n      <p>4\./, '<p>2. 本静态版不提供 AI 功能，所有档案与掌握记录只保存在浏览器本地。</p>\n      <p>3.');
index = index.replace('</head>', '<link rel="stylesheet" href="./static-mode.css"></head>');
writeFileSync(resolve(out, 'static-mode.css'), '#mark-btn, #mark-input, #mark-input + .mark-hint, #mobile-ai-open, #mobile-ai-mask { display: none !important; }');
writeFileSync(resolve(out, 'service-worker.js'), `const VERSION = 'bst-static-v2';
const CACHE = VERSION + '-cache';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.filter(name => name.startsWith('bst-') && name !== CACHE).map(name => caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (cached) return cached;
    const response = await fetch(event.request);
    if (response.ok) await cache.put(event.request, response.clone());
    return response;
  })());
});`);
writeFileSync(resolve(out, 'index.html'), index);
writeFileSync(resolve(out, '.nojekyll'), '');
console.log(`Static site exported to ${out}`);
