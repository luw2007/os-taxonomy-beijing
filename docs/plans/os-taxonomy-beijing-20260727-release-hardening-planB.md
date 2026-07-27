# os-taxonomy-beijing 开源发布加固 Plan B

> 日期：2026-07-27
> 范围：修复 owner 已确认的 6 个 finding，只做开源发布所需的最小闭环。
> 硬边界：实现阶段不改 `viewer/app.js`；`data/dependencies.zh.json` 继续只保存翻译；本文件只规划、不声称已经实施或通过测试。

## 1. 方案总览

### 1.1 已观察事实

以下是本轮直接读取仓库得到的事实，不是设计推断。

1. 发布策略只保留 `reviewStatus === 'reviewed'` 且不在 rescope quarantine 的边，并在 `publishedGraph()` 中再次删除端点不在发布节点集中的边（`scripts/review-policy.mjs:1-14`）。`serve.mjs` 合并上游边时只覆盖中文 `reason`，没有补 `reviewStatus`（`scripts/serve.mjs:190-205`），随后把缺失状态解释成 `machine`（`scripts/serve.mjs:215-231`）。因此上游 3,221 条边在儿童 API 中全部被过滤。
2. `/api/path-data` 在进程启动时一次性预计算（`scripts/serve.mjs:233-260`），响应可被公共缓存一小时，按请求同步 gzip，且没有 `Vary: Accept-Encoding`（`scripts/serve.mjs:631-639`）。策略修复部署后，旧图可能继续被缓存；共享缓存也可能混淆压缩和非压缩响应。
3. `/api/summary` 的 `totalDeps` 是原始 `mergedDeps.length`，没有发布后计数（`scripts/serve.mjs:371-392`）。详情 API 同样通过发布策略过滤依赖（`scripts/serve.mjs:429-466`）。
4. 本轮只读计算得到：原始合并图有 5,887 条边；当前发布图 1,332 条；给上游边补 provenance 后发布图应为 4,553 条。分项是上游 `3221 raw / 3221 published`、cn 内部 `2619 raw / 1326 reviewed / 1286 published`、bridge `47 raw / 46 reviewed / 46 published`。cn 的 40 条 reviewed 边因 49 个 covered topic 的端点过滤而退出发布图：14 条目标 covered、21 条先修 covered、5 条两端 covered。发布节点是 3,549 个。这个计算复用了当前 `reviewStatus`、`rescopeRequired` 和 covered-topic 规则，没有把 machine/rejected 边放宽。
5. `README.md:7` 写 37.6%，而同一文件 `README.md:235` 写当前 cn 内部边为 reviewed 1,326 / machine 873 / rejected 420，覆盖率 50.6%。manifest 的当前事实是 1,590 个上游翻译 topic、2,008 个 cn topic、3,221 条上游依赖、2,619 条 cn 依赖，以及 `alignedMathLowExcluded: 109`（`data/manifest.json:11-27`）。`BACKLOG.md:8-13` 仍写 68，`docs/reports/README.md:39-49,168-187` 仍把历史落地量 1,640 当作当前量。`package.json:8` 的 homepage 是上游产品站，仓库又没有 git remote，不能凭空发明本项目 URL。
6. 1,590 条 topic 翻译中，本轮 jq 实测 `machine=1586`、`reviewed=4`。README 自己说明 machine translation 的语义（`README.md:131-142`），但开头没有 alpha/非教师审核警告。
7. codes-only 规则明确禁止收录教育部课标原文，只允许自建编号键（`PROVENANCE.md:39-55`）；现有校验只检查数据中 `textIncluded: false` 和无 `data` 字段（`scripts/validate.mjs:104-120`），没有 PR 级 CI 或贡献流程。
8. `evaluateGoldSet()` 只输出 `subject|kind` 组合键，内部已经算 precision/recall/kappa，但没有稳定的 `subjects` 汇总层（`scripts/evaluate-ai-gold-set.mjs:21-45`）。这不是另起一套评测，而是缺少一个聚合维度。

### 1.2 决策

Plan B 只选一条实现路径：

- 在 `review-policy.mjs` 增加一个纯函数统一给上游边打 `{ reviewStatus: 'reviewed', reviewProvenance: 'upstream' }`；`serve.mjs` 和 JSONL exporter 共用它。发布准入仍然只看 `reviewStatus`，provenance 只表达证据等级，不改变 gate。
- `serve.mjs` 用一次 `publishedGraph(mergedTopics, mergedDeps)` 作为 `/api/path-data` 和 `/api/summary.publishedDeps` 的共同事实源，避免 covered topic 后产生孤边；`publishedDeps` 与仍为全局 raw 的 `totalDeps` 成对，故也定义为全局发布数，不随 dimension 改义。
- provenance 迁移按文件和现存审计字段确定，不以 `generationBatchId` 猜审核等级：cn 中 985 条无 reviewer 的 reviewed 边标 `rule`；bridge 中 43 条无 reviewer 的 reviewed 边依据文件级“人工精选”声明标 `human`；精确 reviewer `user-delegated-claude-opus-consensus` 标 `ai-consensus`；machine 不写 provenance。冲突或无法证明的 rejected 边直接失败。
- 不为 43 条 legacy bridge 伪造 `reviewedBy/reviewedAt`。validator 允许这批已有的 file-level human provenance；所有新 human review 必须由审核脚本写入 reviewer/time/note。
- 不引入通用 graph repository/service 抽象。数据量小、当前 merge 路径只有 server 和 exporter；两处只共享上游 stamp 和发布策略，避免大规模重构 `serve.mjs`。
- 不做 CASE/JSON-LD 双格式，不提交生成文件。只实现 owner 约定的两个确定性 JSONL 文件，`exports/` gitignore。
- 不为不存在的仓库主页猜 URL，直接删除错误的 `homepage` 字段；发布后有 canonical URL 再单独加入。
- gold-set 复用现有指标函数，增加 overall 和 subject 聚合，不建立第二套报告器。

### 1.3 可验收结果

实施完成后，固定在当前数据快照上的验收值是：`totalDeps=5887`、`publishedDeps=4553`、JSONL nodes 3,549 行、relationships 4,553 行；上游 3,221 条边全部带 runtime-only `upstream` provenance；发布关系的两端均存在于发布节点集。数据若在实现前变化，则不硬编码这些数到代码，而由同一只读 census 和测试 fixture 更新预期。

## 2. 分工作流设计（含核心代码）

### WS1 — 发布策略、API 计数与缓存

#### 设计

把“上游数据本身是已发布结构，但不等于教师审核”编码成 `reviewStatus=reviewed + reviewProvenance=upstream`。stamp 必须发生在上游结构与中文 reason 合并之后，也必须覆盖没有 checkout 上游、退化到 `dependencies.zh.json` 的本地模式；否则离线启动仍会丢掉全部 mt_ 边。`data/dependencies.zh.json` 不变，符合 `README.md:68-70` 的 translation-only 设计。

`publishedGraphData` 在合并完成后只算一次。`pathData.nodes` 和 `pathData.edges` 都从它产生，天然保证 covered topic 不会留下孤边；紧凑边增加 `p=reviewProvenance`，使 path-data 消费者也能看到证据等级，而详情 API 通过原对象 spread 已自然返回完整字段。详情 API 保留现有逐 topic 过滤，因为它还负责附加邻居详情。缓存采用最小修复：所有 API 都 `no-cache`，path-data 继续按客户端能力 gzip，并补 `Vary`。不加 ETag/version cache key，因为这会增加另一套失效状态；当前静态进程内数据重新验证一次的成本可接受。

#### 核心 diff

