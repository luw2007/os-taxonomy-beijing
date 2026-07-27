# os-taxonomy-beijing 发布加固 — 最终裁决方案（owner）

日期：2026-07-27 · Owner：claude-fable-5 · 输入：planA（Opus）+ planB（Codex）+ 双向对抗评审
实现基准：planA 为主文本，按下表裁决修订。planB 作为对照与失效模式清单。

## 裁决表（分歧 → 终裁）

| # | 分歧点 | 终裁 | 依据 |
|---|---|---|---|
| 1 | bridge 43 条 legacy 边 provenance：rule(A) vs human(B) | **human**，同时注入逐边审计 `reviewedBy: "project-curation"`、`reviewedAt: "2026-07-17T22:15:08+08:00"`（字面量，取自引入提交 10e1ee9 的 author date；不运行时调 git，防 CI 浅克隆） | build-stage-bridges.mjs 只写 cn-dependencies.json，从未写 bridge 文件；bridge 文件由人工提交引入且 note 自述「人工精选」。双方复核一致 |
| 2 | provenance 映射信号 | 只依据 `(reviewStatus, reviewedBy)`，绝不解析 reason 文本；generationBatchId 不作为信号（207/554 与审核等级无相关） | 65 条 machine 边命中 L3 rule 模板的反例；双方一致 |
| 3 | validator 对 human 的要求 | `human`/`ai-consensus` 必须携带 `reviewedBy`+`reviewedAt`（不留免审计后门）；`rule` ⟺ 无 `reviewedBy`（双向校验）；`upstream` 禁止持久化进任何 data 文件；provenance 仅允许出现在 reviewed/rejected 边上；machine 边不得携带 provenance | A 的不变量 + B 的双向校验补强 |
| 4 | publishedDeps 计算 | serve.mjs 单次计算 `publishedGraph`，同源喂 `/api/path-data` 与 `/api/summary.publishedDeps`；保留 `!s1||!s2` 孤点守卫 | A 原 pathData.edges.length 反推是错耦合（会丢 !s1||!s2 边）；B 删守卫是回归 |
| 5 | path-data 缓存 | 保留 `public, max-age=3600`，**新增 `Vary: Accept-Encoding`**；不做全局 no-cache | RFC 9111 §4.1；localhost 场景陈旧窗口可接受 |
| 6 | CI 顺序 | test → validate --publish（含上游对齐）→ checksum → `git diff --exit-code data/manifest.json`（step 名 Manifest drift）；`permissions: contents: read` | A 顺序成立；B 的失效场景不适用但命名与权限收紧采纳 |
| 7 | JSONL 导出属性 | **白名单**（不透传 rescopeRequired / previousReviewStatus / reviewNote / splitFrom / coveredBy 等内部簿记） | B 的全量透传会泄漏内部审核簿记 |
| 8 | docs-stats.test.mjs | 保留（README/BACKLOG 数字对 manifest 的可执行断言） | B CONCEDE，命中 finding③ 根因 |
| 9 | build-stage-bridges.mjs 写路径 | 同步补 `reviewProvenance: 'rule'`（:93 附近），否则重跑即违反新校验 | 双方确认的真实缺口 |
| 10 | 合规漂移 | README.md:208、PROVENANCE.md:62/68、NOTICE:32 的 809→1,069（origin=textbook）、209→290（其中 nodeKind=text）需修正 | 双方 jq 独立复核一致 |

## 固定契约（所有开发 slice 必须遵守）

- `reviewProvenance` enum：`upstream | rule | ai-consensus | human`。upstream 仅在 serve.mjs / export 合并时打标，永不落盘。
- cn-deps 映射结果（迁移脚本必须复现）：rule 985 · ai-consensus 761（reviewed 341 + rejected 420）· machine 873 不打标；bridge：human 43（补审计字段）· ai-consensus 4。rejected 且无 reviewedBy → 迁移脚本报错退出（当前应为 0）。
- manifest 新增派生计数（checksum.mjs 从真实数组统计）：`counts.cnDepsReview = {reviewed, machine, rejected}`、`counts.cnBridgeReview = {reviewed, rejected}`、`counts.cnDepsProvenance = {rule, "ai-consensus", human}`。
- `/api/summary` 新增 `publishedDeps`；`totalDeps` 保持原义（raw 合并总数）。
- 发布图预期规模（迁移后自检基准）：nodes 3,549 / edges 4,553（上游 3,221 + cn reviewed 非 rescope 且端点未过滤 1,286 + bridge 46）。
- 数据写入顺序：snapshot → migrate → checksum → validate --publish（owner 在验证阶段统一执行；开发 slice 只写代码不跑迁移、不跑测试套件）。
- 禁触：viewer/app.js（用户未提交改动）。zh 数据文件保持 translation-only。
- serve.mjs:215-217 的「reviewed=人工通过」错误注释必须改为按 provenance 分级的准确描述。

## Slice 划分（并行）

- **A（核心策略）**：review-policy.mjs、serve.mjs、validate.mjs、schema/cn-dependencies.schema.json、scripts/migrate-review-provenance.mjs（新）、build-stage-bridges.mjs、review-ai-edge.mjs、scripts/test/{publication-safety,review-policy,review-ai-edge}.test.mjs 更新 + migrate 新测试。
- **B（文档与统计真源）**：checksum.mjs 派生计数、README.md（状态行、alpha 声明、roadmap 数字、:208）、BACKLOG.md（68→109 等）、docs/reports/README.md（1,640→2,008 + origin 分布）、PROVENANCE.md:62/68、NOTICE:32、package.json（删 homepage）、scripts/test/docs-stats.test.mjs（新）、scripts/test/checksum-counts.test.mjs 更新。不碰 .gitignore。
- **C（协作基建）**：.github/workflows/ci.yml、CONTRIBUTING.md（codes-only 红线 + 边审核工作流 + 数据变更顺序 + PR checklist）、SECURITY.md。全部新文件。
- **D（互操作与评估）**：scripts/export-jsonl.mjs（新，白名单属性 + exports/manifest.json 含 ODbL/CC-BY-SA 署名）、Makefile export-jsonl target、.gitignore 加 exports/、evaluate-ai-gold-set.mjs 分学科 precision + --json、scripts/test/evaluate-ai-gold-set.test.mjs 更新。

## 验证闸门（owner 执行）

snapshot → migrate（--dry-run 先行）→ checksum → npm test → validate --dag --publish（含上游）→ serve 冒烟（/api/summary.publishedDeps=4553、/api/path-data 边数、Vary 头）→ export-jsonl 冒烟 → Sonnet review → 修复 → 分单元提交。
