# v1.3 Backlog

v1.2.0-zh.0 发版时已确认的已知问题/增量改进。经 opus + omp 双审确认均**非正确性缺陷**，
是增量迭代项。按优先级排序。

## 中优先级

### 1. C1a-2 跳过的 68 条 low 置信度数学节点未对齐
- **现状**：398 个小学数学节点中 329 条已对齐（high 213 + medium 116），68 条 low 被跳过
- **原因**：含结构性错位（age 5-7 的"一半/四分之一"分数概念被分到 S1 而非 S2；时间/金钱类节点塞进容量比较）
- **manifest 字段**：`alignedMathLowExcluded: 68`
- **处理**：逐条判断是"几何分割概念"还是"真分数"，重新对齐或新建中国特有节点
- **缓存位置**：`data/.align-work/`（gitignored）里有完整 398 条原始 LLM 响应

### 2. 审核覆盖率 37.6%，1,634 条 machine 边待人工核对
- **现状**：cn-deps 2,619 条中 reviewed 985 / machine 1,634；其中 761 条旧父边因主题拆分后语义收窄标记 `rescopeRequired`，301 条原 reviewed 已降级
- **处理**：使用 `review-ai-edge.mjs` 按边审核为 reviewed/rejected；儿童 viewer 不提供 machine 边入口
- **目标**：先清零 `rescopeRequired`，再基于教师 gold set 校准发布覆盖率，不预设任意百分比

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
- ✅ 拆分首子主题复用父 ID 导致旧边语义漂移 → 761 条边隔离重审，301 条 reviewed 降级；发布路径仅使用 reviewed、非 rescope 边
