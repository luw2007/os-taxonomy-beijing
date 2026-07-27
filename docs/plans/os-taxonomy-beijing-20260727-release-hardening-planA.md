# os-taxonomy-beijing 开源发布加固方案（Plan A）

> 日期：2026-07-27 · 范围：修复 owner review 的 6 项发现，使仓库可对外发布
> 前置：本方案的每个数字都来自第 0 节的实测，不引用文档里的旧数字
> 约束：零依赖 Node ESM；外科手术式 diff；**不得触碰 `viewer/app.js`**（用户未提交的工作）

---

## 0. 实测数据基线

以下全部由 `jq` / 一次性 Node 读脚本在当前工作树实测（2026-07-27），是后续所有映射规则和文档数字的唯一依据。

### 0.1 发布图规模（P0 的量化）

| 量 | 现状 | 修复后 |
|---|---|---|
| merged 边（upstream 3,221 + cn 2,619 + bridge 47） | 5,887 | 5,887 |
| `publishedGraph` 边（`/api/path-data`、`/api/topic/:id`） | **1,332** | **4,553** |
| merged 节点 / 发布节点（49 个 `status: covered` 被排除） | 3,598 / 3,549 | 3,598 / 3,549 |
| reviewed 但因端点为 covered 被丢弃的边 | 40 | 40 |

即：**3,221 条上游 mt_→mt_ 边 100% 掉出发布图**，与 `README.md:18`「保留图的拓扑结构不变」直接矛盾。

### 0.2 `data/cn-dependencies.json` 字段普查（2,619 条）

`reviewStatus` × `reviewedBy` × `generationBatchId`：

| reviewStatus | reviewedBy | generationBatchId | 条数 |
|---|---|---|---|
| reviewed | （无） | （无） | **985** |
| machine | （无） | （无） | 751 |
| rejected | user-delegated-claude-opus-consensus | （无） | 414 |
| reviewed | user-delegated-claude-opus-consensus | split-relations-20260721-historical | 201 |
| reviewed | user-delegated-claude-opus-consensus | （无） | 140 |
| machine | （无） | split-relations-20260721-historical | 122 |
| rejected | user-delegated-claude-opus-consensus | split-relations-20260721-historical | 6 |

合计 reviewed 1,326 / machine 873 / rejected 420 = 2,619 ✓；`reviewedBy` 非空共 **761** 条（= CHANGELOG.md:17 的「761 条内部旧边」）。

### 0.3 「reviewed 且无 reviewedBy」的 985 条是什么

按 `reason` 模板回溯生成器（模板定义见 `scripts/_rule-deps.mjs:170`、`:172-173`、`:216-217`）：

| 模板 | 生成器 | 命中 |
|---|---|---|
| `<domain> 渐进：A → B` | `buildAgeChainEdges` 同学段分支 | 903 |
| `<学段>→<学段>：A → B` | `buildAgeChainEdges` 跨学段分支 | 74 |
| 逐条手写理由（如「小学"宪法是根本大法"建立宪法概念…」） | `scripts/build-stage-bridges.mjs:37-55` 的 `BRIDGES` 硬编码表，落库时写死 `reviewStatus: 'reviewed'`（`:93`） | 8 |
| **合计** | | **985** ✓ |

**关键反例**：另有 **65 条 `reviewStatus: machine`** 的边命中 L3 模板 `<domainA> 是 <domainB> 的先修：`（`buildRuleEdges`，全部 `strength: hard`、无 batch）。也就是说「规则生成」≠「reviewed」。

→ **结论：`reviewProvenance` 记录的是「这条边的审核结论由谁背书」，不是「这条边由谁生成」。** 映射必须只看 `(reviewStatus, reviewedBy)` 两个字段，绝不能按 `reason` 文本推断，否则那 65 条未审核边会被错误地贴上 `rule` 并暗示它们已发布。

### 0.4 `data/cn-bridge-dependencies.json` 普查（47 条）

| reviewStatus | reviewedBy | 条数 | 备注 |
|---|---|---|---|
| reviewed | （无） | 43 | 脚本精选表，`reason` 形如「上游的正负数概念是中国有理数运算的知识基础」 |
| reviewed | user-delegated-claude-opus-consensus | 3 | 双 Opus 复审保留 |
| rejected | user-delegated-claude-opus-consensus | 1 | 双 Opus 复审拒绝 |

全部 `strength: soft`（对应 BACKLOG 低优先级第 3 项）。

### 0.5 文档漂移实测

| 位置 | 文档写的 | 实测真值 |
|---|---|---|
| `README.md:7` | 审核覆盖率 37.6%（985 reviewed / 1,634 machine） | 50.6%（1,326 / 873 / 420）；37.6% = 985÷2619，是双 Opus 复审**之前**的快照 |
| `README.md:235` | 50.6% | ✓ 正确（同一文件自相矛盾） |
| `BACKLOG.md:8-11` | `alignedMathLowExcluded: 68`，398 节点 / high 213 / medium 116 | `data/manifest.json` = high **215** / medium **120** / lowExcluded **109** / total **446** |
| `docs/reports/README.md:39-40, 173, 183` | cn-topics 落地 1,640 条 | **2,008**（`counts.cnTopics`） |
| `docs/reports/README.md:48-49` | origin 分布 cn_only 531 / textbook 809 / progression 154 / upstream_adapt 119 / cross_domain 27 | textbook **1,069** / cn_only **578** / progression **188** / upstream_adapt **142** / cross_domain **31** |
| `README.md:208`、`PROVENANCE.md:62,68`、`NOTICE:32` | 809 个教材来源节点，含 209 个 `nodeKind: text` | origin=textbook **1,069**；其中 nodeKind=text **290**（全库 text 节点 291） |
| `package.json:8` | `homepage: https://withmarble.com` | 上游官网，不是本项目 |
| `topics.zh.json` | —— | `translationStatus`: machine **1,586** / reviewed **4** |

`README.md:208` / `PROVENANCE.md` / `NOTICE` 的 809/209 出现在**许可证边界表述**里，属于合规文本，必须一并订正（本次 census 新发现，不在 owner 的 6 条之内，但同源同批修）。

### 0.6 负载影响实测（gzip 前后）

`/api/path-data` 的 edges 数组序列化后：现状 161,498 B（gzip 40,793 B）→ 修复后 555,705 B（gzip 181,295 B）。`scripts/serve.mjs:631-639` 已对该端点做 gzip + `max-age=3600`。

`reviewProvenance` 落库预计使 `data/cn-dependencies.json` 从 1,189,475 B 增长约 73 KB（1,746 条边 × 一行）。

---

## 1. 方案总览

六条发现 → 六条工作流，每条只做一件事：

| WS | 修的发现 | 核心决策 | 为什么是这个决策 |
|---|---|---|---|
| WS1 | ① P0 上游边掉出发布图 | 在**合并期**给 mt_→mt_ 边贴 `{reviewStatus:'reviewed', reviewProvenance:'upstream'}`；合并逻辑下沉到 `review-policy.mjs`，`serve.mjs` 与导出脚本共用 | 上游图本身就是上游的发布态，本项目从未也不打算重审 3,221 条上游边；贴在加载期而不是写进 `dependencies.zh.json`，是为了守住 `README.md:68-70`「中文文件只含翻译字段」的设计不变量 |
| WS2 | ② review provenance 混同 | 新增可选字段 `reviewProvenance: upstream\|rule\|ai-consensus\|human`；库内三值由 `scripts/migrate-review-provenance.mjs` 幂等回填；`validate.mjs` 强制不变量；`review-ai-edge.mjs` 之后每次审核自动盖章 | 外部用户必须能一眼分辨「确定性规则」「AI 委托复审」「教师审核」。只贴不校验等于没贴——所以校验和审核 CLI 必须同批改 |
| WS3 | ③ 文档统计漂移 ④ 缺 alpha 声明 | 统计真值下沉到 `data/manifest.json`（`checksum.mjs` 自动派生审核分档计数），README 状态行 + alpha 声明从 manifest 取数，并用 `scripts/test/docs-stats.test.mjs` 把「文档数字 = manifest 数字」变成可执行断言 | 手工同步必然再次漂移（v1.2 已经因此翻车一次，见 CHANGELOG.md:16）。只有可执行断言能长期防住 |
| WS4 | ⑤ 无 CI / 无 CONTRIBUTING / SECURITY | `.github/workflows/ci.yml`（node 22 + clone 上游 + `npm test` + `validate --publish --upstream` + checksum 漂移 + 导出冒烟）；`CONTRIBUTING.md` 写死 codes-only 与边审核工作流；`SECURITY.md` | codes-only 是本项目最高优先级的法律不变量（`PROVENANCE.md:39-55`），PR 通道必须有守卫 |
| WS5 | ⑥ 无互操作导出 | `scripts/export-jsonl.mjs` → `exports/nodes.jsonl` + `exports/relationships.jsonl` + `exports/manifest.json`（署名/许可证），只导发布图，`exports/` 进 gitignore，Makefile 加 target | 对齐 learning-commons 的行形状即可被现成工具消费；导出**必须**走 `publishedGraph`，否则会把 873 条未审核边泄漏成"数据集内容" |
| WS6 | ⑥ gold-set 报告过薄 | `evaluateGoldSet` 增加 `overall` + `bySubject` 聚合、tp/fp/fn、F1、分歧数；CLI 出人类可读表格，`--json` 保留原始输出；样本阈值改为可配置 | 现有实现只有 `subject\|kind` 一层且不吐混淆矩阵，无法回答"哪个学科的 AI 边最不可信" |

