# Implementation Notes — release hardening（provenance / 发布策略 / 互操作）

日期：2026-07-27 · 关联方案：`docs/plans/os-taxonomy-beijing-20260727-release-hardening-final.md`（planA/planB 同目录）

## 流程

对抗式规划（Opus planner vs Codex planner，双向互评后 owner 裁决）→ 4 个并行 Codex 开发 slice → Sonnet review（SHIP-AFTER-P1：0 P0 / 5 P1 / 14 P2）→ owner 修复 → 全量闸门。

## 超出方案文本的关键决策

1. **bridge 43 条 legacy 边 = `human` + `reviewedBy: "project-curation"`**。两位 planner 分别主张 rule / human，取证一致后合成：build-stage-bridges.mjs 从未写过 bridge 文件，该文件由人工提交 10e1ee9 引入（note 自述「人工精选」）。`reviewedAt` 用该提交 author date 的字面量（2026-07-17T22:15:08+08:00），不在运行时调 git——CI 浅克隆下 `git log` 不可靠。
2. **985 条 cn `rule` 边的证据**：planA 实测 L1 同学段相邻链 903 + L2 跨学段链 74 + stage-bridges 硬编码表 8 = 985，与「reviewed 且无 reviewedBy」集合完全重合；同时存在 65 条 machine 边命中 L3 规则 reason 模板的反例，证明映射只能依据 `(reviewStatus, reviewedBy)`，绝不能解析 reason 文本。
3. **上游边 stamp-at-merge，不落盘**：`dependencies.zh.json` 保持 translation-only（README 设计不变量）；validate 新增 zh 文件字段白名单（topicId/prerequisiteId/strength/reason）双保险。
4. **API 与导出共用 `PUBLISHED_EDGE_PROPS` 白名单**：review 发现 `/api/topic/:id` 原样透传 reviewNote（含双 Opus 审核英文 prose 与模型身份）等 6 个内部簿记字段；修复后 HTTP 与 JSONL 两个消费者共用一个名单。
5. **`alignedMath` 分档缺口**：high 215 + medium 120 + low 109 = 444 ≠ 446，差 2 条未归档节点，已在 BACKLOG 记录，原因待对齐工作时清点（不臆造解释）。

## 被否决的方案（含理由）

- bridge 边标 `rule`（事实错误：非脚本产出）；validator 给无审计 human 留例外（永久后门）；全 API no-cache（gzip 体已增至 ~180KB，净退步）；导出属性全量透传（泄漏内部簿记）；generationBatchId 作为 provenance 信号（与审核等级无相关，207/554）。

## 有意延后（非遗漏）

- P2-2：serve 与 export 的 topic 合并仍是双份实现，采用双向同步注释而非抽取（当前只有两个消费者，抽取收益 < 接口复杂度；第三个消费者出现时再抽）。
- P2-11：未新建 `schema/cn-bridge-dependencies.schema.json`；以 CONTRIBUTING 声明「schema 仅描述性、validate.mjs 权威」代替。
- P2-6：跨 kind 聚合 kappa 仅加注释警示，未重构指标（分组内 kappa 已是权威口径）。
- Sonnet review 的 open question（985 rule 边中是否混入手改边）：以决策 2 的模板重合证据视为已回答；如未来发现手改边，降级该边为 machine 即可，不影响架构。

## 环境限制

- 用户指定的 glm-5.2 测试角色在本 harness 无路由，以本地真实执行（npm test 73/73、validate --dag --publish、serve/浏览器/导出冒烟）替代。
- 仓库无 remote：CI workflow 已就位但未在 GitHub 实际运行过；首推后需确认 ubuntu runner 的 jq 步骤与上游 checkout。