```diff
diff --git a/scripts/review-policy.mjs b/scripts/review-policy.mjs
@@
+export function stampUpstreamDependencies(dependencies) {
+  return dependencies.map(edge => ({
+    ...edge,
+    reviewStatus: 'reviewed',
+    reviewProvenance: 'upstream',
+  }));
+}
+
 export function filterPublishedDependencies(dependencies) {
   return dependencies.filter(edge => edge.reviewStatus === 'reviewed' && edge.rescopeRequired !== true);
 }
```

```diff
diff --git a/scripts/serve.mjs b/scripts/serve.mjs
@@
-import { filterPublishedDependencies, filterPublishedTopics } from './review-policy.mjs';
+import {
+  filterPublishedDependencies,
+  filterPublishedTopics,
+  publishedGraph,
+  stampUpstreamDependencies,
+} from './review-policy.mjs';
@@
 const mergedDeps = [];
 if (upstreamDeps) {
-  // 上游全量依赖 + 中文翻译覆盖
-  for (const d of upstreamDeps.dependencies) {
+  const upstreamMerged = [];
+  for (const d of upstreamDeps.dependencies) {
     const key = `${d.topicId}->${d.prerequisiteId}`;
     const zh = zhDepMap.get(key);
-    mergedDeps.push(zh ? { ...d, reason: zh.reason } : d);
+    upstreamMerged.push(zh ? { ...d, reason: zh.reason } : d);
   }
+  mergedDeps.push(...stampUpstreamDependencies(upstreamMerged));
 } else {
-  mergedDeps.push(...zhDeps.dependencies);
+  mergedDeps.push(...stampUpstreamDependencies(zhDeps.dependencies));
 }
@@
-// 三态: machine(LLM/规则产出,未人工审核) / reviewed(人工通过) / rejected(人工拒绝)
+// reviewStatus 控制发布；reviewProvenance 区分 upstream/rule/AI consensus/human 证据。
 // 字段缺失(老数据)按 machine 处理。rejected 永不返回给前端。
@@
+const publishedGraphData = publishedGraph(mergedTopics, mergedDeps);
+
 const pathData = (() => {
   const nodes = {};
   const subjMap = new Map();
-  for (const t of filterPublishedTopics(mergedTopics)) {
+  for (const t of publishedGraphData.topics) {
     nodes[t.id] = [t.name, t.subject, t.ageRangeStart ?? -1];
     subjMap.set(t.id, t.subject);
   }
   const edges = [];
-  for (const d of filterPublishedDependencies(mergedDeps)) {
+  for (const d of publishedGraphData.dependencies) {
     const s1 = subjMap.get(d.prerequisiteId), s2 = subjMap.get(d.topicId);
-    if (!s1 || !s2) continue;
+    edges.push({
+      f: d.prerequisiteId, t: d.topicId, r: d.reason || '',
+      x: s1 !== s2 ? 1 : 0, p: d.reviewProvenance,
+    });
   }
@@
       translatedTopics: topics.filter(t => t.translated).length,
       totalDeps: mergedDeps.length,
+      publishedDeps: publishedGraphData.dependencies.length,
@@
-      const isPathData = pathname === '/api/path-data';
+      const isPathData = pathname === '/api/path-data';
       const body = JSON.stringify(data);
       const acceptsGzip = req.headers['accept-encoding']?.includes('gzip');
       res.writeHead(200, {
         'Content-Type': 'application/json; charset=utf-8',
-        'Cache-Control': isPathData ? 'public, max-age=3600' : 'no-cache',
+        'Cache-Control': 'no-cache',
+        ...(isPathData ? { Vary: 'Accept-Encoding' } : {}),
         ...(isPathData && acceptsGzip ? { 'Content-Encoding': 'gzip' } : {}),
       });
```

这里故意不删除 `filterPublishedTopics` import：dimension 和详情路径仍在使用它（`scripts/serve.mjs:336-345,444-451`）。`publishedDeps` 不从 pathData 的紧凑 rows 反推，避免 API 统计依赖序列化实现。

### WS2 — provenance 迁移、写路径与校验

#### 实测 census

执行的核心 jq 口径如下；`reviewedBy` 缺失统一显示为 `<missing>`，`generationBatchId` 按字段是否存在分组。

```bash
jq '[.dependencies[] | {
  reviewStatus: (.reviewStatus // "<missing>"),
  reviewedBy: (.reviewedBy // "<missing>"),
  hasGenerationBatchId: has("generationBatchId")
}] | sort_by(.reviewStatus, .reviewedBy, .hasGenerationBatchId)
| group_by([.reviewStatus, .reviewedBy, .hasGenerationBatchId])
| map({reviewStatus: .[0].reviewStatus, reviewedBy: .[0].reviewedBy,
       hasGenerationBatchId: .[0].hasGenerationBatchId, count: length})' FILE
```

`data/cn-dependencies.json` 的精确结果：

| reviewStatus | reviewedBy | generationBatchId | 数量 | 迁移后 provenance |
|---|---|---:|---:|---|
| machine | 缺失 | 无 | 751 | 不写 |
| machine | 缺失 | 有 | 122 | 不写 |
| rejected | `user-delegated-claude-opus-consensus` | 无 | 414 | `ai-consensus` |
| rejected | 同上 | 有 | 6 | `ai-consensus` |
| reviewed | 缺失 | 无 | 985 | `rule` |
| reviewed | `user-delegated-claude-opus-consensus` | 无 | 140 | `ai-consensus` |
| reviewed | 同上 | 有 | 201 | `ai-consensus` |

`data/cn-bridge-dependencies.json` 的精确结果：

| reviewStatus | reviewedBy | generationBatchId | 数量 | 迁移后 provenance |
|---|---|---:|---:|---|
| rejected | `user-delegated-claude-opus-consensus` | 无 | 1 | `ai-consensus` |
| reviewed | 缺失 | 无 | 43 | `human`（legacy file-level） |
| reviewed | `user-delegated-claude-opus-consensus` | 无 | 3 | `ai-consensus` |

推断依据必须和观测分开：

- **观测**：cn 的 985 条无 reviewer reviewed 边都没有 generation batch；其中 977 条 reason 含规则箭头，另外 8 条与 `build-stage-bridges.mjs:88-94` 的硬编码规则写法对应；CHANGELOG 明说规则边被标为 reviewed（`CHANGELOG.md:21-24`）。故它们是 `rule`。
- **观测**：bridge 文件头 note 明写 47 条初始边为“人工精选”（`data/cn-bridge-dependencies.json:1-7`）；43 条没有后续 AI consensus audit，另外 4 条有该 reviewer（3 reviewed、1 rejected）。故 43 条是 legacy `human`，不能因字段形状相同就误标 `rule`。
- **判断**：`generationBatchId` 表示边的生成批次，不表示最终审核者。AI consensus 组中有 207 条带 batch、554 条不带 batch；machine 中也同时有/无 batch。因此 mapping 不读取它。
- **判断**：没有 reviewer 的 rejected 边无法区分 rule rejection、human rejection 或数据损坏，迁移应失败而不是猜。当前两文件此类数量为 0。

迁移后的稳定总数是：cn `rule=985`、`ai-consensus=761`、machine 无 provenance `=873`；bridge `human=43`、`ai-consensus=4`。当前数据没有可逐边证明的 cn human review。上游 3,221 条只在加载时得到 `upstream`，不写进翻译文件。

#### 迁移脚本核心代码

新增 `scripts/migrate-review-provenance.mjs`。函数没有当前时间、随机数或 append 操作；同一输入反复运行得到字节相同结果。已有 provenance 与推断冲突时 fail closed。