**跨 WS 的单一事实源**：`scripts/review-policy.mjs` 持有 `REVIEW_PROVENANCE` 枚举、`UPSTREAM_EDGE_REVIEW` 常量和 `mergeDependencies()`；`serve.mjs`、`export-jsonl.mjs`、`validate.mjs` 全部从它引用，不允许出现第二份枚举或第二套合并逻辑。

---

## 2. 分工作流设计（含核心代码）

### WS1 · 发布策略：上游边进入发布图

#### 2.1.1 `scripts/review-policy.mjs`（新增导出，现有 3 个函数原样保留）

```js
// 审核结论的证据等级。upstream 只在合并期标记，不写入 data/*.json。
export const REVIEW_PROVENANCE = Object.freeze(['upstream', 'rule', 'ai-consensus', 'human']);

// 上游 mt_→mt_ 边在上游图里即为发布态，本项目不重审，也不把该状态写回
// data/dependencies.zh.json（翻译文件只含翻译字段，见 README「关键设计」）。
export const UPSTREAM_EDGE_REVIEW = Object.freeze({ reviewStatus: 'reviewed', reviewProvenance: 'upstream' });

/**
 * 合并出完整图的全部边：上游边（中文 reason 覆盖）+ 中国内部边 + 跨图桥接边。
 * serve.mjs 与 export-jsonl.mjs 共用，避免两处合并逻辑漂移。
 */
export function mergeDependencies({ upstreamDeps, zhDeps, cnDeps, bridgeDeps }) {
  const merged = [];
  if (upstreamDeps) {
    const zhReason = new Map(zhDeps.dependencies.map(d => [`${d.topicId}->${d.prerequisiteId}`, d.reason]));
    for (const d of upstreamDeps.dependencies) {
      const reason = zhReason.get(`${d.topicId}->${d.prerequisiteId}`);
      merged.push({ ...d, ...(reason ? { reason } : null), ...UPSTREAM_EDGE_REVIEW });
    }
  } else {
    // 无上游仓库时退回中文翻译文件——同样是 mt_→mt_ 上游边，同样贴 upstream。
    for (const d of zhDeps.dependencies) merged.push({ ...d, ...UPSTREAM_EDGE_REVIEW });
  }
  if (cnDeps) merged.push(...cnDeps.dependencies);
  if (bridgeDeps) merged.push(...bridgeDeps.dependencies);
  return merged;
}
```

每条上游边只分配一个对象（与现状 `{ ...d, reason: zh.reason }` 同量级），不引入第二遍 map。

#### 2.1.2 `scripts/serve.mjs:190-213` → 6 行

```diff
@@ scripts/serve.mjs:21
-import { filterPublishedDependencies, filterPublishedTopics } from './review-policy.mjs';
+import { filterPublishedDependencies, filterPublishedTopics, mergeDependencies } from './review-policy.mjs';

@@ scripts/serve.mjs:190-213
-// 合并依赖（中文 reason 优先，上游 fallback）
-const zhDepMap = new Map();
-for (const d of zhDeps.dependencies) {
-  zhDepMap.set(`${d.topicId}->${d.prerequisiteId}`, d);
-}
-const mergedDeps = [];
-if (upstreamDeps) {
-  // 上游全量依赖 + 中文翻译覆盖
-  for (const d of upstreamDeps.dependencies) {
-    const key = `${d.topicId}->${d.prerequisiteId}`;
-    const zh = zhDepMap.get(key);
-    mergedDeps.push(zh ? { ...d, reason: zh.reason } : d);
-  }
-} else {
-  mergedDeps.push(...zhDeps.dependencies);
-}
-// 中国特有微主题的依赖（mtc_ 之间）
-if (cnDeps) {
-  mergedDeps.push(...cnDeps.dependencies);
-}
-// 上游 mt_ → 中国 mtc_ 桥接依赖
-if (cnBridgeDeps) {
-  mergedDeps.push(...cnBridgeDeps.dependencies);
-}
+// 合并依赖（中文 reason 优先，上游 fallback；上游边贴 reviewProvenance: upstream）
+const mergedDeps = mergeDependencies({ upstreamDeps, zhDeps, cnDeps, bridgeDeps: cnBridgeDeps });
```

#### 2.1.3 修掉 `serve.mjs:215-217` 的不实注释

```diff
 // --- 审核状态(reviewStatus)规范化 -----------------------------------------
-// 三态: machine(LLM/规则产出,未人工审核) / reviewed(人工通过) / rejected(人工拒绝)
+// 三态: machine(未经任何审核) / reviewed(已通过审核) / rejected(已拒绝)。
+// reviewed 不等于人工通过——证据等级看 reviewProvenance:
+//   upstream=上游发布态 / rule=确定性规则脚本 / ai-consensus=用户授权的双 Opus 复审 / human=教师审核
 // 字段缺失(老数据)按 machine 处理。rejected 永不返回给前端。
```

#### 2.1.4 `/api/summary` 增加 `publishedDeps`

`pathData`（`serve.mjs:237-260`）本身就是发布图的边视图，直接复用，零额外计算：

```diff
@@ scripts/serve.mjs:260 之后（pathData 定义之下）
+// 发布图边数(post-filter)：与 /api/path-data、export-jsonl 同口径，不随 dimension 变化。
+const publishedDepsCount = pathData.edges.length;

@@ scripts/serve.mjs:387
       totalDeps: mergedDeps.length,
+      publishedDeps: publishedDepsCount,

@@ scripts/serve.mjs:669
   console.log(`  ▸ 依赖关系:    ${mergedDeps.length} 条`);
+  console.log(`  ▸ 发布图边:    ${publishedDepsCount} 条（reviewed 且两端可发布）`);
```

`totalDeps` 保持原始合并总数不变（向后兼容），`publishedDeps` 是新增事实。viewer 侧不做任何改动。

---

### WS2 · provenance 迁移 + 校验

#### 2.2.1 映射规则（由 0.2 / 0.3 / 0.4 推导）

| 条件 | `reviewProvenance` | cn-deps 命中 | bridge 命中 |
|---|---|---|---|
| `reviewedBy === 'user-delegated-claude-opus-consensus'` | `ai-consensus` | 761（reviewed 341 + rejected 420） | 4（reviewed 3 + rejected 1） |
| `reviewStatus === 'reviewed'` 且无 `reviewedBy` | `rule` | 985 | 43 |
| `reviewStatus === 'machine'` | **不贴**（未经审核，provenance 无意义） | 873 | 0 |
| `reviewStatus === 'rejected'` 且无 `reviewedBy` | 抛错（数据异常） | 0 | 0 |
| 其他 `reviewedBy` 取值 | `human` | 0（未来的教师审核走这条） | 0 |

落库总计 **1,793 条**（cn-deps 1,746 + bridge 47），873 条 machine 边保持原样。

#### 2.2.2 `scripts/migrate-review-provenance.mjs`（新建，风格对齐 `migrate-ai-safety.mjs`）

