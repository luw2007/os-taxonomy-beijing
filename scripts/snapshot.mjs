#!/usr/bin/env node
/**
 * snapshot.mjs — 把核心数据文件快照到 data/.snapshots/<时间戳>-<标签>/。
 *
 *   node scripts/snapshot.mjs                       # 默认标签 "manual"
 *   node scripts/snapshot.mjs --label pre-v1.2      # 自定义标签
 *   node scripts/snapshot.mjs --tag data-snapshot-x # 同时打 git tag
 *   node scripts/snapshot.mjs --list                # 列出所有快照
 *   node scripts/snapshot.mjs --diff <snapshot-dir> # 对比当前数据与某快照
 *
 * 快照目录里每个文件保留原始副本，外加一个 SNAPSHOT.json 元数据文件
 * （时间戳、标签、每个文件的 bytes/sha256、git HEAD、可选 git tag）。
 * 快照目录在 .gitignore 中，不入版本库。
 *
 * 零外部依赖：仅用 node:crypto / node:fs / node:child_process。
 */

import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const SNAPSHOTS_DIR = resolve(DATA, '.snapshots');

// 默认快照的文件清单（hardcode，与 manifest.json 校验范围一致的核心数据文件）
const FILES = [
  'cn-topics.json',
  'cn-dependencies.json',
  'cn-bridge-dependencies.json',
  'dependencies.zh.json',
  'topics.zh.json',
  'clusters.zh.json',
  'manifest.json',
];

// --- 参数解析 ----------------------------------------------------------------
const argv = process.argv.slice(2);
const argValue = (flag) => {
  const i = argv.indexOf(flag);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};
const hasFlag = (flag) => argv.includes(flag);

const label = argValue('--label') || 'manual';
const tag = argValue('--tag');
const list = hasFlag('--list');
// --diff 后跟快照目录（相对或绝对路径均可）
const diffTarget = argValue('--diff');

// --- 工具函数 ----------------------------------------------------------------

// 生成北京时间（UTC+8）的 ISO 字符串，保留时区后缀
function nowIsoCn() {
  const tzOffsetMs = 8 * 60 * 60 * 1000;
  const cn = new Date(new Date().getTime() + tzOffsetMs);
  // 借助 toISOString 切到 "YYYY-MM-DDTHH:mm:ss.sss"，再补 +08:00
  return cn.toISOString().replace('Z', '+08:00');
}

// 格式化时间戳用于目录名：YYYYMMDD-HHMMSS（基于 UTC+8）
function timestampForDir() {
  const tzOffsetMs = 8 * 60 * 60 * 1000;
  const cn = new Date(new Date().getTime() + tzOffsetMs);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `${cn.getUTCFullYear()}${p(cn.getUTCMonth() + 1)}${p(cn.getUTCDate())}` +
    `-${p(cn.getUTCHours())}${p(cn.getUTCMinutes())}${p(cn.getUTCSeconds())}`
  );
}

// 把 label 里的非 [a-zA-Z0-9._-] 字符替换成 -
function sanitizeLabel(s) {
  return s.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'manual';
}

