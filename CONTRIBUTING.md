# 贡献指南

本仓库是**数据集 + 零依赖工具链**。所有改动最终都要能通过 `npm test` 与
`node scripts/validate.mjs --publish --upstream ../os-taxonomy`（CI 会跑同一套闸门，
见 [`.github/workflows/ci.yml`](.github/workflows/ci.yml)）。

## 一、合规红线：codes-only（违反者一律拒绝合并）

教育部课标在本项目里**只以编号键的形式出现**（如 `moe-2022-math:S1.NA.01`），
详见 [PROVENANCE.md](PROVENANCE.md) 的「codes-only 原则」。PR 中**不得出现**：

- 课标条文原文、内容要求、学业质量描述的任何逐字文本（中英文皆不可）
- 教材正文、插图、练习题、版式、页码
- `data/cn-curriculum-standards.json` 里出现 `data` 字段或 `textIncluded: true`

`description` / `evidence` / `assessmentPrompt` 必须是**自拟的教学化表达**，不是课标
或教材的改写。`scripts/validate.mjs` 会硬性拦截 `textIncluded !== false` 和条目里出现
`data` 字段的情况，但"改写得像原文"只能靠人工 review——审阅者发现疑似逐字改写必须
拒绝，即使数据本身格式合法。

## 二、改数据的固定顺序

```bash
node scripts/snapshot.mjs --label pre-<改动名>                  # 1. 回滚点（本地，gitignored）
#    ... 用对应脚本编辑数据（不要手改 JSON） ...
node scripts/checksum.mjs                                       # 2. 重算 manifest 计数与校验和
node scripts/validate.mjs --publish --upstream ../os-taxonomy   # 3. 校验
npm test                                                         # 4. 单测
```

顺序不能换：`validate` 会比对 `data/manifest.json` 的 SHA-256，数据改了不先跑
`checksum` 必然校验失败；跑完 `checksum` 却不 `git add data/manifest.json` 同样会在
CI 的 `Manifest drift` 步骤失败。

## 三、依赖边的审核工作流

每条依赖边（`cn-dependencies.json` / `cn-bridge-dependencies.json`）有两个正交字段：

| 字段 | 含义 |
|---|---|
| `reviewStatus` | `machine`（未经任何审核，不进发布图）/ `reviewed`（通过，进发布图）/ `rejected`（拒绝） |
| `reviewProvenance` | 审核结论的证据等级，仅四档：`upstream`（上游自带的边，只在服务端合并/导出时打标，**永不写入 data 文件**）/ `rule`（确定性规则脚本产出，脚本自动盖章，不需要 `reviewedBy`）/ `ai-consensus`（用户授权的 AI 批量复审）/ `human`（人工审核） |

**只有 `reviewProvenance: human` 的边才能在文档、note 或 PR 描述里被称为"人工审核"**。
`ai-consensus` 不是人工审核，不得如此描述或暗示。`reviewProvenance: human / ai-consensus`
的边必须带 `reviewedBy` + `reviewedAt`；`rule` 边则禁止携带 `reviewedBy`（迁移与校验
脚本对此做双向强制）。`rejected` 且没有 `reviewedBy` 会被判定为不合规数据，直接报错。

**不要手改 JSON**。人工或 AI 复审一条边走 `scripts/review-ai-edge.mjs`：

```bash
node scripts/review-ai-edge.mjs \
  --topic mtc_553 --prerequisite mtc_047 \
  --status reviewed --reviewer <你的标识> --provenance human \
  --note "先修关系在收窄后的主题上仍成立" --dry-run   # 确认无误后去掉 --dry-run

# 桥接边（跨上游/中国特有微主题）加 --bridge，写 cn-bridge-dependencies.json
node scripts/review-ai-edge.mjs --bridge --topic mtc_yyy --prerequisite mt_xxx \
  --status reviewed --reviewer <你的标识> --provenance human --dry-run

node scripts/checksum.mjs
node scripts/validate.mjs --publish --upstream ../os-taxonomy
```

`--provenance` 默认 `human`；只有一次性批量 AI 复审脚本才允许写 `ai-consensus`，且必须
在 PR 描述里写明所用模型、复审轮次和分歧处理策略，方便审阅者判断证据强度。

`schema/*.json` 仅为描述性文档；权威校验以 `scripts/validate.mjs` 为准（CI 强制执行）。

## 四、翻译校对贡献路径

上游微主题文本经 `npm run translate`（`scripts/translate.mjs`）批量机翻后写入
`topics.zh.json` / `dependencies.zh.json`，标记 `"translationStatus": "machine"`。
把某条译文校对为符合中文教学语境的表达后：

1. 直接修正 `name` / `description` / `evidence` / `assessmentPrompt`（保留
   `{{name}}` 占位符、`evidence` 条数与上游一致）；
2. 把该条目的 `translationStatus` 从 `"machine"` 手工改为 `"reviewed"`
   （这是本项目里唯一允许手改 JSON 字段的例外——目前没有为此单独建审核脚本）；
3. 跑 `node scripts/checksum.mjs` 更新计数。

`"reviewed"` 校对结果不会被 `translate.mjs` 的后续批量运行覆盖（`--force` 除外）。

## 五、PR 检查清单

- [ ] 无课标/教材原文（第一节）
- [ ] 数据改动跑过 `checksum`，`data/manifest.json` 的 diff 不为空且已一并提交
- [ ] `npm test` 通过
- [ ] `node scripts/validate.mjs --publish --upstream ../os-taxonomy` 通过
- [ ] 新增/修改的边带正确的 `reviewProvenance`，且没有把 `ai-consensus` 描述成人工审核
- [ ] 涉及 `translationStatus: machine → reviewed` 的，改动仅限译文字段本身
- [ ] 提交只包含本次改动涉及的路径（不要 `git add -A` / `git add .`）

## 六、许可

贡献即同意按仓库的分层许可发布：代码 MIT、数据库 ODbL 1.0、原创及有权许可的文本
CC BY-SA 4.0（见 [LICENSES.md](LICENSES.md)）。