```js
#!/usr/bin/env node
/**
 * migrate-review-provenance.mjs — 给已有审核结论的边补 reviewProvenance（证据等级）。
 *
 *   node scripts/migrate-review-provenance.mjs --dry-run   # 只报告分布，不写盘
 *   node scripts/migrate-review-provenance.mjs             # 写盘（幂等，可重复执行）
 *
 * 映射规则（由 2026-07-27 全量字段普查推导，见 docs/plans/…-planA.md 第 0 节）：
 *   reviewedBy 存在                       → ai-consensus（当前唯一取值）/ 其他审核人 → human
 *   reviewStatus=reviewed 且无 reviewedBy → rule（规则脚本产出即发布态，985+43 条）
 *   reviewStatus=machine                  → 不贴（未经任何审核）
 * 故意不按 reason 文本推断生成器：65 条命中规则模板的边其实是 machine，
 * provenance 记录的是"审核结论由谁背书"，不是"这条边由谁生成"。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const AI_CONSENSUS_REVIEWER = 'user-delegated-claude-opus-consensus';

export function provenanceOf(edge) {
  const status = edge.reviewStatus ?? 'machine';
  if (status === 'machine') return null;
  if (edge.reviewedBy) return edge.reviewedBy === AI_CONSENSUS_REVIEWER ? 'ai-consensus' : 'human';
  if (status === 'reviewed') return 'rule';
  throw new Error(`${edge.topicId}<-${edge.prerequisiteId}: rejected 边缺 reviewedBy，无法判定 provenance`);
}

export function migrateReviewProvenance(doc) {
  const stats = { rule: 0, 'ai-consensus': 0, human: 0, alreadyStamped: 0, skippedMachine: 0 };
  const dependencies = doc.dependencies.map(edge => {
    const provenance = provenanceOf(edge);
    if (!provenance) {
      if (edge.reviewProvenance) throw new Error(`${edge.topicId}<-${edge.prerequisiteId}: machine 边不得带 reviewProvenance`);
      stats.skippedMachine++;
      return edge;
    }
    if (edge.reviewProvenance === provenance) { stats.alreadyStamped++; return edge; }
    if (edge.reviewProvenance) {
      throw new Error(`${edge.topicId}<-${edge.prerequisiteId}: 已有 reviewProvenance ${edge.reviewProvenance}，与推导值 ${provenance} 冲突`);
    }
    stats[provenance]++;
    return { ...edge, reviewProvenance: provenance };   // 追加到边对象末尾，diff 每条只多一行
  });
  return { doc: { ...doc, dependencies }, stats };
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const targets = ['cn-dependencies.json', 'cn-bridge-dependencies.json'];
  for (const name of targets) {
    const path = resolve(DATA, name);
    const { doc, stats } = migrateReviewProvenance(JSON.parse(readFileSync(path, 'utf8')));
    console.log(`${name}: ${JSON.stringify(stats)}`);
    if (!dryRun) writeFileSync(path, JSON.stringify(doc, null, 2) + '\n');
  }
  if (!dryRun) console.log('\n下一步: node scripts/checksum.mjs && node scripts/validate.mjs --publish');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(`Fatal: ${error.message}`); process.exit(1); }
}
```

幂等性由 `alreadyStamped` 分支保证（第二次运行 stats 全部落在 `alreadyStamped`/`skippedMachine`，写盘内容逐字节相同）。`{ ...doc, dependencies }` 保持顶层键顺序，`generationBatches` 位置不变。

首次运行的预期输出：

```
cn-dependencies.json: {"rule":985,"ai-consensus":761,"human":0,"alreadyStamped":0,"skippedMachine":873}
cn-bridge-dependencies.json: {"rule":43,"ai-consensus":4,"human":0,"alreadyStamped":0,"skippedMachine":0}
```

#### 2.2.3 `schema/cn-dependencies.schema.json`（`additionalProperties: false`，必须同步）

```diff
@@ schema/cn-dependencies.schema.json:55 之后
           }
+          ,"reviewProvenance": {
+            "type": "string",
+            "enum": ["rule", "ai-consensus", "human"],
+            "description": "审核结论的证据等级：rule=确定性规则脚本产出；ai-consensus=用户授权的双 Opus 复审；human=教师审核。仅当 reviewStatus 为 reviewed/rejected 时出现。upstream 只在服务端合并期标记，不入库。"
+          }
           ,"rescopeRequired": { "type": "boolean", … },
```

同时把 `description`（`:5`）里「reviewed=已审核」的表述改成「reviewed=已通过审核（证据等级见 reviewProvenance）」。

#### 2.2.4 `scripts/validate.mjs` 不变量

选择的四条不变量与理由：

1. **枚举合法** — 显然。
2. **`reviewProvenance` 要求终态 `reviewStatus`（reviewed / rejected）** — provenance 是"审核结论的背书"，没有结论就没有背书；反过来 machine 边带 provenance 会让消费者误以为它被审过。
3. **`upstream` 不得入库** — 它是合并期的运行时事实（上游图的状态），写进数据文件就变成本项目对上游的断言，且会在上游改图时静默过期。
4. **`rule` ⟺ 无 `reviewedBy`** — 规则边没有审核人；反之 `ai-consensus`/`human` 必须有审核人（与现有 `hasReviewAudit` 校验形成闭环）。
5. **终态边必须有 provenance** — 迁移后 100% 覆盖，这条把"新边不许无证据等级"变成硬约束。放在**基础校验**而非 `--publish`，因为 rejected 边不进发布图但同样需要可追溯。

```diff
@@ scripts/validate.mjs:26 附近（import 区）
+import { REVIEW_PROVENANCE } from './review-policy.mjs';

@@ scripts/validate.mjs:136
 const VALID_REVIEW_STATUS = new Set(['machine', 'reviewed', 'rejected']);
+const VALID_REVIEW_PROVENANCE = new Set(REVIEW_PROVENANCE);
+
+// reviewProvenance 不变量（cn-deps 与 bridge 共用）
+function checkReviewProvenance(edge, status, label) {
+  const key = `${label} ${edge.topicId}->${edge.prerequisiteId}`;
+  if (edge.reviewProvenance === undefined) {
+    check(status === 'machine',
+      `${key}: ${status} 边缺 reviewProvenance（运行 node scripts/migrate-review-provenance.mjs）`);
+    return;
+  }
+  check(VALID_REVIEW_PROVENANCE.has(edge.reviewProvenance),
+    `${key}: illegal reviewProvenance "${edge.reviewProvenance}"`);
+  check(edge.reviewProvenance !== 'upstream',
+    `${key}: upstream 只在合并期标记，不得写入数据文件`);
+  check(status === 'reviewed' || status === 'rejected',
+    `${key}: reviewProvenance 需要终态 reviewStatus（当前 ${status}）`);
+  check((edge.reviewProvenance === 'rule') === (edge.reviewedBy === undefined),
+    `${key}: rule 边不得有 reviewedBy；ai-consensus/human 边必须有 reviewedBy`);
+}
```

调用点（两处，各一行）：

```diff
@@ scripts/validate.mjs:229 之后（cn-deps 4c 循环内，紧跟 hasReviewAudit 块）
+    checkReviewProvenance(d, rs, 'cn-dep');

@@ scripts/validate.mjs:305 之后（cn-bridge 4d 循环内）
+    checkReviewProvenance(d, bridgeReviewStatus, 'cn-bridge');
```

`scripts/publication-safety.mjs` **不动**：它只负责 rescope 与 centrality 一致性，provenance 由上面这条硬约束在更早的阶段拦掉，不做重复校验。

#### 2.2.5 `scripts/review-ai-edge.mjs`：以后每次审核自动盖章

不改这里的话，第一条教师审核就会撞上 2.2.4 的不变量。

```diff
@@ scripts/review-ai-edge.mjs:9
+// 审核 CLI 只产出带审核人的两档证据；rule/upstream 由脚本与合并期负责，不允许人工声明。
+const REVIEWER_PROVENANCE = new Set(['human', 'ai-consensus']);
+
 export function reviewEdge(edge, decision) {
   if (!['reviewed', 'rejected'].includes(decision?.status)) throw new Error('status 必须为 reviewed 或 rejected');
   if (typeof decision.reviewer !== 'string' || !decision.reviewer.trim()) throw new Error('reviewer 不能为空');
+  const provenance = decision.provenance || 'human';
+  if (!REVIEWER_PROVENANCE.has(provenance)) throw new Error('provenance 必须为 human 或 ai-consensus');
   const reviewed = {
     ...edge,
     reviewStatus: decision.status,
     reviewedBy: decision.reviewer.trim(),
     reviewedAt: decision.reviewedAt || new Date().toISOString(),
     ...(decision.note?.trim() ? { reviewNote: decision.note.trim() } : {}),
+    reviewProvenance: provenance,
   };

@@ scripts/review-ai-edge.mjs:37（main 内）
   const note = opt(argv, '--note');
+  const provenance = opt(argv, '--provenance');
@@ scripts/review-ai-edge.mjs:46
-  doc.dependencies[index] = reviewEdge(doc.dependencies[index], { status, reviewer, note });
+  doc.dependencies[index] = reviewEdge(doc.dependencies[index], { status, reviewer, note, provenance });
```

默认 `human` 是刻意的：这个 CLI 就是给教师用的，AI 批量复审走的是一次性脚本。

---

### WS3 · 文档与统计同步

#### 2.3.1 统计真值下沉到 manifest（`scripts/checksum.mjs`）

```diff
@@ scripts/checksum.mjs:32
-export function deriveManifestCounts({ topicsZh, cnTopics, dependenciesZh, cnDependencies, clustersZh, cnStandards }) {
+export function deriveManifestCounts({ topicsZh, cnTopics, dependenciesZh, cnDependencies, cnBridgeDependencies, clustersZh, cnStandards }) {
+  // 审核分档计数：README/BACKLOG 的对外数字一律从这里取，杜绝手工同步漂移
+  const cnReview = { reviewed: 0, machine: 0, rejected: 0 };
+  for (const edge of cnDependencies.dependencies) cnReview[edge.reviewStatus ?? 'machine']++;
   return {
     topicsZh: topicsZh.topics.length,
     cnTopics: cnTopics.topics.length,
     dependenciesZh: dependenciesZh.dependencies.length,
     clustersZh: clustersZh.clusters.length,
     cnCurricula: cnStandards.curricula.length,
     cnCurriculumEntries: cnStandards.curricula.reduce((sum, curriculum) => sum + curriculum.topics.length, 0),
     cnDeps: cnDependencies.dependencies.length,
+    cnDepsReviewed: cnReview.reviewed,
+    cnDepsMachine: cnReview.machine,
+    cnDepsRejected: cnReview.rejected,
+    cnBridgeDeps: cnBridgeDependencies.dependencies.length,
   };
 }

@@ scripts/checksum.mjs:61 附近（main 内的调用）
     cnDependencies: JSON.parse(readFileSync(resolve(DATA, 'cn-dependencies.json'), 'utf8')),
+    cnBridgeDependencies: JSON.parse(readFileSync(resolve(DATA, 'cn-bridge-dependencies.json'), 'utf8')),
```