// 计算文件 sha256 + 字节数
function hashFile(absPath) {
  const bytes = readFileSync(absPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  return { bytes: bytes.length, sha256 };
}

// 读取 git HEAD（失败返回 null，例如未初始化或未提交）
function gitHead() {
  try {
    return execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    return null;
  }
}

// 打 git annotated tag；已存在则跳过
function gitCreateTag(tagName, message) {
  try {
    const existing = execSync(`git tag -l ${JSON.stringify(tagName)}`, {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'],
    }).toString().trim();
    if (existing) {
      console.log(`ℹ️  git tag 已存在，跳过: ${tagName}`);
      return;
    }
    execSync(`git tag -a ${JSON.stringify(tagName)} -m ${JSON.stringify(message)}`, {
      cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'],
    });
    console.log(`✓ 已打 git tag: ${tagName}`);
  } catch (e) {
    console.error(`✗ 打 git tag 失败: ${tagName}（${e.message.split('\n')[0]}）`);
  }
}

// 从快照目录读边数/节点数（用于 --list / --diff 摘要）
function readSnapshotCounts(snapDir) {
  const out = { edges: null, nodes: null };
  try {
    const deps = JSON.parse(readFileSync(resolve(snapDir, 'cn-dependencies.json'), 'utf8'));
    out.edges = Array.isArray(deps.dependencies) ? deps.dependencies.length
      : (typeof deps.edgeCount === 'number' ? deps.edgeCount : null);
  } catch { /* 缺失或损坏时保持 null */ }
  try {
    const topics = JSON.parse(readFileSync(resolve(snapDir, 'cn-topics.json'), 'utf8'));
    out.nodes = Array.isArray(topics.topics) ? topics.topics.length
      : (typeof topics.topicCount === 'number' ? topics.topicCount : null);
  } catch { /* 缺失或损坏时保持 null */ }
  return out;
}

// 从快照目录解析元数据（优先 SNAPSHOT.json，缺失则从目录名/文件推断）
function loadSnapshotMeta(snapDir) {
  const name = basename(snapDir);
  const metaPath = resolve(snapDir, 'SNAPSHOT.json');
  let meta = null;
  if (existsSync(metaPath)) {
    try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch { meta = null; }
  }
  // 目录名形如 20260720-121037-pre-v1.1
  const m = name.match(/^(\d{8})-(\d{6})-(.*)$/);
  let labelFromName = meta?.label ?? (m ? m[3] : name);
  let ts = meta?.timestamp ?? null;
  if (!ts && m) {
    const d = m[1], t = m[2];
    ts = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` +
      `T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}+08:00`;
  }
  const counts = readSnapshotCounts(snapDir);
  return { dir: snapDir, name, label: labelFromName, timestamp: ts, counts, meta };
}

// 列出所有快照目录（按目录名升序）
function listSnapshotDirs() {
  if (!existsSync(SNAPSHOTS_DIR)) return [];
  return readdirSync(SNAPSHOTS_DIR)
    .filter((n) => {
      const p = resolve(SNAPSHOTS_DIR, n);
      return statSync(p).isDirectory() && /^[0-9]{8}-[0-9]{6}-/.test(n);
    })
    .sort();
}

// 格式化 ISO 时间戳为 YYYY-MM-DD HH:mm:ss（用于表格展示）
function fmtShort(iso) {
  if (!iso) return '—';
  const m = iso.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : iso;
}

// --- 子命令：--list ----------------------------------------------------------
function cmdList() {
  const dirs = listSnapshotDirs();
  if (!dirs.length) {
    console.log('（暂无快照）');
    return;
  }
  const rows = dirs.map((n) => loadSnapshotMeta(resolve(SNAPSHOTS_DIR, n)));
  // 表头（中文对齐用 padEnd，中文字符宽度不完全精确但可读）
  console.log(
    '快照目录'.padEnd(40),
    '标签'.padEnd(14),
    '创建时间'.padEnd(20),
    '边数'.padStart(6),
    '节点数'.padStart(6),
  );
  for (const r of rows) {
    console.log(
      r.name.padEnd(40),
      (r.label || '—').padEnd(14),
      fmtShort(r.timestamp).padEnd(20),
      (r.counts.edges ?? '—').toString().padStart(6),
      (r.counts.nodes ?? '—').toString().padStart(6),
    );
  }
}

// --- 子命令：--diff ----------------------------------------------------------
function cmdDiff(target) {
  if (!target) {
    console.error('用法: node scripts/snapshot.mjs --diff <snapshot-dir>');
    process.exit(1);
  }
  const snapDir = resolve(target);
  if (!existsSync(snapDir)) {
    console.error(`✗ 快照目录不存在: ${snapDir}`);
    process.exit(1);
  }
  const snap = loadSnapshotMeta(snapDir);

  console.log(`对比快照: ${snap.name} (标签 ${snap.label || '—'})`);
  console.log(`快照时间: ${fmtShort(snap.timestamp)}`);
  if (snap.meta?.gitHead) console.log(`快照 git HEAD: ${snap.meta.gitHead}`);
  console.log('');

  // 1. 边数 / 节点数
  const curCounts = readSnapshotCounts(DATA);
  const dEdges = (curCounts.edges ?? 0) - (snap.counts.edges ?? 0);
  const dNodes = (curCounts.nodes ?? 0) - (snap.counts.nodes ?? 0);
  console.log('=== 计数 ===');
  console.log(`  节点数: ${snap.counts.nodes ?? '—'} → ${curCounts.nodes ?? '—'}  (${
    dNodes === 0 ? '无变化' : (dNodes > 0 ? `+${dNodes}` : `${dNodes}`)
  })`);
  console.log(`  边  数: ${snap.counts.edges ?? '—'} → ${curCounts.edges ?? '—'}  (${
    dEdges === 0 ? '无变化' : (dEdges > 0 ? `+${dEdges}` : `${dEdges}`)
  })`);
  console.log('');

  // 2. 逐文件 sha256 对比
  console.log('=== 文件 sha256 ===');
  let changed = 0, missing = 0;
  for (const name of FILES) {
    const snapFile = resolve(snapDir, name);
    const curFile = resolve(DATA, name);
    if (!existsSync(curFile)) {
      console.log(`  ${name.padEnd(32)} 当前缺失`);
      missing++;
      continue;
    }
    if (!existsSync(snapFile)) {
      console.log(`  ${name.padEnd(32)} 快照缺失`);
      continue;
    }
    const snapSha = createHash('sha256').update(readFileSync(snapFile)).digest('hex');
    const curSha = createHash('sha256').update(readFileSync(curFile)).digest('hex');
    const same = snapSha === curSha;
    if (!same) changed++;
    console.log(
      `  ${name.padEnd(32)} ${same ? '相同' : '已变化'}  ${curSha.slice(0, 12)}…`
      + (same ? '' : `  (快照 ${snapSha.slice(0, 12)}…)`),
    );
  }
  console.log('');
  console.log(changed === 0 && missing === 0
    ? '✓ 所有快照内文件内容均未变化'
    : `⚠️  ${changed} 个文件相对快照已变化${missing ? `，${missing} 个当前缺失` : ''}`);
}

// --- 子命令：默认（创建快照）-------------------------------------------------
function cmdCreate() {
  if (!existsSync(SNAPSHOTS_DIR)) mkdirSync(SNAPSHOTS_DIR, { recursive: true });

  const stamp = timestampForDir();
  const dirName = `${stamp}-${sanitizeLabel(label)}`;
  const snapDir = resolve(SNAPSHOTS_DIR, dirName);

  // 防止极端情况下目录名撞车
  if (existsSync(snapDir)) {
    console.error(`✗ 快照目录已存在: ${snapDir}`);
    process.exit(1);
  }
  mkdirSync(snapDir, { recursive: true });

  // 复制文件并记录元数据
  const ts = nowIsoCn();
  const filesMeta = {};
  for (const name of FILES) {
    const src = resolve(DATA, name);
    if (!existsSync(src)) {
      console.error(`✗ 源文件缺失，无法快照: ${name}`);
      process.exit(1);
    }
    copyFileSync(src, resolve(snapDir, name));
    filesMeta[name] = hashFile(src);
  }

  const head = gitHead();
  const snapshotMeta = {
    timestamp: ts,
    label,
    createdAt: ts,
    files: filesMeta,
    gitHead: head,
  };
  if (tag) {
    gitCreateTag(tag, `data snapshot ${label} (${stamp})`);
    snapshotMeta.gitTag = tag;
  }

  // 写元数据：2 空格缩进，与项目其它脚本一致
  writeFileSync(resolve(snapDir, 'SNAPSHOT.json'), JSON.stringify(snapshotMeta, null, 2) + '\n', 'utf8');

  // 报告
  console.log(`✓ 快照已创建: data/.snapshots/${dirName}/`);
  console.log(`  标签: ${label}`);
  console.log(`  时间: ${ts}`);
  if (head) console.log(`  git HEAD: ${head}`);
  const counts = readSnapshotCounts(snapDir);
  console.log(`  节点数: ${counts.nodes ?? '—'}    边数: ${counts.edges ?? '—'}`);
  console.log(`  文件数: ${FILES.length}`);
}

// --- 派发 -------------------------------------------------------------------
if (list) {
  cmdList();
} else if (diffTarget !== null) {
  cmdDiff(diffTarget);
} else {
  cmdCreate();
}