```js
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const AI_CONSENSUS_REVIEWER = 'user-delegated-claude-opus-consensus';
export const REVIEW_PROVENANCES = new Set(['upstream', 'rule', 'ai-consensus', 'human']);

export function inferReviewProvenance(edge, unattributedReviewedProvenance) {
  const status = edge.reviewStatus ?? 'machine';
  if (status === 'machine') return undefined;
  if (edge.reviewedBy === AI_CONSENSUS_REVIEWER) return 'ai-consensus';
  if (typeof edge.reviewedBy === 'string' && edge.reviewedBy.trim()) return 'human';
  if (status === 'reviewed') return unattributedReviewedProvenance;
  throw new Error(`cannot infer rejected edge ${edge.topicId}->${edge.prerequisiteId}`);
}

export function migrateReviewProvenance(doc, unattributedReviewedProvenance) {
  const migrated = structuredClone(doc);
  const counts = { upstream: 0, rule: 0, 'ai-consensus': 0, human: 0, omitted: 0 };
  for (const edge of migrated.dependencies) {
    const inferred = inferReviewProvenance(edge, unattributedReviewedProvenance);
    if (inferred === undefined) {
      if (edge.reviewProvenance !== undefined) {
        throw new Error(`machine edge has provenance ${edge.topicId}->${edge.prerequisiteId}`);
      }
      counts.omitted++;
      continue;
    }
    if (edge.reviewProvenance !== undefined && edge.reviewProvenance !== inferred) {
      throw new Error(`conflicting provenance ${edge.topicId}->${edge.prerequisiteId}`);
    }
    edge.reviewProvenance = inferred;
    counts[inferred]++;
  }
  return { doc: migrated, counts };
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const data = resolve(root, 'data');
  const dryRun = process.argv.includes('--dry-run');
  const targets = [
    ['cn-dependencies.json', 'rule'],
    ['cn-bridge-dependencies.json', 'human'],
  ];
  const outputs = targets.map(([name, fallback]) => {
    const path = resolve(data, name);
    const result = migrateReviewProvenance(JSON.parse(readFileSync(path, 'utf8')), fallback);
    return { name, path, ...result };
  });
  for (const output of outputs) {
    const counts = output.counts;
    console.log(`${output.name}: rule=${counts.rule} ai-consensus=${counts['ai-consensus']} `
      + `human=${counts.human} upstream=${counts.upstream} omitted=${counts.omitted}`);
  }
  if (dryRun) return;
  for (const output of outputs) {
    writeFileSync(output.path, JSON.stringify(output.doc, null, 2) + '\n');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(`Fatal: ${error.message}`); process.exit(1); }
}
```

脚本以两个文档全部成功 transform 后才开始写，避免第二个文件的 inference 错误造成第一个已改。两次 `writeFileSync` 仍不是跨文件事务，因此实施顺序必须先 snapshot，详见第 3 节。

#### validator 与持续写路径

`reviewProvenance` 虽是可选字段，但对 terminal status 是必填：`machine` 必须无 provenance；`reviewed/rejected` 必须有合法 provenance。合法组合为：

- `upstream`：只允许 `reviewed`，且只应存在于 runtime merged graph；本地 cn/bridge 文件禁止。
- `rule`：只允许 `reviewed`。规则可以证明“脚本接受”，不能代表 rejection 或人工意见。
- `ai-consensus`：允许 `reviewed/rejected`，且 reviewer 必须精确等于 consensus ID。
- `human`：允许 `reviewed/rejected`。legacy bridge 可缺逐边 audit；一旦出现任一 audit 字段，沿用当前完整性规则，必须同时有 non-empty `reviewedBy` 和 `reviewedAt`（现逻辑在 `scripts/validate.mjs:225-230,299-305`）。因为现有 schema 没有 legacy marker，validator 无法在不硬编码 43 个 edge ID 的前提下禁止未来的“无 audit human”；Plan B 不引入这份脆弱名单，而由唯一 human 写入口和 CONTRIBUTING 保证新数据完整。

在 `scripts/validate.mjs` 中增加纯组合检查，并分别在 cn 和 bridge 循环调用：

```js
const VALID_REVIEW_PROVENANCE = new Set(['upstream', 'rule', 'ai-consensus', 'human']);
const AI_CONSENSUS_REVIEWER = 'user-delegated-claude-opus-consensus';

function checkReviewProvenance(edge, label) {
  const status = edge.reviewStatus ?? 'machine';
  const provenance = edge.reviewProvenance;
  if (status === 'machine') {
    check(provenance === undefined, `${label}: machine edge cannot have reviewProvenance`);
    return;
  }
  check(VALID_REVIEW_PROVENANCE.has(provenance), `${label}: missing or illegal reviewProvenance "${provenance}"`);
  check(provenance !== 'upstream', `${label}: upstream provenance is runtime-only`);
  if (provenance === 'rule') check(status === 'reviewed', `${label}: rule provenance must be reviewed`);
  if (provenance === 'ai-consensus') {
    check(edge.reviewedBy === AI_CONSENSUS_REVIEWER,
      `${label}: ai-consensus requires reviewedBy ${AI_CONSENSUS_REVIEWER}`);
  }
  if (provenance === 'human' && edge.reviewedBy !== undefined) {
    check(edge.reviewedBy !== AI_CONSENSUS_REVIEWER,
      `${label}: consensus reviewer cannot be labeled human`);
  }
}
```

```diff
@@ for (const d of cnDeps.dependencies) {
+    checkReviewProvenance(d, `cn-dep ${d.topicId}->${d.prerequisiteId}`);
@@ for (const d of cnBridgeDeps.dependencies) {
+    checkReviewProvenance(d, `cn-bridge ${d.topicId}->${d.prerequisiteId}`);
```

`schema/cn-dependencies.schema.json` 同步允许字段并修掉“reviewed=人工”的错误描述：

```diff
@@
-          "reviewStatus": { "type": "string", "enum": ["machine", "reviewed", "rejected"], "description": "审核状态：machine=未审核（不进入儿童 API/路径）；reviewed=人工审核通过；rejected=人工拒绝。缺失视为 machine（向后兼容）。" }
+          "reviewStatus": { "type": "string", "enum": ["machine", "reviewed", "rejected"], "description": "发布状态：machine=未审核；reviewed=可发布；rejected=拒绝。证据等级见 reviewProvenance。" },
+          "reviewProvenance": { "type": "string", "enum": ["upstream", "rule", "ai-consensus", "human"], "description": "reviewed/rejected 决策的来源；upstream 仅用于运行时合并图。" }
```

两条现存写路径必须同步，否则下一次写数据会制造 validator 拒绝的新边：

```diff
diff --git a/scripts/review-ai-edge.mjs b/scripts/review-ai-edge.mjs
@@
     reviewStatus: decision.status,
+    reviewProvenance: decision.provenance ?? 'human',
     reviewedBy: decision.reviewer.trim(),
```

`reviewEdge()` 还要拒绝非 `human|ai-consensus` 的 provenance，并要求 `ai-consensus` 使用精确 reviewer。规则写路径 `scripts/build-stage-bridges.mjs:88-94` 增加：

```diff
       reviewStatus: 'reviewed', // 规则产生，可审计
+      reviewProvenance: 'rule',
```

不修改 `build-deps-llm.mjs` 的全量重建语义：它当前输出没有 terminal `reviewStatus`（`scripts/build-deps-llm.mjs:477-486`），因此被兼容解释为 machine，应该继续先审后发；不能为了通过新字段校验把 LLM 输出批量冒充 rule reviewed。

### WS3 — 文档、alpha 声明与单一事实源

#### 设计

README 开头只放一行 manifest 可核对的规模数据，紧接 alpha warning。审核覆盖率仍给出当前实测分布，但明确只针对 cn 内部边，且 AI consensus/rule 不是教师审核。Roadmap 中的固定规模与 `data/manifest.json:11-27` 对齐。reports 中 1,640 保留为带日期/阶段语义的历史快照，同时增加当前 2,008，避免篡改历史过程。BACKLOG 一次性修正整组数学对齐数字，不能只把 68 改 109 后留下 398/329 的新矛盾。