派生后的 manifest 新增字段（实测值）：`cnDepsReviewed: 1326`、`cnDepsMachine: 873`、`cnDepsRejected: 420`、`cnBridgeDeps: 47`。

发布图规模（3,549 / 4,553）**不进 manifest**：它依赖上游仓库，而 `checksum.mjs` 必须在无上游时也能跑通。该数字只出现在 README 的说明段落里，并注明由 `make export-jsonl` 现算。

#### 2.3.2 `README.md:7` 状态行 + alpha 声明

```diff
-> **状态：** `v1.2.0-zh.0` · 已翻译微主题：1,590 / 1,590（100%）· 中国特有微主题：2,008 · 上游依赖：3,221 / 3,221（100%）· 中国特有依赖：2,619（DAG）· 审核覆盖率：37.6%（985 reviewed / 1,634 machine）
+> **状态：** `v1.2.0-zh.0` · 已翻译微主题 1,590 / 1,590 · 中国特有微主题 2,008 · 上游依赖 3,221 · 中国特有依赖 2,619 · 内部边审核 reviewed 1,326 / machine 873 / rejected 420（50.6%）
+>
+> **成熟度：alpha（数据集，尚未经教师审核）。** 全部中文文本为机器翻译——1,586 / 1,590 条微主题标记
+> `translationStatus: machine`，仅 4 条经人工校对；中国特有依赖里 873 条是未审核的 AI 推测边
+> （`reviewStatus: machine`，不进入儿童路径）。已通过审核的 1,326 条中，985 条由确定性规则脚本产出
+> （`reviewProvenance: rule`）、341 条由用户授权的双 Claude Opus 复审判定（`ai-consensus`）、
+> **0 条经教师人工审核**。**AI 复审不等同于教师审核**，请勿把本数据集作为教学决策的唯一依据。
```

状态行里的每个数字都能在 `data/manifest.json` 的 `counts` 里找到对应字段，由 2.3.5 的测试断言。

#### 2.3.3 其余文档订正（逐条，全部有实测依据）

| 文件:行 | 动作 |
|---|---|
| `README.md:45` | cn-dependencies 表格行补 `reviewProvenance` 语义：`rule` / `ai-consensus` / `human`，并说明 API 返回的 upstream 边带 `reviewProvenance: upstream` |
| `README.md:208` | 「809 个教材来源节点，含 209 个具体阅读文本节点」→「1,069 个教材来源节点（`origin: textbook`），含 290 个具体阅读文本节点（`nodeKind: text`）」 |
| `README.md:235` | 保留 50.6%，补 provenance 拆分：「其中 rule 985 + ai-consensus 341，教师审核 0」 |
| `README.md:237` | bridge 行补「provenance rule 43 + ai-consensus 4」 |
| `README.md` 校验章节后 | 新增「互操作导出」小节（WS5 用法）与「贡献」章节指向 `CONTRIBUTING.md` |
| `PROVENANCE.md:62,68` | 809 → 1,069；「809 条中有 209 条 `nodeKind: text`」→「1,069 条中有 290 条 `nodeKind: text`」 |
| `NOTICE:32` | `209 records` → `290 records` |
| `BACKLOG.md:8-11` | 标题 68 → 109；现状行改为引用 manifest 字段：`alignedMathHigh 215 + alignedMathMedium 120 = 335 已对齐 / alignedMathTotal 446`，`alignedMathLowExcluded: 109`；补一句「口径以 `data/manifest.json` 为准，CHANGELOG 1.2.0 里的 68/398 是 Mathematical Thinking 扩展前的旧口径」 |
| `BACKLOG.md:15-18` | 补 provenance 视角：873 条 machine 待审；已 reviewed 的 1,326 条中 0 条教师审核，这是 v1.3 的真正目标 |
| `docs/reports/README.md:39-40,48-49,173,183` | 1,640 → 2,008，origin 分布换成实测值（textbook 1,069 / cn_only 578 / progression 188 / upstream_adapt 142 / cross_domain 31），并在段首标注「本报告为 gap 分析草案；落地计数以 `data/manifest.json` 为准」 |
| `package.json:8` | **删除** `homepage` 字段 —— 本仓库尚无 remote，指向 `withmarble.com`（上游官网）是错的，凭空编一个 GitHub URL 更错；仓库有 remote 后再补 `homepage` + `repository` |
| `CHANGELOG.md` | 顶部新增 `[Unreleased]` 条目（WS1-WS6 摘要 + 数字口径说明），历史条目一字不改 |

#### 2.3.4 `.gitignore`

```diff
 data/.granularity-work/
 data/.split-relations-work/
+
+# JSONL 互操作导出产物（按需生成，不入版本库）
+exports/
```

#### 2.3.5 `scripts/test/docs-stats.test.mjs`（新建，把防漂移变成断言）

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(resolve(ROOT, 'data', 'manifest.json'), 'utf8'));
const statusLine = readFileSync(resolve(ROOT, 'README.md'), 'utf8')
  .split('\n').find(line => line.startsWith('> **状态：**'));

const field = pattern => {
  const matched = statusLine.match(pattern);
  assert.ok(matched, `README 状态行缺少 ${pattern}`);
  return Number(matched[1].replace(/,/g, ''));
};

test('README 状态行的统计数字来自 manifest 真值', () => {
  assert.ok(statusLine, 'README 缺少状态行');
  assert.equal(field(/已翻译微主题 ([\d,]+)/), manifest.counts.topicsZh);
  assert.equal(field(/中国特有微主题 ([\d,]+)/), manifest.counts.cnTopics);
  assert.equal(field(/上游依赖 ([\d,]+)/), manifest.counts.dependenciesZh);
  assert.equal(field(/中国特有依赖 ([\d,]+)/), manifest.counts.cnDeps);
  assert.equal(field(/reviewed ([\d,]+)/), manifest.counts.cnDepsReviewed);
  assert.equal(field(/machine ([\d,]+)/), manifest.counts.cnDepsMachine);
  assert.equal(field(/rejected ([\d,]+)/), manifest.counts.cnDepsRejected);
});

test('README 审核覆盖率与 manifest 计数一致', () => {
  const stated = Number(statusLine.match(/（([\d.]+)%）/)[1]);
  const actual = (manifest.counts.cnDepsReviewed / manifest.counts.cnDeps) * 100;
  assert.equal(stated, Number(actual.toFixed(1)));
});
```

---

### WS4 · CI + CONTRIBUTING + SECURITY

#### 2.4.1 `.github/workflows/ci.yml`（新建）

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout beijing taxonomy
        uses: actions/checkout@v4
        with:
          path: os-taxonomy-beijing

      # 上游必须存在：validate 在找不到上游时会静默跳过对齐检查
      - name: Checkout upstream marble taxonomy
        uses: actions/checkout@v4
        with:
          repository: withmarbleapp/os-taxonomy
          path: os-taxonomy

      - uses: actions/setup-node@v4
        with:
          node-version: '22'

      # 零依赖项目：没有 lockfile，也不需要 npm ci
      - name: Unit tests
        working-directory: os-taxonomy-beijing
        run: npm test

      - name: Validate data (publish gate + upstream alignment)
        working-directory: os-taxonomy-beijing
        run: node scripts/validate.mjs --publish --upstream ../os-taxonomy

      - name: Checksum drift
        working-directory: os-taxonomy-beijing
        run: |
          node scripts/checksum.mjs
          git diff --exit-code data/manifest.json

      - name: JSONL export smoke
        working-directory: os-taxonomy-beijing
        run: node scripts/export-jsonl.mjs --upstream ../os-taxonomy
```

四道闸门各自防的东西：`npm test` 防逻辑回归；`validate --publish --upstream` 防数据不变量 + ID 漂移 + rescope 泄漏 + provenance 缺失；checksum 漂移防「改了 data 忘了跑 checksum」（v1.2 的老伤，CHANGELOG.md:16）；导出冒烟防合并逻辑在真实数据上崩。

#### 2.4.2 `CONTRIBUTING.md`（新建，骨架 + 必须写死的两块）

````markdown
# 贡献指南

本仓库是**数据集 + 零依赖工具链**。所有改动都要能通过 `npm test` 与
`node scripts/validate.mjs --publish --upstream ../os-taxonomy`。

## 一、codes-only 铁律（合规红线，PR 一律拒绝违反者）

教育部课标在本项目里**只以编号键的形式出现**（如 `moe-2022-math:S1.NA.01`），
详见 [PROVENANCE.md](PROVENANCE.md) 的「codes-only 原则」。PR 中**不得出现**：

