# 发布流程

本项目目前没有公开 remote 或已执行的 GitHub Actions run；下列流程定义公开托管后的可复现发布闸门，不能作为既有发布记录。

1. 从干净工作树的候选提交运行 `npm test`。
2. 用固定上游 checkout 运行 `node scripts/validate.mjs --publish --upstream ../os-taxonomy`。
3. 运行 `node scripts/checksum.mjs`，确认只产生预期的 `data/manifest.json` 变更；提交该变更后重跑校验。
4. 导出 JSONL 两次并逐字节比较 `nodes.jsonl`、`relationships.jsonl`、`manifest.json`。
5. 导出 CASE：`node scripts/export-case.mjs --base-url <公开基础 URL> --upstream ../os-taxonomy`，再运行 `node scripts/validate-case.mjs`。required-field gate 不是完整 JSON Schema validator。
6. 确认 CI 对候选提交运行成功后，创建与 `data/manifest.json.taxonomyVersion` 匹配的 Git tag，并在 release notes 写明固定上游 revision、数据限制和验证证据。

版本号遵循 `<上游版本>-zh.<中文修订号>`。不发布不存在的公开 URL、CI run 或教师审核证明。