#### 核心文档 diff

```diff
diff --git a/README.md b/README.md
@@
-> **状态：** `v1.2.0-zh.0` · 已翻译微主题：1,590 / 1,590（100%）· 中国特有微主题：2,008 · 上游依赖：3,221 / 3,221（100%）· 中国特有依赖：2,619（DAG）· 审核覆盖率：37.6%（985 reviewed / 1,634 machine）
+> **状态：** `v1.2.0-zh.0` · 上游微主题 1,590 · 中国特有微主题 2,008 · 上游依赖 3,221 · 中国特有依赖 2,619（DAG）· cn 内部边 reviewed 1,326 / machine 873 / rejected 420（50.6%）
+
+> [!WARNING]
+> **Alpha 数据集。** 1,590 条中文微主题中 1,586 条仍是机器翻译。`reviewed` 只表示边通过发布门，不等于教师审核：边的证据等级由 `reviewProvenance` 区分为 upstream、rule、AI consensus 或 human。AI consensus 不是教师审核，不应直接用于高风险教学决策。
@@
-| [`data/cn-dependencies.json`](data/cn-dependencies.json) | 中国特有微主题之间的依赖 DAG（**已破环**）。每条边带 `reviewStatus`：`reviewed`=已审核（默认展示）/`machine`=AI 推测未审核（降级显示）/`rejected`=已拒绝（隐藏）。 |
+| [`data/cn-dependencies.json`](data/cn-dependencies.json) | 中国特有微主题之间的依赖 DAG（**已破环**）。`reviewStatus` 控制发布，`reviewProvenance` 区分上游、规则、AI 共识和人工证据。 |
@@
 ## 贡献

-欢迎贡献翻译、课标对齐、校对。请先阅读 [PROVENANCE.md](PROVENANCE.md) 了解
-codes-only 原则——**不要在 PR 中收录教育部课标的原文条款**。
+欢迎贡献翻译、课标对齐、校对。提交前必须阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 和
+[PROVENANCE.md](PROVENANCE.md)；PR 不得包含教育部课标原文。
```

在 README 使用章节增加 JSONL 说明，避免 exporter 成为隐藏工具：

````md
### JSONL 互操作导出

```bash
make export-jsonl                         # 默认读取 ../os-taxonomy
make export-jsonl UPSTREAM=/path/to/os-taxonomy
```

生成的 `exports/nodes.jsonl` 和 `exports/relationships.jsonl` 来自发布图；目录是可再生构建产物，不提交到 Git。
````

```diff
diff --git a/BACKLOG.md b/BACKLOG.md
@@
-### 1. C1a-2 跳过的 68 条 low 置信度数学节点未对齐
-- **现状**：398 个小学数学节点中 329 条已对齐（high 213 + medium 116），68 条 low 被跳过
+### 1. C1a-2 跳过的 109 条 low 置信度数学节点未对齐
+- **现状**：446 个数学节点中 335 条已对齐（high 215 + medium 120），109 条 low 被跳过
@@
-- **manifest 字段**：`alignedMathLowExcluded: 68`
+- **manifest 字段**：`alignedMathLowExcluded: 109`
```

```diff
diff --git a/docs/reports/README.md b/docs/reports/README.md
@@
-proposed CSV 共 674 条草案（小学 132 + 初中 354 + 高中 188），实际落地到
-`data/cn-topics.json` 的微主题有 **1,640 条**。差异来自两个拆解过程：
+proposed CSV 共 674 条草案（小学 132 + 初中 354 + 高中 188）。本节记录首次落地时
+674 → 1,640 条的历史拆解快照；后续粒度治理继续扩展，当前 `data/manifest.json`
+记录的 `cnTopics` 是 **2,008 条**。历史数不能再当作当前总量。
@@
-落地后 cn-topics 的 origin 分布：`cn_only` 531 / `textbook` 809 / `progression` 154 /
-`upstream_adapt` 119 / `cross_domain` 27。
+首次落地快照的 origin 分布：`cn_only` 531 / `textbook` 809 / `progression` 154 /
+`upstream_adapt` 119 / `cross_domain` 27。
@@
-- `data/cn-topics.json` 已落地 **1,640 条中国特有微主题**（`mtc_` 前缀），不与上游 `mt_` 关联——
-  它们是中国特有、跨领域新建、进阶延伸或课本补充的主题。
+- `data/cn-topics.json` 当前有 **2,008 条中国特有微主题**（`mtc_` 前缀）；1,640 是上述首次落地快照。
+  它们不与上游 `mt_` 关联，是中国特有、跨领域新建、进阶延伸或课本补充的主题。
@@
-| 微技能级粒度拆解（674 条 → 1,640 条） | ✅ 完成 |
+| 首次微技能级粒度拆解（674 条 → 1,640 条，历史快照） | ✅ 完成 |
+| 后续粒度治理（当前总量 2,008，见 manifest） | ✅ 完成 |
```

`package.json` 删除错误 URL，不替换成未经证实的个人或组织地址：

```diff
diff --git a/package.json b/package.json
@@
-  "homepage": "https://withmarble.com",
```

`CHANGELOG.md` 顶部新增 `[Unreleased] — 2026-07-27`，逐项记录 upstream publication、provenance migration、alpha/docs、CI/governance、JSONL export 和 gold-set subject breakdown；不改写 1.2.0 历史条目。其核心文字为：

```md
## [Unreleased] — 2026-07-27

- 修复上游 3,221 条依赖因缺少本地审核字段而从发布图消失的问题；API 同时报告 raw 与 published 边数。
- 增加 `reviewProvenance`，区分 upstream、rule、AI consensus 与 human；AI consensus 明确不等于教师审核。
- 增加 alpha/limitations、贡献与安全政策、Node 22 CI 和 codes-only PR 门禁。
- 增加确定性 `nodes.jsonl` / `relationships.jsonl` 发布图导出及 gold-set 学科汇总。
```

### WS4 — CI、CONTRIBUTING 与 SECURITY

#### CI 决策与核心代码

只建一个 workflow、一个 Node 版本。项目零依赖（`package.json:9-17`），CI 不跑 `npm install`。上游 clone 到现有默认约定 `../os-taxonomy`（`scripts/serve.mjs:32-37`、`scripts/validate.mjs:30-38`）。checksum 必须先改写 manifest 再立刻检查 diff，只有 clean 才继续 validate；若先 checksum 再 validate 却不检查 diff，陈旧 manifest 会被 CI 临时“修好”而掩盖漂移。

```yaml
# .github/workflows/ci.yml
name: CI

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Clone upstream taxonomy
        run: git clone --depth 1 https://github.com/withmarbleapp/os-taxonomy ../os-taxonomy
      - name: Unit tests
        run: npm test
      - name: Manifest drift
        run: |
          node scripts/checksum.mjs
          git diff --exit-code -- data/manifest.json
      - name: Publication and upstream validation
        run: node scripts/validate.mjs --publish --upstream ../os-taxonomy
```

不把 `make check` 放进 CI：它会先无条件改写 checksum，且 strict term-lint 可能访问 Wikidata（`Makefile:66-81`），与可重现、最小的 release gate 不同。term-lint 网络策略可另建 workflow，不阻塞本批。

#### CONTRIBUTING 核心内容

新增 `CONTRIBUTING.md`，把数据审查写成可执行状态机，而不是泛泛欢迎：

````md
# Contributing

## Legal boundary: codes only