- 课标条文原文、内容要求、学业质量描述的任何逐字文本（中英文皆不可）
- 教材正文、插图、练习题、版式、页码
- `cn-curriculum-standards.json` 里出现 `data` 字段或 `textIncluded: true`

`description` / `evidence` / `assessmentPrompt` 必须是**自拟的教学化表达**，
不是课标或教材的改写。`scripts/validate.mjs` 会硬性拦截 `textIncluded !== false`
和条目里出现 `data` 字段的情况，但"改写得像原文"只能靠人工 review——请自觉。

## 二、依赖边的审核工作流

每条依赖边有两个正交字段：

| 字段 | 含义 |
|---|---|
| `reviewStatus` | `machine`（未经任何审核，不进儿童路径）/ `reviewed`（通过）/ `rejected`（拒绝） |
| `reviewProvenance` | 审核结论的证据等级：`rule` 确定性规则脚本 / `ai-consensus` 用户授权的 AI 复审 / `human` 教师审核（`upstream` 只在服务端合并期出现，不入库） |

**不要手改 JSON**。审核一条边：

```bash
node scripts/review-ai-edge.mjs \
  --topic mtc_553 --prerequisite mtc_047 \
  --status reviewed --reviewer <你的标识> --provenance human \
  --note "先修关系在收窄后的主题上仍成立" --dry-run   # 确认无误后去掉 --dry-run

node scripts/checksum.mjs
node scripts/validate.mjs --publish --upstream ../os-taxonomy
```

`--provenance` 默认 `human`；只有批量 AI 复审脚本才允许写 `ai-consensus`，
且必须在 PR 描述里写明模型、轮次和分歧处理策略。**AI 复审不得声称是教师审核。**

## 三、改数据的固定顺序

```bash
node scripts/snapshot.mjs --label pre-<改动名>   # 1. 回滚点（本地，gitignored）
#    ... 改数据 ...
node scripts/checksum.mjs                        # 2. 重算 manifest 计数与校验和
node scripts/validate.mjs --publish --upstream ../os-taxonomy   # 3. 校验
npm test                                         # 4. 单测
```

顺序不能换：`validate` 会比对 manifest 的 SHA-256，先跑 validate 必然失败。

## 四、PR 检查清单

- [ ] 无课标/教材原文（第一节）
- [ ] 数据改动跑过 checksum，`git diff data/manifest.json` 不为空且已提交
- [ ] `npm test` 通过
- [ ] `validate --publish --upstream` 通过
- [ ] 新增/修改的边带正确的 `reviewProvenance`
- [ ] 改了对外统计数字的，`scripts/test/docs-stats.test.mjs` 通过
- [ ] 提交只包含本次改动的路径（不要 `git add -A`）

## 五、许可

贡献即同意按仓库的分层许可发布：代码 MIT、数据库 ODbL 1.0、文本 CC BY-SA 4.0
（见 [LICENSES.md](LICENSES.md)）。
````

#### 2.4.3 `SECURITY.md`（新建，简短）

要点：支持版本仅 `1.2.x-zh`；报告渠道（仓库启用 GitHub Private Security Advisory 后走该通道，之前走 issue 且不要附带 PoC 数据）；范围内——`scripts/`（会用 `.env` 里的 LLM API key 发外部请求）、`scripts/serve.mjs` 本地服务（默认监听 3000，`/api/chat` 会把用户输入转发给 LLM 且按 IP 限流）；范围外——课程内容准确性（走边审核工作流）、上游 Marble 数据本身；数据安全声明——不收集任何儿童/用户数据（`manifest.json.excluded`），不发布课标原文。

---

### WS5 · JSONL 互操作导出

#### 2.5.1 行形状（对齐 learning-commons）

```jsonc
// exports/nodes.jsonl
{"id":"mtc_001","labels":["MicroTopic","ChinaOrigin"],"properties":{"name":"拼音·声母韵母","description":"…","subject":"Chinese","domain":"Literacy & Handwriting","type":"LANGUAGE","nodeKind":"concept","ageRangeStart":6,"ageRangeEnd":8,"stage":"小学","centrality":0.333333,"cnStandards":["moe-2022-chinese:S1.RW.01"],"translationStatus":"cn-origin"}}

// exports/relationships.jsonl
{"type":"PREREQUISITE_OF","from":"mt_VBl1T1sFCM","to":"mt__00ZSLnB7p","properties":{"strength":"hard","reason":"在找到音量模式之前必须了解振动发出声音","reviewStatus":"reviewed","reviewProvenance":"upstream"}}
```

方向按 `PREREQUISITE_OF` 的字面语义：`from` = 先修，`to` = 依赖方。`evidence` / `assessmentPrompt` 不进导出——它们是教学载荷不是图结构，需要的人读 `data/*.json`（同一许可）。

#### 2.5.2 `scripts/export-jsonl.mjs`（新建）

```js
#!/usr/bin/env node
/**
 * export-jsonl.mjs — 把发布图导出为 JSONL（互操作格式）。
 *
 *   node scripts/export-jsonl.mjs                                  # 上游默认 ../os-taxonomy
 *   node scripts/export-jsonl.mjs --upstream /path/to/os-taxonomy --out exports
 *
 * 产物（gitignore）：
 *   exports/nodes.jsonl          {id, labels, properties}
 *   exports/relationships.jsonl  {type, from, to, properties}
 *   exports/manifest.json        版本 / 计数 / 许可证与署名（ODbL + CC BY-SA 要求）
 *
 * 只导出发布图（review-policy.publishedGraph）：非 covered 节点 + reviewed 且非 rescope 的边。
 * machine / rejected 边永远不进导出。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { mergeDependencies, publishedGraph } from './review-policy.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = resolve(ROOT, 'data');
const ATTRIBUTION = 'Beijing Skill Taxonomy (zh-CN) · derived from Marble Skill Taxonomy (v1), '
  + '© Generative Spark, Inc. · https://github.com/withmarbleapp/os-taxonomy · '
  + 'database ODbL 1.0, text CC BY-SA 4.0, code MIT.';

// 节点属性白名单：图结构 + 教学定位。evidence / assessmentPrompt 属教学载荷，留在 data/*.json。
const NODE_PROPS = ['name', 'description', 'subject', 'domain', 'type', 'nodeKind',
  'ageRangeStart', 'ageRangeEnd', 'stage', 'centrality', 'cnStandards', 'translationStatus'];

const load = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));

export function toNodeRow(topic) {
  const properties = {};
  for (const key of NODE_PROPS) {
    if (topic[key] !== undefined && topic[key] !== null) properties[key] = topic[key];
  }
  return {
    id: topic.id,
    labels: ['MicroTopic', topic.id.startsWith('mtc_') ? 'ChinaOrigin' : 'Upstream'],
    properties,
  };
}

export function toRelationshipRow(edge) {
  return {
    type: 'PREREQUISITE_OF',
    from: edge.prerequisiteId,
    to: edge.topicId,
    properties: {
      strength: edge.strength,
      reason: edge.reason ?? null,
      reviewStatus: edge.reviewStatus,
      reviewProvenance: edge.reviewProvenance ?? null,
    },
  };
}

export function buildExport({ upstreamTopics, zhTopics, cnTopics, upstreamDeps, zhDeps, cnDeps, bridgeDeps }) {
  const zhById = new Map(zhTopics.topics.map(topic => [topic.id, topic]));
  const topics = [];
  for (const topic of upstreamTopics.topics) {
    const zh = zhById.get(topic.id);
    topics.push(zh ? { ...topic, ...zh, translationStatus: zh.translationStatus ?? 'untranslated' }
      : { ...topic, translationStatus: 'untranslated' });
  }
  for (const topic of cnTopics.topics) topics.push({ ...topic, translationStatus: 'cn-origin' });

  const graph = publishedGraph(topics, mergeDependencies({ upstreamDeps, zhDeps, cnDeps, bridgeDeps }));
  return { nodes: graph.topics.map(toNodeRow), relationships: graph.dependencies.map(toRelationshipRow) };
}

const opt = (flag, fallback) => {
  const index = process.argv.indexOf(flag);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

function main() {
  const upstreamData = resolve(opt('--upstream', resolve(ROOT, '..', 'os-taxonomy')), 'data');
  if (!existsSync(resolve(upstreamData, 'topics.json'))) {
    throw new Error(`找不到上游 ${upstreamData}/topics.json —— 导出发布图需要完整上游结构，请用 --upstream 指定路径`);
  }
  const outDir = resolve(ROOT, opt('--out', 'exports'));
  const manifest = load(DATA, 'manifest.json');
  const { nodes, relationships } = buildExport({
    upstreamTopics: load(upstreamData, 'topics.json'),
    zhTopics: load(DATA, 'topics.zh.json'),
    cnTopics: load(DATA, 'cn-topics.json'),
    upstreamDeps: load(upstreamData, 'dependencies.json'),
    zhDeps: load(DATA, 'dependencies.zh.json'),
    cnDeps: load(DATA, 'cn-dependencies.json'),
    bridgeDeps: load(DATA, 'cn-bridge-dependencies.json'),
  });

  mkdirSync(outDir, { recursive: true });
  const jsonl = rows => rows.map(row => JSON.stringify(row)).join('\n') + '\n';
  writeFileSync(resolve(outDir, 'nodes.jsonl'), jsonl(nodes));
  writeFileSync(resolve(outDir, 'relationships.jsonl'), jsonl(relationships));
  writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify({
    dataset: manifest.dataset,
    taxonomyVersion: manifest.taxonomyVersion,
    upstreamVersion: manifest.upstreamVersion,
    locale: manifest.locale,
    generatedAt: new Date().toISOString(),
    scope: 'published graph only (reviewed, non-rescope edges; non-covered topics)',
    counts: { nodes: nodes.length, relationships: relationships.length },
    license: { database: 'ODbL-1.0', text: 'CC-BY-SA-4.0', code: 'MIT' },
    attribution: ATTRIBUTION,
  }, null, 2) + '\n');

  console.log(`✓ ${outDir}: ${nodes.length} nodes / ${relationships.length} relationships`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(`Fatal: ${error.message}`); process.exit(1); }
}
```

