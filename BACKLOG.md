# v1.3 Backlog

v1.2.0-zh.0 发版时已确认的已知问题/增量改进。经 opus + omp 双审确认均**非正确性缺陷**，
是增量迭代项。按优先级排序。

## 中优先级

### 1. C1a-2 跳过的 109 条 low 置信度数学节点未对齐
- **现状**：446 个小学数学节点中 335 条已对齐（`alignedMathHigh` 215 + `alignedMathMedium` 120），
  109 条 low 被跳过（`alignedMathLowExcluded`）
- **原因**：含结构性错位（age 5-7 的"一半/四分之一"分数概念被分到 S1 而非 S2；时间/金钱类节点塞进容量比较）
- **manifest 字段**：`alignedMathLowExcluded: 109`
- **处理**：逐条判断是"几何分割概念"还是"真分数"，重新对齐或新建中国特有节点
- **缓存位置**：`data/.align-work/`（gitignored）里有完整对齐节点的原始 LLM 响应
- 口径以 `data/manifest.json` 为准；CHANGELOG 1.2.0 里的 68/398 是 Mathematical Thinking 扩展前的旧口径
- 注：high 215 + medium 120 + low 109 = 444，距总量 446 尚有 2 条未归入任一档的节点，待对齐时一并清点归档

### 2. 审核覆盖率 50.6%，873 条内部 machine 边待人工核对
- **现状**：761 条内部和 4 条 bridge `rescopeRequired` 已由用户授权的两轮独立 Claude Opus 审核处理；两轮一致 724 条，41 条分歧按保守策略拒绝，最终 reviewed 344 / rejected 421。该 provenance 明确为 AI 委托审核，不冒充教师审核
- **当前图**：cn-deps 2,619 条中 reviewed 1,326 / machine 873 / rejected 420；bridge 47 条中 reviewed 46 / rejected 1；`rescopeRequired` 已清零
- **目标**：对剩余 873 条 machine 边使用教师 gold set 和人工校对继续审查，不预设任意覆盖率；儿童 viewer 仍不提供 machine/rejected 边入口

## 低优先级

### 3. bridge 47 条全 soft，无 hard 桥
- **现状**：`strength: {soft: 47}`
- **判断**："上游概念是中国深化的基础"部分应是 hard（如 mt_分数概念 → mtc_有理数）
- **处理**：需要教学专家判断哪些是硬先修，逐条复核

### 4. 小学 mt_→mtc_ 桥为 0
- **现状**：bridge 全是 mt_（上游）→ mtc_（中国），方向单一；小学段无跨图桥
- **背景**：A2 的 8 条学段桥加在 cn-dependencies（mtc_↔mtc_），不在 bridge（mt_↔mtc_）
- **处理**：等 C1a 的 mt_ 小学数学节点对齐稳定后，补 mt_ 小学 → mtc_ 初中的跨图桥


## 已修复（v1.2 发版时关闭）

- ✅ DAG 1250 短环 → 0 环（破环删 283 条）
- ✅ removeCycles 3 个 bug（_weak/pass<10/先破环后合并）
- ✅ LLM 边未审核面向儿童 → reviewStatus + viewer 降级
- ✅ centrality Top 20 全是课文 → nodeKind 字段过滤
- ✅ 4 条踩线 note 违反 codes-only → 改英文映射
- ✅ 小学数学课标 code 严重缺失（仅 12 条）→ 补 67 条
- ✅ manifest counts 依赖手工同步 → `checksum.mjs` 从真实数据数组自动统计
- ✅ 拆分首子主题复用父 ID 导致旧边语义漂移 → 761 条内部边和 4 条 bridge 边隔离；用户授权双 Opus 重审后 reviewed 344 / rejected 421，发布门禁恢复通过