Pull requests must not include verbatim Ministry of Education curriculum text, textbook prose,
PDFs, scans, exercises, illustrations, page layouts, or page numbers. Curriculum links use only
the repository-defined codes described in `PROVENANCE.md`. Reviewers must reject a PR containing
restricted source text even when the data is otherwise correct.

## Dependency review workflow

1. New model-produced edges start with `reviewStatus: "machine"` and no `reviewProvenance`.
2. Rule-produced publishable edges use `reviewStatus: "reviewed"` and `reviewProvenance: "rule"`.
3. A human decision uses `scripts/review-ai-edge.mjs`; it must record `reviewedBy`, `reviewedAt`,
   `reviewNote`, and `reviewProvenance: "human"`.
4. AI consensus is not human review. It uses `reviewProvenance: "ai-consensus"` and the exact
   reviewer identifier recorded by the consensus workflow.
5. `rejected` edges remain in source data for audit but never enter the published graph.
6. Do not add review fields to `data/dependencies.zh.json`; upstream provenance is attached at load time.

## Before opening a pull request

```bash
npm test
node scripts/checksum.mjs
node scripts/validate.mjs --publish --upstream ../os-taxonomy
git diff --check
```

Commit the intended `data/manifest.json` update with any changed data file. Do not commit `exports/`
or local model/cache/snapshot files.
````

#### SECURITY 核心内容

新增 `SECURITY.md`。没有 canonical remote/contact 时，不放个人邮箱；统一使用 GitHub private vulnerability reporting：

```md
# Security Policy

## Supported versions

Only the latest revision of the `main` branch receives security fixes while the project is alpha.

## Reporting a vulnerability

Use GitHub's **Security → Report a vulnerability** flow and include reproduction steps, affected
paths, impact, and any suggested mitigation. Do not disclose sensitive details in a public issue.
If private vulnerability reporting is unavailable, open a public issue containing no vulnerability
details and ask the maintainers to establish a private channel.

Data-quality disagreements and curriculum mapping corrections are not security vulnerabilities;
submit those through the contribution workflow.
```

### WS5 — 发布图 JSONL 互操作导出

#### 设计

Exporter 必须读取真实上游结构，不能把 translation-only 文件伪装成完整节点。CLI 默认 `../os-taxonomy`，不存在就报错。节点 merge 与 server 同方向：上游结构在前、中文字段覆盖文本，cn topic 直接追加；边 merge 复用 `stampUpstreamDependencies()`，然后统一走 `publishedGraph()`。排序后整文件同步写入足够简单，当前只有 3,549/4,553 行，无需 stream pipeline。

关系方向固定为 `PREREQUISITE_OF: prerequisite -> topic`，避免把源数据字段 `topicId depends on prerequisiteId` 原样映射成含糊的 from/to。所有非端点字段原样进入 `properties`，外部消费者可见 review provenance。

#### `scripts/export-jsonl.mjs` 核心代码

```js
#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { publishedGraph, stampUpstreamDependencies } from './review-policy.mjs';

const without = (value, keys) => Object.fromEntries(
  Object.entries(value).filter(([key]) => !keys.includes(key)),
);

export function buildExportRows({ upstreamTopicsDoc, topicsZhDoc, cnTopicsDoc,
  upstreamDepsDoc, depsZhDoc, cnDepsDoc, bridgeDepsDoc }) {
  const zhById = new Map(topicsZhDoc.topics.map(topic => [topic.id, topic]));
  const upstreamById = new Map(upstreamTopicsDoc.topics.map(topic => [topic.id, topic]));
  const ids = new Set([...upstreamById.keys(), ...zhById.keys()]);
  const topics = [...ids].map(id => {
    const upstream = upstreamById.get(id);
    const translated = zhById.get(id);
    if (upstream && translated) return { ...upstream, ...translated, translated: true };
    if (upstream) return { ...upstream, translated: false, translationStatus: 'untranslated' };
    return { ...translated, translated: true, orphaned: true };
  });
  topics.push(...cnTopicsDoc.topics.map(topic => ({
    ...topic, translated: true, translationStatus: 'cn-origin', cnOrigin: true,
  })));

  const reasonByKey = new Map(depsZhDoc.dependencies.map(edge => [
    `${edge.topicId}->${edge.prerequisiteId}`, edge.reason,
  ]));
  const upstreamEdges = upstreamDepsDoc.dependencies.map(edge => {
    const reason = reasonByKey.get(`${edge.topicId}->${edge.prerequisiteId}`);
    return reason === undefined ? edge : { ...edge, reason };
  });
  const dependencies = [
    ...stampUpstreamDependencies(upstreamEdges),
    ...cnDepsDoc.dependencies,
    ...bridgeDepsDoc.dependencies,
  ];
  const graph = publishedGraph(topics, dependencies);

  const nodes = graph.topics
    .map(topic => ({
      id: topic.id,
      labels: ['Topic', topic.id.startsWith('mtc_') ? 'ChinaOrigin' : 'Upstream'],
      properties: without(topic, ['id']),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const relationships = graph.dependencies
    .map(edge => ({
      type: 'PREREQUISITE_OF',
      from: edge.prerequisiteId,
      to: edge.topicId,
      properties: without(edge, ['prerequisiteId', 'topicId']),
    }))
    .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { nodes, relationships };
}

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const data = resolve(root, 'data');
  const upstream = resolve(option('--upstream', resolve(root, '..', 'os-taxonomy')), 'data');
  const read = (dir, name) => JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
  const rows = buildExportRows({
    upstreamTopicsDoc: read(upstream, 'topics.json'),
    topicsZhDoc: read(data, 'topics.zh.json'),
    cnTopicsDoc: read(data, 'cn-topics.json'),
    upstreamDepsDoc: read(upstream, 'dependencies.json'),
    depsZhDoc: read(data, 'dependencies.zh.json'),
    cnDepsDoc: read(data, 'cn-dependencies.json'),
    bridgeDepsDoc: read(data, 'cn-bridge-dependencies.json'),
  });
  const output = resolve(root, 'exports');
  mkdirSync(output, { recursive: true });
  for (const [name, values] of Object.entries(rows)) {
    writeFileSync(resolve(output, `${name}.jsonl`), values.map(JSON.stringify).join('\n') + '\n');
  }
  console.log(`✓ exported ${rows.nodes.length} nodes and ${rows.relationships.length} relationships`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

Makefile 和 ignore 只加最小入口：

```diff
diff --git a/.gitignore b/.gitignore
@@
+exports/

