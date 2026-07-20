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

### 2. 审核覆盖率 56.9%，976 条 machine 边待人工核对
- **现状**：cn-deps 2262 条中 reviewed 1286 / machine 976
- **处理**：按学科分批人工审核，优先数学/科学低龄段。viewer 已支持 toggle 切换查看
- **目标**：v1.3 达到 80%+，v1.4 全量 reviewed

## 低优先级

### 3. bridge 47 条全 soft，无 hard 桥
- **现状**：`strength: {soft: 47}`
- **判断**："上游概念是中国深化的基础"部分应是 hard（如 mt_分数概念 → mtc_有理数）
- **处理**：需要教学专家判断哪些是硬先修，逐条复核

### 4. 小学 mt_→mtc_ 桥为 0
- **现状**：bridge 全是 mt_（上游）→ mtc_（中国），方向单一；小学段无跨图桥
- **背景**：A2 的 8 条学段桥加在 cn-dependencies（mtc_↔mtc_），不在 bridge（mt_↔mtc_）
- **处理**：等 C1a 的 mt_ 小学数学节点对齐稳定后，补 mt_ 小学 → mtc_ 初中的跨图桥

### 5. manifest counts 与文档数字需在每次数据变更后同步
- **现状**：本次发版发现 manifest.counts.cnDeps（2254）和 CHANGELOG reviewed（1278）两处漂移
- **根因**：checksum.mjs 只更新 files（sha256/bytes），不更新 counts；counts 是手工维护
- **处理**：在 checksum.mjs 里加 counts 自动统计（从数据文件读真实计数），杜绝漂移

## 已修复（v1.2 发版时关闭）

- ✅ DAG 1250 短环 → 0 环（破环删 283 条）
- ✅ removeCycles 3 个 bug（_weak/pass<10/先破环后合并）
- ✅ LLM 边未审核面向儿童 → reviewStatus + viewer 降级
- ✅ centrality Top 20 全是课文 → nodeKind 字段过滤
- ✅ 4 条踩线 note 违反 codes-only → 改英文映射
- ✅ 小学数学课标 code 严重缺失（仅 12 条）→ 补 67 条
