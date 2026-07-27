#!/usr/bin/env node
/**
 * migrate-review-provenance.mjs — 给已有审核结论的边补 reviewProvenance（证据等级）。
 *
 *   node scripts/migrate-review-provenance.mjs --dry-run   # 只打印统计，不写盘
 *   node scripts/migrate-review-provenance.mjs             # 写盘（幂等，可重复执行）
 *
 * 映射规则（只依据 reviewStatus 与 reviewedBy 两个字段，绝不解析 reason 文本——
 * 65 条命中规则模板文案的 machine 边就是反例，见 docs/plans/…-planA.md §0.3）：
 *   reviewStatus=machine                              → 不打标（未经任何审核）
 *   reviewedBy=user-delegated-claude-opus-consensus    → ai-consensus
 *   reviewStatus=reviewed 且无 reviewedBy（cn-dependencies.json）      → rule（规则脚本产出即发布态）
 *   reviewStatus=reviewed 且无 reviewedBy（cn-bridge-dependencies.json）→ human
 *     43 条 legacy 桥接边是提交 10e1ee9 引入的人工数据（文件 note 自述"人工精选"），
 *     补可核验（非编造）的逐边审计字面量：reviewedBy='project-curation'、
 *     reviewedAt=该提交的 author date。不现跑 git log——CI 用 actions/checkout 默认
 *     浅克隆，历史提交未必可达，运行时调用会让 CI 随机失败。
 *   reviewStatus=rejected 且无 reviewedBy              → 报错退出（数据异常，当前应为 0 条）
 *   reviewedBy 为其他未知取值                           → 报错退出（迁移脚本只认识上面这一档审核人）
 *
 * 幂等性：已带合法 reviewProvenance 的边直接跳过（不重新从 reviewedBy 推导），
 * 因为 bridge 边首次迁移后 reviewedBy 会从缺失变为注入的字面量，若每次都重新推导，
 * 第二次运行会把已知的 'project-curation' 当作未知 reviewedBy 报错。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { REVIEW_PROVENANCE } from './review-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');

const REVIEW_PROVENANCE_SET = new Set(REVIEW_PROVENANCE);
export const AI_CONSENSUS_REVIEWER = 'user-delegated-claude-opus-consensus';
// bridge 43 条 legacy 边的可核验审计字面量：来自提交 10e1ee9 的 author date（终裁决议 #1）。
export const BRIDGE_CURATION_REVIEWER = 'project-curation';
export const BRIDGE_CURATION_REVIEWED_AT = '2026-07-17T22:15:08+08:00';

/**
 * 单条边的 provenance 迁移。isBridge 决定"reviewed 且无 reviewedBy"落在哪一档。
 * 返回 { edge, bucket }：bucket 用于统计，edge 是迁移后的对象（未变则原样返回同一引用）。
 */
export function migrateEdge(edge, isBridge) {
  const key = `${edge.topicId}<-${edge.prerequisiteId}`;
  const status = edge.reviewStatus ?? 'machine';

  if (status === 'machine') {
    if (edge.reviewProvenance !== undefined) throw new Error(`${key}: machine 边不得携带 reviewProvenance`);
    return { edge, bucket: 'machine' };
  }
  if (status !== 'reviewed' && status !== 'rejected') {
    throw new Error(`${key}: 非法 reviewStatus "${edge.reviewStatus}"`);
  }

  // 已迁移：以 reviewProvenance 是否存在为幂等信号。历史 project-curation bridge
  // 不是教师审核，补 curator 角色以修正此前模糊的 human 展示语义。
  if (edge.reviewProvenance !== undefined) {
    if (!REVIEW_PROVENANCE_SET.has(edge.reviewProvenance) || edge.reviewProvenance === 'upstream') {
      throw new Error(`${key}: 非法的既有 reviewProvenance "${edge.reviewProvenance}"`);
    }
    if (isBridge && edge.reviewProvenance === 'human' && edge.reviewedBy === BRIDGE_CURATION_REVIEWER && edge.reviewerRole === undefined) {
      return { edge: { ...edge, reviewerRole: 'curator' }, bucket: 'human' };
    }
    return { edge, bucket: 'alreadyStamped' };
  }

  if (edge.reviewedBy === AI_CONSENSUS_REVIEWER) {
    return { edge: { ...edge, reviewProvenance: 'ai-consensus' }, bucket: 'ai-consensus' };
  }
  if (edge.reviewedBy !== undefined) {
    throw new Error(`${key}: 无法识别的 reviewedBy "${edge.reviewedBy}"（迁移脚本只认识 ${AI_CONSENSUS_REVIEWER}）`);
  }
  if (status === 'rejected') {
    throw new Error(`${key}: rejected 边缺 reviewedBy，无法判定 provenance`);
  }
  // status === 'reviewed'，reviewedBy 缺失
  if (isBridge) {
    return {
      edge: { ...edge, reviewProvenance: 'human', reviewedBy: BRIDGE_CURATION_REVIEWER, reviewedAt: BRIDGE_CURATION_REVIEWED_AT, reviewerRole: 'curator' },
      bucket: 'human',
    };
  }
  return { edge: { ...edge, reviewProvenance: 'rule' }, bucket: 'rule' };
}

/** 迁移整份文档（dependencies 数组），返回新文档与分档统计。 */
export function migrateReviewProvenance(doc, isBridge) {
  const counts = { rule: 0, 'ai-consensus': 0, human: 0, machine: 0, alreadyStamped: 0 };
  const dependencies = doc.dependencies.map(edge => {
    const { edge: nextEdge, bucket } = migrateEdge(edge, isBridge);
    counts[bucket]++;
    return nextEdge;
  });
  return { doc: { ...doc, dependencies }, counts };
}

const TARGETS = [
  { name: 'cn-dependencies.json', isBridge: false },
  { name: 'cn-bridge-dependencies.json', isBridge: true },
];

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const results = TARGETS.map(({ name, isBridge }) => {
    const path = resolve(DATA, name);
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    const { doc: nextDoc, counts } = migrateReviewProvenance(doc, isBridge);
    return { name, path, doc: nextDoc, counts };
  });

  console.log('reviewProvenance 迁移统计:');
  for (const { name, counts } of results) {
    console.log(`  ${name}: rule=${counts.rule} ai-consensus=${counts['ai-consensus']} human=${counts.human} `
      + `machine(不打标)=${counts.machine} alreadyStamped=${counts.alreadyStamped}`);
  }

  if (dryRun) {
    console.log('\n（--dry-run 模式，未写盘）');
    return;
  }
  for (const { path, doc } of results) {
    writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  }
  console.log('\n下一步: node scripts/checksum.mjs && node scripts/validate.mjs --publish');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(`Fatal: ${error.message}`); process.exit(1); }
}