diff --git a/Makefile b/Makefile
@@
-.PHONY: all install serve translate validate checksum term-lint check clean help
+.PHONY: all install serve translate validate checksum term-lint export-jsonl check clean help
@@
+export-jsonl:
+	$(NODE) scripts/export-jsonl.mjs $(if $(UPSTREAM),--upstream $(UPSTREAM))
```

`help` 同步显示 `make export-jsonl UPSTREAM=/path/to/os-taxonomy`。不增加 npm script，避免 Makefile/npm 两套入口继续漂移；owner contract 已指定 Makefile target。

### WS6 — gold-set 的学科级报告

#### 设计与核心代码

将现有指标抽成 `metrics(records)`，它按每条记录自己的 `kind` 判断 positive label，因此 subject 汇总可以正确 micro-average relation 与 split，不能拿第一个 row 的 kind 代表整个 subject。保留原 `groups` 以免破坏现有消费者，新增 `overall` 和 `subjects`。

```diff
diff --git a/scripts/evaluate-ai-gold-set.mjs b/scripts/evaluate-ai-gold-set.mjs
@@
+function metrics(records) {
+  const agreed = records.filter(record => record.reviewerA === record.reviewerB);
+  const predictedPositive = record => record.predicted === positiveLabel(record.kind);
+  const actualPositive = record => record.reviewerA === positiveLabel(record.kind);
+  const tp = agreed.filter(record => predictedPositive(record) && actualPositive(record)).length;
+  const fp = agreed.filter(record => predictedPositive(record) && !actualPositive(record)).length;
+  const fn = agreed.filter(record => !predictedPositive(record) && actualPositive(record)).length;
+  return {
+    total: records.length,
+    consensusCount: agreed.length,
+    precision: tp + fp ? tp / (tp + fp) : null,
+    recall: tp + fn ? tp / (tp + fn) : null,
+    kappa: kappa(records),
+    sampleReady: agreed.length >= 30,
+  };
+}
+
+function grouped(records, keyOf) {
+  const groups = new Map();
+  for (const record of records) {
+    const key = keyOf(record);
+    if (!groups.has(key)) groups.set(key, []);
+    groups.get(key).push(record);
+  }
+  return Object.fromEntries([...groups].map(([key, rows]) => [key, metrics(rows)]));
+}
+
 export function evaluateGoldSet(records) {
-  const groups = {};
-  for (const record of records) {
-    const key = `${record.subject}|${record.kind}`;
-    if (!groups[key]) groups[key] = [];
-    groups[key].push(record);
-  }
   return {
-    groups: Object.fromEntries(Object.entries(groups).map(([key, rows]) => {
-      const agreed = rows.filter(row => row.reviewerA === row.reviewerB);
-      const positive = positiveLabel(rows[0]?.kind);
-      const tp = agreed.filter(row => row.predicted === positive && row.reviewerA === positive).length;
-      const fp = agreed.filter(row => row.predicted === positive && row.reviewerA !== positive).length;
-      const fn = agreed.filter(row => row.predicted !== positive && row.reviewerA === positive).length;
-      return [key, {
-        total: rows.length,
-        consensusCount: agreed.length,
-        precision: tp + fp ? tp / (tp + fp) : null,
-        recall: tp + fn ? tp / (tp + fn) : null,
-        kappa: kappa(rows),
-        sampleReady: agreed.length >= 30,
-      }];
-    })),
+    overall: metrics(records),
+    subjects: grouped(records, record => record.subject),
+    groups: grouped(records, record => `${record.subject}|${record.kind}`),
   };
 }
```

CLI 仍输出 JSON（`scripts/evaluate-ai-gold-set.mjs:47-51`），所以无需新 reporter、模板或依赖。subject 对象的每一行都含 precision/recall/kappa/sampleReady，直接满足按学科识别薄弱项。

## 3. 数据迁移安全

### 3.1 唯一执行顺序

实现者按下面顺序执行，不调换 checksum 与 migration：

```bash
SNAPSHOT_LABEL=pre-review-provenance make snapshot-pre
node scripts/migrate-review-provenance.mjs --dry-run
node scripts/migrate-review-provenance.mjs
node scripts/checksum.mjs
git diff -- data/cn-dependencies.json data/cn-bridge-dependencies.json data/manifest.json
npm test
node scripts/validate.mjs --publish --upstream ../os-taxonomy
```

本轮规划阶段不执行这些命令。正式迁移的 dry-run 必须精确报告：

```text
cn-dependencies.json: rule=985 ai-consensus=761 human=0 upstream=0 omitted=873
cn-bridge-dependencies.json: rule=0 ai-consensus=4 human=43 upstream=0 omitted=0
```

### 3.2 幂等与 checksum

- migration 只为 terminal 边设置确定字段，不改变数组顺序、edgeCount、generation batch 或 reason；二次执行命中相同值，不追加字段或时间。测试以 `deepEqual(migrate(migrate(doc)).doc, migrate(doc).doc)` 守住。
- `checksum.mjs` 已把两个依赖文件列入 FILES（`scripts/checksum.mjs:19-30`），迁移后只应改变 manifest 中这两项的 bytes/sha256；`deriveManifestCounts()` 的 `cnDeps` 仍为 2,619（`scripts/checksum.mjs:32-45`）。若其他 manifest entry 或手工 alignment count 变化，停止并检查。
- 必须先 migration、后 checksum。若反过来，validator 的 SHA 检查必然报错（`scripts/validate.mjs:349-360`）。CI 中则运行 checksum 后立即 `git diff --exit-code`，防止工作树修复掩盖仓库漂移。
- `data/dependencies.zh.json` 不迁移、不改 checksum；上游 `upstream` provenance 只在 server/exporter 内存对象中存在。

### 3.3 发布与回滚

- 部署前重启 server；`pathData` 是启动时快照（`scripts/serve.mjs:233-260`），热替换 JSON 不会生效。缓存改为 `no-cache` 后，客户端会重新验证，不再额外保留一小时。
- 数据迁移回滚优先恢复 `data/.snapshots/<timestamp>-pre-review-provenance/` 中两个依赖文件，再运行 checksum；代码回滚则按第 5 节整 commit revert，不手工删散落字段。
- exporter 必须在 migration、checksum、validate 都完成后生成。`exports/` 可直接删除重建，不属于回滚资产。

## 4. 测试计划

实施时新增/修改以下 `node --test` 文件，沿用当前 `node:assert/strict` + `node:test` 风格（现有样例见 `scripts/test/review-policy.test.mjs:1-18`、`scripts/test/publication-safety.test.mjs:1-37`）。本轮不运行测试。

### 4.1 `scripts/test/review-policy.test.mjs`（修改）

新增真实核心断言：

```js
test('upstream dependencies are published with explicit upstream provenance', () => {
  const stamped = stampUpstreamDependencies([
    { topicId: 'b', prerequisiteId: 'a', strength: 'hard' },
  ]);
  assert.deepEqual(stamped[0], {
    topicId: 'b', prerequisiteId: 'a', strength: 'hard',
    reviewStatus: 'reviewed', reviewProvenance: 'upstream',
  });
  assert.equal(filterPublishedDependencies(stamped).length, 1);
});