当前数据下的预期输出：`✓ …/exports: 3549 nodes / 4553 relationships`。

#### 2.5.3 `Makefile`

```diff
@@ Makefile:3
-.PHONY: snapshot snapshot-pre snapshot-list snapshot-diff
+.PHONY: snapshot snapshot-pre snapshot-list snapshot-diff export-jsonl

@@ Makefile:81（check 目标之后）
+# --- 互操作导出（JSONL，产物 gitignore）---
+#   make export-jsonl                              默认上游 ../os-taxonomy → exports/
+#   make export-jsonl UPSTREAM=/path/to/os-taxonomy OUT=dist/graph
+export-jsonl:
+	$(NODE) scripts/export-jsonl.mjs $(if $(UPSTREAM),--upstream $(UPSTREAM)) $(if $(OUT),--out $(OUT))

@@ Makefile:help 段
+	@echo "  导出："
+	@echo "    make export-jsonl         导出发布图为 JSONL（UPSTREAM= / OUT= 可选）"
```

---

### WS6 · gold-set 报告

#### 2.6.1 `scripts/evaluate-ai-gold-set.mjs`

```diff
+// 单组进入统计所需的最小双评一致样本量（可用环境变量覆盖）
+const CONSENSUS_SAMPLE_MIN = Number(process.env.GOLD_SET_MIN_CONSENSUS) || 30;
 const positiveLabel = kind => kind === 'split' ? 'split' : 'prerequisite';
```

用一个 `summarize(rows)` 替换原来内联在 `map` 里的算法，逐条按 `kind` 取正类，因此同一函数既能算单组也能算跨 kind 的聚合：

```js
function summarize(rows) {
  const agreed = rows.filter(row => row.reviewerA === row.reviewerB);
  let tp = 0, fp = 0, fn = 0;
  for (const row of agreed) {
    const positive = positiveLabel(row.kind);
    const predictedPositive = row.predicted === positive;
    const actualPositive = row.reviewerA === positive;
    if (predictedPositive && actualPositive) tp++;
    else if (predictedPositive) fp++;
    else if (actualPositive) fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  return {
    total: rows.length,
    consensusCount: agreed.length,
    disagreementCount: rows.length - agreed.length,
    tp, fp, fn,
    precision,
    recall,
    f1: precision && recall ? (2 * precision * recall) / (precision + recall) : null,
    kappa: kappa(rows),
    sampleReady: agreed.length >= CONSENSUS_SAMPLE_MIN,
  };
}

const groupBy = (records, keyOf) => {
  const groups = new Map();
  for (const record of records) {
    const key = keyOf(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
};

export function evaluateGoldSet(records) {
  const summarizeGroups = groups =>
    Object.fromEntries([...groups].map(([key, rows]) => [key, summarize(rows)]));
  return {
    overall: summarize(records),
    bySubject: summarizeGroups(groupBy(records, record => record.subject)),
    groups: summarizeGroups(groupBy(records, record => `${record.subject}|${record.kind}`)),
  };
}
```

`groups` 的键与字段全部向后兼容（只增不减），现有测试断言不变。

CLI 从「裸 JSON dump」改成人类可读表格，`--json` 保留原样输出：

```js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2];
  if (!file || file.startsWith('--')) throw new Error('用法: node scripts/evaluate-ai-gold-set.mjs <gold-set.json> [--json]');
  const report = evaluateGoldSet(JSON.parse(readFileSync(resolve(file), 'utf8')));
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const pct = value => value === null ? '   —  ' : `${(value * 100).toFixed(1)}%`;
    const line = (label, row) => `  ${label.padEnd(28)} n=${String(row.total).padStart(4)}  双评一致=${String(row.consensusCount).padStart(4)}`
      + `  P=${pct(row.precision)}  R=${pct(row.recall)}  F1=${pct(row.f1)}`
      + `  κ=${row.kappa === null ? ' —  ' : row.kappa.toFixed(2)}`
      + `  tp/fp/fn=${row.tp}/${row.fp}/${row.fn}${row.sampleReady ? '' : `  ⚠ 一致样本 <${CONSENSUS_SAMPLE_MIN}`}`;
    console.log('\n=== gold set 总体 ===');
    console.log(line('ALL', report.overall));
    console.log('\n=== 按学科 ===');
    for (const [subject, row] of Object.entries(report.bySubject)) console.log(line(subject, row));
    console.log('\n=== 按学科 × 任务 ===');
    for (const [key, row] of Object.entries(report.groups)) console.log(line(key, row));
    console.log('');
  }
}
```

---

## 3. 数据迁移安全

**唯一一次写数据**：WS2 的 `migrate-review-provenance.mjs` 触碰 `data/cn-dependencies.json` 与 `data/cn-bridge-dependencies.json`。WS1/WS3-WS6 全部不写 `data/`（`checksum.mjs` 只写 `manifest.json`）。

固定执行顺序：

```bash
node scripts/snapshot.mjs --label pre-review-provenance   # 1. 回滚点 → data/.snapshots/<ts>-pre-review-provenance/
git tag data-snapshot-pre-review-provenance               # 2. 双保险（README:127 的既有约定）
node scripts/migrate-review-provenance.mjs --dry-run      # 3. 先看分布，必须等于 2.2.2 的预期输出
node scripts/migrate-review-provenance.mjs                # 4. 写盘
node scripts/checksum.mjs                                 # 5. 重算 SHA-256/bytes/counts —— 必须在 validate 之前
node scripts/validate.mjs --publish --upstream ../os-taxonomy   # 6. 校验
npm test                                                  # 7. 单测
```

顺序理由：`validate.mjs:349-360` 逐文件比对 manifest 的 sha256 与 bytes，写盘后不先跑 checksum 必然报 `checksum mismatch`。

**幂等性**：`migrateReviewProvenance` 对已带正确 `reviewProvenance` 的边原样返回（计入 `alreadyStamped`），对带**不同** provenance 的边抛错而不是覆盖。第二次运行输出逐字节相同 → CI 的 `git diff --exit-code` 是这条性质的实际守卫。

**diff 形状**：`{ ...edge, reviewProvenance }` 把新键追加到每条边对象末尾，`JSON.stringify(doc, null, 2)` 下每条边只多一行（末键需补逗号，故每条边 1 增 1 改）。不重排任何既有键，不改 `edgeCount`、`generationBatches`、边顺序。预计文件增长约 73 KB。

**失败即停**：`rejected` 且无 `reviewedBy`（当前 0 条）会直接抛错终止而不是猜一个 provenance —— 这类数据异常必须暴露，不能被迁移脚本"修复"掉。

---

## 4. 测试计划

