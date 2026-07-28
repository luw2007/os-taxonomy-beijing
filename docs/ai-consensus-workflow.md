# 三角色 AI 共识工作流

该工作流只处理 `data/cn-dependencies.json` 中当前明确标为 `reviewStatus: "machine"`、且没有重定责/年龄倒退隔离标记的边。三角色分别检查必要性、方向和反例；只有三个不同实际模型对同一边严格一致返回 `reviewed` 与同一解析后 strength，才生成可应用 proposal。`rejected` 一致或任何分歧都只进入审计证据，不修改边。

## 重要限制

**OMP harness 不能证明架构层级的 subagent peer isolation。** 外部角色调用器按构造只收到该角色自己的 prompt、身份和原始 packet，不把任何 sibling role 输出放入其输入；这只是本仓库输入构造的性质，不能写成或理解为 architecture-grade blind-isolation guarantee。

## 配置与凭证

复制 `reviews/ai-consensus/v1/roles.example.json`，为 necessity、direction、adversary 分别配置 endpoint、model、credential 环境变量名、system prompt 和 timeout。三份 configured model identifier 必须不同；调用返回的三份 actual model identifier 也必须不同，否则整包失败关闭。

凭证只放环境变量，不写配置或证据文件：

```bash
export AI_CONSENSUS_NECESSITY_API_KEY=...
export AI_CONSENSUS_DIRECTION_API_KEY=...
export AI_CONSENSUS_ADVERSARY_API_KEY=...
```

## 安全操作顺序

先导出带来源 checksum 和逐边 content fingerprint 的 machine-edge packet：

```bash
node scripts/export-review-packet.mjs --subject Mathematics --limit 50 --out /tmp/math-review.json
```

离线检查不会调用模型或写文件：

```bash
npm run consensus:review -- --packet /tmp/math-review.json --config reviews/ai-consensus/v1/roles.example.json --plan
npm run consensus:review -- --packet /tmp/math-review.json --config reviews/ai-consensus/v1/roles.example.json --dry-run
```

显式写证据时才调用三个角色。缺少任一凭证、任一响应超时或 schema/edge-set 校验失败，整包不生成 proposal，但失败证据仍原子写入版本化 reviews 目录：

```bash
npm run consensus:review -- --packet /tmp/math-review.json --config reviews/ai-consensus/v1/roles.example.json --run-id math-20260727-01 --write
```

review 命令从不修改 data。应用是独立命令；先离线查看逐边 CAS 结果，再显式写：

```bash
npm run consensus:apply -- --evidence reviews/ai-consensus/v1/runs/math-20260727-01.json --dry-run
npm run consensus:apply -- --evidence reviews/ai-consensus/v1/runs/math-20260727-01.json --config reviews/ai-consensus/v1/roles.example.json --write
```

apply 会重新验证完整证据并从三份投票重新推导 consensus。每个 proposal 只在 live edge 仍为 `machine` 且 content fingerprint 未变化时应用；单边冲突不会阻断其他有效边。`--write` 先取得本地 single-writer lock，再重新读取依赖数据与 topic 上下文并执行上述检查，避免把锁外预检快照直接写回；落盘使用同目录临时文件、fsync 和 rename。完成后按仓库流程更新 manifest checksum 并运行数据校验。

apply 还会在处理任何 proposal 前，对本轮所有 proposal 的两端 topic 重新执行审阅包白名单投影并与 packet 比较；教学上下文有一处漂移就整轮中止，`centrality` 不在投影中，因此单独重算核心度不会制造漂移。live machine edge 若带 `rescopeRequired`、`previousReviewStatus`、`ageRegression`、`reviewNote`、`reviewerRole` 或 `reviewRubric`，会作为 quarantined conflict 原样保留。apply `--write` 只核对配置中的三个 model 与证据一致，不再要求 provider 凭证；全 stale 或重放导致零可应用 proposal 时拒绝写数据。

Makefile 只暴露离线目标，不提供写入捷径：`make consensus-plan PACKET=... CONFIG=...`、`make consensus-dryrun PACKET=... CONFIG=...`、`make consensus-apply-plan EVIDENCE=...` 和 `make consensus-apply-dryrun EVIDENCE=...`。显式执行 CLI 的 apply `--write` 后，运行 `make consensus-postapply UPSTREAM=../os-taxonomy`，依次完成 checksum、publish validate、测试与 strict term lint。

角色 identity、reason、reference/citation 只保存在 `reviews/ai-consensus/v1/runs/*.json`。apply 只把派生的 `reviewedBy`、时间和内部 evidence reference 写入数据；公开 JSONL、CASE 和 HTTP topic/path 投影继续通过既有白名单排除这些审计字段。

版本化 evidence 证明的是：给定其中保存的 packet、三个角色 identity、request、raw response 与 votes，可以得到一份 self-consistent（自洽）、hash-sealed 的确定性派生结果。它不是 provider attestation，不能证明远端服务真实执行了所声明的模型，也不能把 transport response id 当成这种证明。发布闸门会从 evidence 重建 proposal 和应用前 machine edge 指纹；旧的 `user-delegated-claude-opus-consensus` 数据仍按 legacy 规则有效，但不能伪装为 v1 证据绑定。