test('published graph removes dependencies touching covered topics', () => {
  const graph = publishedGraph(
    [{ id: 'a' }, { id: 'b' }, { id: 'covered', status: 'covered' }],
    [
      { topicId: 'b', prerequisiteId: 'a', reviewStatus: 'reviewed' },
      { topicId: 'b', prerequisiteId: 'covered', reviewStatus: 'reviewed' },
    ],
  );
  assert.deepEqual(graph.dependencies.map(edge => edge.prerequisiteId), ['a']);
});
```

这两个测试分别防止 P0 回归和 covered endpoint orphan。现有“只发 reviewed/non-rescope”测试保留。

### 4.2 `scripts/test/review-provenance-migration.test.mjs`（新增）

覆盖：985 类 rule fixture、consensus reviewed/rejected（有/无 generationBatchId）、legacy human fallback、普通具名 human、machine omission、无 reviewer rejected fail closed、已有冲突 provenance fail、二次迁移幂等。不要把 2,619 条生产数据读进单元测试；生产总数由 validate/CI 和 dry-run 对账。

### 4.3 `scripts/test/review-ai-edge.test.mjs`（修改）

现有 teacher fixture（`scripts/test/review-ai-edge.test.mjs:11-30`）增加 `reviewProvenance === 'human'`；新增 AI consensus 精确 reviewer 测试和“consensus provenance + 任意 reviewer”拒绝测试。这保证未来写路径不会在迁移后制造缺字段数据。

### 4.4 `scripts/test/export-jsonl.test.mjs`（新增）

用最小内存 fixture 覆盖：中文字段覆盖上游文本、cn topic 追加、upstream stamp、machine/rejected/covered 边不导出、relationship 方向为 prerequisite→topic、properties 不重复端点、输出排序稳定、每条 relationship 两端均在 node IDs。另用 `JSON.parse(lines[i])` 验证每行独立合法 JSON。

### 4.5 `scripts/test/evaluate-ai-gold-set.test.mjs`（修改）

保留原 Biology group 断言（`scripts/test/evaluate-ai-gold-set.test.mjs:6-20`），加入第二学科和 split kind，验证：

- `subjects.Biology.precision` 与原组合结果一致；
- mixed-kind subject 按每行 kind 的 positive label micro-average，而不是使用首行 kind；
- `overall`、`subjects`、`groups` 三层的 total/consensusCount 加总关系正确；
- 零预测 positive 时 precision 为 null，达到 30 个 consensus 时 `sampleReady=true`。

### 4.6 CI/集成验收（owner 执行）

```bash
npm test
node scripts/checksum.mjs
git diff --exit-code -- data/manifest.json
node scripts/validate.mjs --publish --upstream ../os-taxonomy
make export-jsonl UPSTREAM=../os-taxonomy
test "$(wc -l < exports/nodes.jsonl)" -eq 3549
test "$(wc -l < exports/relationships.jsonl)" -eq 4553
```

另启动 server 后验证：

```bash
curl -s http://localhost:3000/api/summary | jq '{totalDeps,publishedDeps}'
curl -s http://localhost:3000/api/path-data | jq '.edges | length'
curl -sI -H 'Accept-Encoding: gzip' http://localhost:3000/api/path-data
```

当前快照预期依次是 `{totalDeps:5887,publishedDeps:4553}`、`4553`，响应含 `Cache-Control: no-cache`、`Vary: Accept-Encoding`、`Content-Encoding: gzip`。再用 jq 检查 path-data 每条边的 `f/t` 均是 `.nodes` key，且 `p` 属于四值 enum。若实现前数据变化，应以迁移前保存的 census 更新 fixture/预期，不能为了过测试硬改业务过滤。

## 5. Commit slicing

每个 commit 都列出完整路径；任何 commit 都不得包含 `viewer/app.js` 或 `exports/`。

1. **`fix(data): separate dependency review provenance`**
   - `scripts/migrate-review-provenance.mjs`
   - `scripts/validate.mjs`
   - `scripts/review-ai-edge.mjs`
   - `scripts/build-stage-bridges.mjs`
   - `schema/cn-dependencies.schema.json`
   - `scripts/test/review-provenance-migration.test.mjs`
   - `scripts/test/review-ai-edge.test.mjs`
   - `data/cn-dependencies.json`
   - `data/cn-bridge-dependencies.json`
   - `data/manifest.json`

2. **`fix(api): restore upstream edges to the published graph`**
   - `scripts/review-policy.mjs`
   - `scripts/serve.mjs`
   - `scripts/test/review-policy.test.mjs`
   - `scripts/test/publication-safety.test.mjs`（只在 provenance invariant 需要更新 fixture 时修改）

3. **`feat(export): add deterministic published-graph JSONL`**
   - `scripts/export-jsonl.mjs`
   - `scripts/test/export-jsonl.test.mjs`
   - `Makefile`
   - `.gitignore`

4. **`feat(eval): report gold-set metrics by subject`**
   - `scripts/evaluate-ai-gold-set.mjs`
   - `scripts/test/evaluate-ai-gold-set.test.mjs`

5. **`ci: add open-source contribution gates`**
   - `.github/workflows/ci.yml`
   - `CONTRIBUTING.md`
   - `SECURITY.md`

6. **`docs: publish alpha limitations and current dataset facts`**
   - `README.md`
   - `BACKLOG.md`
   - `docs/reports/README.md`
   - `package.json`
   - `CHANGELOG.md`

切片理由：数据迁移可单独审计/回滚；API correctness 不与大 JSON diff 混审；export 和 eval 是独立功能；治理与文档最后接入已存在的命令。`data/manifest.json` 必须和两个迁移数据文件同 commit，不能挪到 docs commit。

## 6. 风险与回滚

| 风险 | 触发方式 | 防护 | 回滚 |
|---|---|---|---|
| 把 `reviewed` 再次误读为教师审核 | UI/外部消费者忽略 provenance | README 顶部 alpha warning；API/JSONL 保留 `reviewProvenance`；修正 server/schema 注释 | 回滚 docs 不够，需 revert provenance/API commit 并停止发布 |
| 43 条 bridge 的 human provenance 缺逐边身份 | legacy 数据只有文件级“人工精选”说明 | 明示 legacy 局限，不伪造 reviewer；新 human 写路径强制 audit | 若 owner 不接受 file-level 证据，将 43 条降为 machine，而不是改标 rule；重新 checksum/centrality/validate |
| 上游边被 stamp 后暴露上游本身的教学质量问题 | 3,221 条一次性重新进入儿童图 | `upstream` 是独立证据等级；不把它宣传为本地/教师审核；保持上游 topology contract | revert API commit；不会污染 translation data |
| covered topic 造成孤边或计数不一致 | node/edge 各自过滤 | path-data、summary、export 全部调用 `publishedGraph()`；端点测试 | revert对应代码；数据无损 |
| path-data 缓存继续返回旧图或压缩串包 | 一小时 public cache、缺 Vary | `no-cache` + `Vary: Accept-Encoding`，部署时重启进程 | 临时禁用 gzip；不恢复一小时 cache |
| 两文件迁移中途失败造成部分写入 | 进程在第一次写后中断 | 先 transform 两份、先 snapshot、无时间字段、可幂等重跑 | 从 snapshot 恢复两个文件并 checksum |
| checksum 顺序掩盖 manifest 漂移 | CI 运行 checksum 后继续而不检查 diff | checksum 后立即 `git diff --exit-code`，然后 validate | revert数据 commit并重新按顺序迁移 |
| JSONL 与 server merge 漂移 | 两处复制 topic merge | 只共享最关键的上游 stamp 和 `publishedGraph`；export fixture 检查 overlay、成员和端点 | 删除 `exports/` 并 revert export commit；API 不受影响 |
| upstream HEAD 漂移导致 CI 突然失败 | owner contract 要 clone live GitHub，仓库没有可用 tag | validate 检查 `upstreamVersion`、ID/evidence 对齐；失败视为同步信号，不自动改数据 | 临时以已知 commit checkout 复现，但长期必须完成 upstream sync 后再绿 |
| gold-set subject 汇总混合 relation/split 后算错 positive | 旧实现取组内第一条 kind | 每条 record 独立调用 `positiveLabel(record.kind)`；mixed-kind test | revert eval commit，不影响数据/API |
| 文档数字再次漂移 | 手工复制统计 | README 规模只引用 manifest 字段；CI 守 manifest；reports 的 1,640 明确标历史快照 | 修正文档 commit，不改数据 |

最重要的 rollback 边界是：provenance migration 没有删除边或修改审核结论，只有补充证据来源；API fix 也没有放宽 machine/rejected gate，只恢复 owner 明确要求保留的 upstream topology。因此两类变化都可按 commit 独立回退，不需要反向数据推理。

## 对 Plan A 的对抗评审

评审依据：planA 全文（含其自身已追加的「对 Plan B 的对抗评审」修订）+ 本轮独立复核（`jq` 实测、`grep`、源码与 `git log` 直接读取）。以下只对 planA 当前净立场表态，不重复其已自我撤回的旧论据。

### 分歧 1 · bridge 43 条 `rule`（A 原判）vs `human`（B）— **REBUT（A 的 `rule`）+ 自我修订（B 的落地方案）**

- 独立验证：`scripts/build-stage-bridges.mjs:33` 的 `DEPS_PATH` 只指向 `cn-dependencies.json`，全文件从未写 `cn-bridge-dependencies.json`；`grep -l cn-bridge-dependencies scripts/*.mjs` 命中的 8 个脚本（audit-granularity/checksum/dedupe-cn-topics/migrate-ai-safety/review-ai-edge/serve/snapshot/validate）全是消费者；`git log --diff-filter=A --format=%H\ %aI\ %s -- data/cn-bridge-dependencies.json` 精确定位到单次人工提交 `10e1ee9`（2026-07-17T22:15:08+08:00，"feat: 微主题原子拆解 + 跨学段知识依赖 + mt_↔mtc_ 桥接"），文件 `note` 自述"人工精选教学意义最强的对应关系"。仓库里不存在能生成这 43 条的规则脚本，`rule` 站不住，B 的方向对。
- 但 B 的落地有真实漏洞：给 43 条标 `human` 却不要求 `reviewedBy`/`reviewedAt`，validator 因此要开一条永久"legacy 例外"——未来任何真缺审计的人工边都能借这条例外混入 `human`，等于在小范围重演 finding②（评审出处不可辨）。
- 净修订：43 条仍标 `human`，改为补可核验（非编造）审计字段：`reviewedBy: 'project-curation'`（不称 teacher，避免 finding② 重演）、`reviewedAt` 取提交 `10e1ee9` 的作者时间，**写成迁移脚本里的字面量常量**，不要在脚本里现跑 `git log`——CI 的 `actions/checkout@v4` 默认浅克隆，历史提交未必可达，现跑会让 CI 随机失败。此修订落地后 validator 不再需要任何例外分支（见分歧 3）。

### 分歧 2 · 65 条 `machine` 边命中 L3 规则模板 — **REBUT（不构成对 B 的反例；数据本身属实）**

- 独立复核：`jq` 精确命中 65 条，`reviewStatus` 全为 `machine`、`strength` 全为 `hard`、均无 `generationBatchId`，与 planA §0.3 完全一致；`scripts/_rule-deps.mjs` 的 `buildRuleEdges` 确实生成 `<domainA> 是 <domainB> 的先修：` 模板（docstring 自称"L3"），A 的引用是真实代码，不是编造。
- 但 B 的 `inferReviewProvenance`（`scripts/migrate-review-provenance.mjs`）判断顺序是 `status` 优先：`machine` 直接 `return undefined`，从不读 `reason`。这 65 条从一开始就分配不到 provenance，谈不上"打破规则"——它们是"不能按 reason 猜"这条设计原则的额外证据，而不是对 B 的反例。

### 分歧 3 · validate 不变量：A 的双向检查 vs B 的单向检查 — **部分 CONCEDE**

- A §2.2.4 有一条 B 没有的检查：`(reviewProvenance === 'rule') === (reviewedBy === undefined)`。B 目前的 `checkReviewProvenance` 只检查 `rule ⟹ reviewed`，没检查 `rule ⟹` 无 `reviewedBy`——一条 `rule` 边意外被写上 `reviewedBy` 不会被拦下。
- 分歧 1 净修订后（43 条改成带审计字段的 `human`，不再是无审计例外），B 可以直接采用这条双向检查，不必再为 legacy 开例外——两处修订互相解锁。采纳：`checkReviewProvenance` 增加 `check((provenance === 'rule') === (edge.reviewedBy === undefined), ...)`。

### 分歧 4 · `scripts/test/docs-stats.test.mjs`：过度设计还是该留 — **CONCEDE，纳入 B**

B 现有 CI 只护「data 与 manifest」一致（checksum 漂移），没有任何东西护「README 文案与 manifest」一致——这正是 finding③ 的根因（README.md:7 与 README.md:235 同文件互相矛盾，是手工同步漏了一处，不是数据漂移）。不加这条测试，同类漂移下次照样发生；这不是过度设计，是给"文档数字"补一个它本该有的执行期契约。采纳 A 的思路新增该测试，按 label 文本定位数字。

### 分歧 5 · 合规漂移 809→1,069 / 209→290 — **CONCEDE，B 原文遗漏**

独立 `jq` 复核 `data/cn-topics.json`：`origin==='textbook'` 计 **1,069**（非 809），`nodeKind==='text' && origin==='textbook'` 计 **290**，全库 `nodeKind==='text'` 计 **291**——与 A 的"290/291"表述精确一致。当前过期文本确认：`README.md:208`「809 个教材来源节点，含 209 个具体阅读文本节点」、`PROVENANCE.md:62`「809 条 `origin: textbook` 微主题」、`PROVENANCE.md:68`「809 条教材来源节点中有 209 条 `nodeKind: text`」、`NOTICE:32`「209 records」。这几处在许可证/署名章节里，是对外合规表述，比 BACKLOG/reports 的口径漂移更敏感，B 的 WS3 原文完全没提，必须补进文档订正清单与 commit 6 的路径列表。

### Plan A 严格更优，B 采纳三处

1. **`scripts/test/docs-stats.test.mjs`**（分歧 4）：把文档防漂移变成可执行断言，B 完全没有这层防护。
2. **bridge 43 条的可核验审计字段方案**（分歧 1/3）：用一次性、可核验的 git 提交事实换掉 B 原本"validator 永久放行无审计 human"的无限期例外。
3. **JSONL 导出属性白名单**（`NODE_PROPS`，planA §2.5.2）：B 的 `without(topic, ['id'])` / `without(edge, [...])` 是黑名单式全量透传，会把 `rescopeRequired`/`rescopeBatchId`/`reviewNote`/`splitFrom`/`coveredBy` 等内部审核簿记、以及 `evidence`/`assessmentPrompt` 教学载荷，原样导出进对外互操作契约。互操作文件应是显式稳定的图结构契约，不是内部字段镜像。采纳白名单：节点取 `name/description/subject/domain/type/nodeKind/ageRangeStart/ageRangeEnd/stage/centrality/cnStandards/translationStatus`；边取 `strength/reason/reviewStatus/reviewProvenance`；`evidence`/`assessmentPrompt` 留在 `data/*.json`，不进 `exports/`。

### Plan A 的 bug（A 已自认，独立确认属实）

`scripts/build-stage-bridges.mjs:93` 只写 `reviewStatus: 'reviewed'`——独立读取该文件源码确认 `toAdd.push({...})` 对象里没有 `reviewProvenance` 字段。A 的原始 WS2（§2.2.5）只给 `review-ai-edge.mjs` 这一条人工写路径盖了章，漏了这条规则写路径：按 A 自己新增的 validate 不变量，任何人重跑该脚本都会立刻产出"reviewed 但缺 reviewProvenance"的边，撞上 A 自己的校验器。A 本轮已在其批判部分自我修订，但原始方案确有此缺口。

### 对本方案（Plan B）的净修订清单

| 处 | 修订 |
|---|---|
| WS2 迁移脚本 | bridge 43 条改标 `human` + 字面量常量 `reviewedBy: 'project-curation'`、`reviewedAt`（取 `10e1ee9` 的作者时间，写死在脚本里，不现跑 `git log`） |
| WS2 validator | `checkReviewProvenance` 增加 `(provenance==='rule') === (reviewedBy===undefined)`；删除"legacy human 免审计"例外分支 |
| WS3 文档 | 新增 `scripts/test/docs-stats.test.mjs`；文档订正清单加 `README.md:208`、`PROVENANCE.md:62,68`、`NOTICE:32`（809→1,069、209→290） |
| WS5 导出 | `toNodeRow`/`toRelationshipRow` 改为显式属性白名单（节点 12 字段、边 4 字段），去掉内部簿记与教学载荷字段的黑名单式透传 |
| Commit 切分 | commit 1（provenance 迁移+校验）纳入上述 validator/迁移变更；commit 6（文档）纳入 809/209 四处订正；commit 3（导出）纳入白名单改写与对应 fixture 更新 |