| 测试文件 | 新建/修改 | 守护的契约 |
|---|---|---|
| `scripts/test/review-policy.test.mjs` | 修改（追加 3 个 case） | ① 有上游时 `mergeDependencies` 给每条 mt_→mt_ 边贴 `reviewStatus:'reviewed'` + `reviewProvenance:'upstream'`，并用中文 reason 覆盖；② 无上游时对 `zhDeps` 走同样的贴标（否则本地无上游启动会退回 P0 现状）；③ cn 边与 bridge 边原样透传，不被贴标污染。既有两个 filter case 不动 |
| `scripts/test/review-provenance-migration.test.mjs` | 新建 | ① `reviewedBy` = 双 Opus → `ai-consensus`；② reviewed 无 reviewedBy → `rule`；③ machine → 不贴且 stats 计入 `skippedMachine`；④ 二次运行输出与首次**深度相等**（幂等）；⑤ rejected 无 reviewedBy → 抛错；⑥ 已有冲突 provenance → 抛错 |
| `scripts/test/review-ai-edge.test.mjs` | 修改（追加 2 个 case） | ① 默认审核盖 `reviewProvenance: 'human'`；② `--provenance rule` / `upstream` 被拒绝（人工通道不得声明规则/上游背书）。既有 3 个 case 不动 |
| `scripts/test/export-jsonl.test.mjs` | 新建 | ① `toNodeRow` / `toRelationshipRow` 的行形状逐字段固定（这是对外 API，任何变化都是破坏性的）；② 上游边（fixture 里不带 reviewStatus）出现在 relationships 里且 `reviewProvenance: 'upstream'`；③ `status: covered` 的节点及其边被排除；④ `machine` 与 `rejected` 边被排除；⑤ 节点属性白名单生效（fixture 里的 `evidence` 不出现在输出） |
| `scripts/test/checksum-counts.test.mjs` | 修改 | `deriveManifestCounts` 新增 `cnDepsReviewed/Machine/Rejected` + `cnBridgeDeps`；缺失 `reviewStatus` 的边计入 machine；`mergeManifestCounts` 仍不丢手工对齐计数（既有 case 不动） |
| `scripts/test/docs-stats.test.mjs` | 新建 | README 状态行的 7 个数字与覆盖率 = manifest 真值（防第三次统计漂移） |
| `scripts/test/evaluate-ai-gold-set.test.mjs` | 修改（追加 2 个 case） | ① `overall` 与 `bySubject` 存在且跨 kind 微聚合正确（正类按每条记录的 kind 取）；② `tp/fp/fn/f1/disagreementCount` 数值正确。既有 case 断言的字段全部保留 |

不新增测试的改动及理由：`serve.mjs` 的 API 字段（`publishedDeps` 由 `pathData.edges.length` 直给，逻辑在 `review-policy` 层已被覆盖）、`validate.mjs` 的新不变量（脚本式顶层执行，仓库既有惯例是由 `validate` 自身在真实数据上跑，CI 已固定该步）、文档与 CI YAML。

**owner 验证入口**（本方案不自行执行）：

```bash
npm test
node scripts/checksum.mjs && node scripts/validate.mjs --publish --upstream ../os-taxonomy
node scripts/export-jsonl.mjs --upstream ../os-taxonomy   # 期望 3549 nodes / 4553 relationships
npm start                                                 # 启动日志应打印「发布图边: 4553 条」
curl -s localhost:3000/api/summary | jq '{totalDeps, publishedDeps}'   # 期望 5887 / 4553
```

---

## 5. 提交切分

每个 commit 独立可验证、可 revert，路径显式列出（不用 `git add -A`）。

| # | 消息 | 路径 |
|---|---|---|
| 1 | `fix(publish): 上游 mt_ 边纳入发布图并标记 reviewProvenance` | `scripts/review-policy.mjs`、`scripts/serve.mjs`、`scripts/test/review-policy.test.mjs` |
| 2 | `feat(scripts): 新增 reviewProvenance 幂等迁移脚本` | `scripts/migrate-review-provenance.mjs`、`scripts/test/review-provenance-migration.test.mjs` |
| 3 | `chore(data): 回填 1,793 条边的 reviewProvenance` | `data/cn-dependencies.json`、`data/cn-bridge-dependencies.json`、`data/manifest.json`、`schema/cn-dependencies.schema.json` |
| 4 | `feat(validate): 强制 reviewProvenance 不变量并让审核 CLI 盖章` | `scripts/validate.mjs`、`scripts/review-ai-edge.mjs`、`scripts/test/review-ai-edge.test.mjs` |
| 5 | `feat(export): 发布图 JSONL 互操作导出` | `scripts/export-jsonl.mjs`、`scripts/test/export-jsonl.test.mjs`、`Makefile`、`.gitignore` |
| 6 | `feat(eval): gold-set 报告补总体/学科聚合与混淆矩阵` | `scripts/evaluate-ai-gold-set.mjs`、`scripts/test/evaluate-ai-gold-set.test.mjs` |
| 7 | `docs: 统计真值化 + alpha 成熟度声明` | `scripts/checksum.mjs`、`scripts/test/checksum-counts.test.mjs`、`scripts/test/docs-stats.test.mjs`、`data/manifest.json`、`README.md`、`BACKLOG.md`、`PROVENANCE.md`、`NOTICE`、`docs/reports/README.md`、`package.json` |
| 8 | `ci: 新增发布闸门工作流与贡献/安全指南` | `.github/workflows/ci.yml`、`CONTRIBUTING.md`、`SECURITY.md`、`CHANGELOG.md`、`README.md`（贡献章节链接） |

**顺序约束**（每个 commit 处都必须是绿的）：

- 2 必须在 3 之前（脚本先于它产出的数据）。
- 3 必须在 4 之前：commit 4 的 `checkReviewProvenance` 要求所有终态边都带 provenance，若数据未回填会立刻红。
- 7 依赖 3（manifest 里要先有 provenance 后的数据），且 `docs-stats.test.mjs` 与 `checksum.mjs` 的新计数必须同 commit 落地。
- 8 最后：CI 一上线就必须在**已经全绿**的树上跑。
- 1、5、6 之间无依赖，但 5 依赖 1（`mergeDependencies` 由 commit 1 引入）。

---

## 6. 风险与回滚

| # | 风险 | 概率/影响 | 缓解 |
|---|---|---|---|
| R1 | `/api/path-data` 负载从 161 KB→556 KB（gzip 41 KB→181 KB），首屏变慢 | 高 / 中 | 这是 P0 修复的**必然结果**（少发 3,221 条边才是 bug）。端点已有 gzip + `max-age=3600`（`serve.mjs:631-639`）。不动 viewer；若实测交互卡顿，另开 issue 讨论 reason 裁剪或分块加载，不塞进本方案 |
| R2 | 上游边未经本项目审核却显示为 `reviewed`，被读成"我们审过" | 中 / 高（信誉） | `reviewProvenance: 'upstream'` 随 API 一起返回；README alpha 声明写明四档证据等级；`serve.mjs:215-217` 的不实注释同批订正 |
| R3 | 迁移写盘后忘跑 checksum，validate 报 SHA 不符 | 中 / 低 | 顺序写进 CONTRIBUTING 第三节、迁移脚本结尾打印下一步命令、CI 的 checksum 漂移步兜底 |
| R4 | 迁移把 provenance 判错（尤其把 AI 复审当成 rule） | 低 / 高 | 映射只读 `(reviewStatus, reviewedBy)` 两个字段，不读 `reason` 文本；第 0.3 节记录了 65 条"规则模板但 machine"的反例作为该决策的依据；`--dry-run` 的 stats 必须逐个匹配预期值才允许写盘 |
| R5 | 新不变量打断他人分支上未带 provenance 的 reviewed 边 | 中 / 低 | 错误信息直接给修复命令：`… 缺 reviewProvenance（运行 node scripts/migrate-review-provenance.mjs）` |
| R6 | CI 依赖 `withmarbleapp/os-taxonomy` 公开可 clone；上游改名/转私有则 CI 全红 | 低 / 中 | 上游 checkout 是独立 step，失败点一目了然。**不**给它加 `continue-on-error`：没有上游的 validate 会静默跳过对齐检查，那种"绿"比红更危险 |
| R7 | JSONL 导出泄漏未审核内容或漏署名 | 低 / 高（合规） | 导出唯一入口是 `publishedGraph`；`exports/manifest.json` 带许可证与署名串；单测断言 machine/rejected/covered 全部被排除 |
| R8 | 删掉 `package.json` 的 `homepage` 让某些工具少了链接 | 低 / 低 | 该包 `private: true`，从不发布 npm；仓库有 remote 后一次性补 `homepage` + `repository` |

**回滚**：

- 代码类 commit（1、2、4、5、6、7、8）：`git revert <sha>`，无外部状态。
- 数据 commit（3）：优先 `git revert`；工作树已脏时用快照恢复 —
  `node scripts/snapshot.mjs --diff data/.snapshots/<ts>-pre-review-provenance` 确认差异后，从该目录拷回 `cn-dependencies.json` / `cn-bridge-dependencies.json` / `manifest.json`，再 `node scripts/checksum.mjs`。
- 迁移脚本**不提供** `--revert`：回滚路径是快照 + git，多一条反向写盘路径只会多一个出错面。
- 全量回退顺序：先 revert 4（放开校验），再 revert 3（退数据），否则中间态会红。

---

## 对 Plan B 的对抗评审

评审依据：planB 全文 + 本轮新做的三项取证（`build-stage-bridges.mjs` 写盘目标、`scripts/` 全量 grep、bridge 文件的 git 溯源）。

### 分歧 1 · bridge 43 条：`rule`（A）vs `human`（B）— **CONCEDE（A 的依据不成立）**

新取证推翻了 planA §0.4 的「脚本精选表」说法：

