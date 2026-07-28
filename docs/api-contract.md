# 本地 HTTP API 契约

服务由 `node scripts/serve.mjs` 提供，默认仅绑定 `127.0.0.1`。这是 alpha 阶段的本地浏览器 API，不是托管服务或版本化 REST 平台；当前没有 `/v1` 路径、内容协商或稳定性承诺。

## 主题公开投影

`GET /api/topics` 返回 `{ count, topics }`；`GET /api/topic/:id` 的 `topic` 使用相同的公开字段，详情额外包含 `dimensionVisible`。公开 topic 字段由 `review-policy.mjs` 的 `PUBLISHED_TOPIC_PROPS` 唯一定义：

- 识别与定位：`id`、`name`、`subject`、`domain`、`ageRangeStart`、`ageRangeEnd`、`type`、`nodeKind`、`centrality`
- 教学显示：`description`、`evidence`、`assessmentPrompt`、`translationStatus`、`translated`、`subjectZh`、`domainZh`
- 对齐：`cnStandards`

以下内部构建簿记不是 HTTP 契约，绝不出网：`splitFrom`、`coveredBy`、`status`、`splitPart`、`granularity`、`stage`、`origin`、`generationBatchId`。

详情中的已审核边使用 `PUBLISHED_EDGE_PROPS`；审核 identity、时间、角色投票 reason、reference/citation、rubric 和 evidence reference 不出网。`reviewProvenance` 不是资格证明。

## 其他端点

当前服务还提供 `/api/summary`、`/api/subjects`、`/api/clusters`、`/api/standards`、`/api/dimensions`、`/api/path-data`、`/api/textbook-gaps`、`/api/chat` 和 `/api/resolve`。请求参数与 payload 以 `scripts/serve.mjs` 为准；在公开托管并发布正式版本化契约前，外部消费者不应假定新增字段或端点永久稳定。

## 互操作导出

需要机器交换而非浏览器 UI 时，优先使用可复现的 JSONL 或离线 CASE CFPackage 导出：

- `node scripts/export-jsonl.mjs --upstream ../os-taxonomy`
- `node scripts/export-case.mjs --base-url <公开基础 URL> --upstream ../os-taxonomy`

JSONL 的字段集比 HTTP topic projection 更窄；CASE required-field gate 不是完整 JSON Schema validator。