- `scripts/build-stage-bridges.mjs:33` 的 `DEPS_PATH` 是 **`cn-dependencies.json`**，`:129` 也只写这一个文件——它从未写过 bridge 文件。planA 把它当作 43 条的生成器是错的。
- `grep -l cn-bridge-dependencies scripts/*.mjs` 命中 8 个脚本，全部是消费者（audit / checksum / dedupe / migrate-ai-safety / review-ai-edge / serve / snapshot / validate），**仓库内不存在 bridge 生成器**。
- `git log --diff-filter=A -- data/cn-bridge-dependencies.json` → `10e1ee9`（2026-07-17T22:15:08+08:00，“feat: 微主题原子拆解 + 跨学段知识依赖 + mt_↔mtc_ 桥接”），是一次人工数据提交；文件 `note` 自述“人工精选教学意义最强的对应关系”。

`rule` 需要一条可指认的规则，这里没有。B 对**事实**的判断正确，A 错。

但 B 的**标签**只对了一半：`human` 在本数据集会被 README 读成“教师审核”，而这 43 条是**作者手工撰写**、从未被独立复核——把它们标 `human` 等于在小范围里重演 finding ②。修正提议见分歧 3。

### 分歧 2 · `generationBatchId` 是否参与 mapping — **无分歧（B 在反驳 A 没持有的立场）**

planA §2.2.1 的 mapping 只读 `(reviewStatus, reviewedBy)`；`generationBatchId` 只出现在 §0.2 的观测表里，从不进入判定。B 的论据（ai-consensus 内部 207 带 batch / 554 不带；machine 两者皆有）与 A 实测一致：`201+6=207`、`140+414=554`、合计 761。两案结论相同，无需裁决。

A 的补充论据比 B 更强一层：**batch 表示生成批次，reason 文本表示生成器**，两者都不是审核者——planA §0.3 的 65 条反例（命中 L3 规则模板却是 `machine`）证明了连 reason 都不能用。

### 分歧 3 · validator 是否接受 file-level 历史证据 — **REBUT（并给出两案都更优的方案）**

B 的规则是：`human` 可以没有逐边 audit，只要出现任一 audit 字段就要求完整。代价是**校验器从此无法阻止“无审计人的 human 边”**——B 自己承认这点，只能靠 CONTRIBUTING 和唯一写入口兜底。这正好把 finding ② 的漏洞留了个后门：外部消费者按 `reviewProvenance === 'human'` 过滤，会拿到 43 条无人背书的边。

A 的原方案（`rule` ⟺ 无 `reviewedBy`）在分歧 1 之后同样站不住。**净修订**：43 条标 `human`，同时补**可核验**的逐边审计，而不是放宽校验：

```jsonc
{ "reviewStatus": "reviewed", "reviewProvenance": "human",
  "reviewedBy": "project-curation", "reviewedAt": "2026-07-17T22:15:08+08:00" }
```

`reviewedAt` 取 `git log -1 --format=%aI 10e1ee9`——这是 git 可复算的事实，不是编造的时间戳（B 拒绝“伪造 reviewedBy/reviewedAt”的直觉对，但把“记录可核验事实”一并否掉了）。`reviewedBy: 'project-curation'` 也诚实地不叫 teacher。于是：

- 逐边审计不变量保留：`human`/`ai-consensus` 必须有 `reviewedBy` + `reviewedAt`，**没有例外分支、没有 43 个 ID 的脆弱名单**。
- README alpha 声明相应收紧为：cn 内部边 0 条教师审核；bridge 43 条为项目自建策展（`project-curation`），非教师审核。
- 迁移脚本的 bridge 分支因此需要多写两个字段，`provenanceOf` 增加一条 `CURATION_AUDIT` 常量注入；幂等性判据从「provenance 相等」扩展为「三字段全等」。

### 分歧 4 · `/api/path-data` 缓存与 `Vary` — **CONCEDE（Vary）/ REBUT（no-cache）**

- **CONCEDE**：`scripts/serve.mjs:634-639` 在 `Cache-Control: public, max-age=3600` 下按请求条件加 `Content-Encoding: gzip`，却没有 `Vary: Accept-Encoding`。按 RFC 9111 §4.1 这是真 bug，共享缓存可能把 gzip 体回放给未声明 gzip 的客户端。A 遗漏了，采纳 B 的 `Vary` 修复（1 行）。
- **REBUT**：B 把**所有** API 改成 `Cache-Control: no-cache`。path-data 的 gzip 体正好被本方案从 40,793 B 撑到 181,295 B（planA §0.6 实测），此时取消缓存是净退步。B 的理由「策略修复部署后旧图可能继续被缓存」窗口上限只有 1 小时，且本服务是 `localhost` 开发服务器、不存在 CDN 层。**保留 `public, max-age=3600` + 补 `Vary`** 才是最小正确修复。

### 分歧 5 · CI 顺序「checksum 先于 validate 会掩盖漂移」 — **REBUT（命题成立，但不适用于 planA）**

planA §2.4.1 的 step 顺序是 `npm test` → **`validate --publish --upstream`** → `checksum.mjs && git diff --exit-code`。`validate.mjs:349-360` 逐文件比对**已提交**的 manifest sha256/bytes，因此漂移在 checksum 改写 manifest **之前**就已经被抓住，随后的 `git diff --exit-code` 是第二道。B 描述的失效场景（checksum 先跑且**不**检查 diff）在 planA 里不存在。

B 的写法（checksum + diff 在前、validate 在后）同样正确，且失败标签更直白（“Manifest drift”而不是“checksum mismatch for cn-dependencies.json”）。**采纳其 step 命名**，顺序不变。

### Plan B 严格更优、A 全部采纳的三处

1. **`publishedGraph(mergedTopics, mergedDeps)` 只算一次，`publishedDeps` 与 `pathData` 同源**（planB WS1）。A 用 `pathData.edges.length` 反推是错的耦合：`pathData` 还会因 `!s1 || !s2` 丢边（subject 缺失的孤儿 topic），今天两者恰好都是 4,553，但 A 的口径依赖序列化实现。改为 `publishedGraphData.dependencies.length`。
2. **`scripts/build-stage-bridges.mjs:93` 同步写 `reviewProvenance: 'rule'`**（planB WS2）。A 只改了 `review-ai-edge.mjs` 这一条写路径，漏了规则写路径——任何人重跑该脚本都会产出 reviewed 但无 provenance 的边，直接撞上 A 自己的新不变量。这是 A 的真实缺口。
3. **CI 加 `permissions: contents: read`**（planB WS4）。最小权限，A 遗漏。

另外 B 显式核对了 `build-deps-llm.mjs` 不输出 terminal `reviewStatus`（故仍被解释为 machine、无需改动），这条尽职检查 A 没做，结论一致、无需行动。

### Plan B 的缺陷（三处，A 不采纳）

1. **删掉 `if (!s1 || !s2) continue;` 但仍保留 `s1/s2` 计算**（planB WS1 diff）。`publishedGraph` 只保证端点**在发布节点集内**，不保证 `subject` 有值——`serve.mjs:170-173` 的孤儿分支（`{ ...zh, translated, orphaned }`）产出的 topic 根本没有 `subject` 字段。今天孤儿数为 0 所以不炸，但一旦上游删 topic，跨学科标记 `x` 会因 `undefined !== undefined === false` 静默退化成“同学科”。删这行不是重构的必要条件。
2. **`Cache-Control: 'no-cache'` 全局化**——见分歧 4。
3. **导出「所有非端点字段原样进入 properties」**（planB WS5）。这会把 `rescopeRequired` / `previousReviewStatus` / `rescopeBatchId` / `reviewNote` / `splitFrom` / `coveredBy` 等内部审核簿记直接发布到互操作文件里。A 的白名单（planA §2.5.2 `NODE_PROPS`）更合适：对外接口应当是显式契约，而不是「内部结构的镜像」。B 在 path-data 加 `p=reviewProvenance` 是好的（消费者能看见证据等级），这一点 A 采纳到 JSONL 的 `properties.reviewProvenance`，但不扩大到全字段。

### 对 planA 的净修订清单

| 处 | 修订 |
|---|---|
| §0.4 | 删除「脚本精选表」表述，改为「无生成器脚本；`10e1ee9` 人工数据提交 + 文件 `note` 自述人工精选」 |
| §2.2.1 | bridge 43 条：`rule` → `human` + `reviewedBy: 'project-curation'` + `reviewedAt: '2026-07-17T22:15:08+08:00'`；cn 985 条 `rule` 不变 |
| §2.1.4 | `publishedDeps` 改用 `publishedGraph(mergedTopics, mergedDeps)` 单次结果，不再从 `pathData.edges.length` 反推 |
| §2.1 | 补 `Vary: Accept-Encoding`（保留 `public, max-age=3600`） |
| §2.2.5 | 增补 `scripts/build-stage-bridges.mjs:93` 写 `reviewProvenance: 'rule'`（提交 4 的路径清单加该文件） |
| §2.3.2 | alpha 声明补一句：bridge 43 条为项目自建策展，非教师审核 |
| §2.4.1 | CI 增加 `permissions: contents: read`；漂移 step 命名为 `Manifest drift`（顺序不变） |
| §4 | `review-provenance-migration.test.mjs` 增加 case：bridge 无 reviewer 的 reviewed 边得到 `human` + 注入的 curation audit，且二次运行三字段全等 |
