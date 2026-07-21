# Changelog

本项目是 [Marble Skill Taxonomy](https://github.com/withmarbleapp/os-taxonomy) 的中文衍生版。
版本号格式：`<上游版本>-zh.<中文修订号>`（如 `v1-zh.0`）。

## [1.2.0-zh.0] — 2026-07-20

**DAG 完整性 + 审核闸门 + 核心度 + 课标对齐**。经 omp + opus 多轮双审迭代完成。

### 初高中微主题粒度优化
- 新增 `scripts/audit-granularity.mjs`，使用 deepseek-v4-flash 按 `subject|stage` 审计初高中微主题，以普通学生 45 分钟内完成全部掌握证据为上限。
- 全量审计 1,463 条未拆主题，人工抽查后逐科应用 238 个父主题，新增 340 个子主题；49 个父主题已被现有节点覆盖，111 个边界不清的主题留待人工复核。
- `cn-topics` 由 1,668 增至 2,008；拆分子主题使用 `splitFrom` 记录来源，不臆造平行子主题之间的先修关系，`cn-dependencies` 保持 2,290 条。
- 缓存绑定模型与完整 prompt；LLM 批次失败不覆盖审核文件；正式 apply 前重新验证父主题时长、子主题数量/时长和全局重名。
- 使用 `scripts/backfill-split-relations.mjs` 对 340 个零度 `splitFrom` 子主题运行 deepseek-v4-flash 增量关系审计：356 个先修提案中只追加 329 条 `machine` 边；拒绝重复 24 条、成环 1 条、跨学段倒退 2 条。旧 2,290 条边保持原内容和顺序，相关但非先修的 83 条关系仅保留在 gitignored work 文件。
- 同步 `manifest.json`、README 与 BACKLOG 的上层统计；`scripts/checksum.mjs` 现从真实数据数组自动更新主题、依赖、聚类和课标计数，避免后续数据变更再次产生手工计数漂移。
- Claude Opus 复审后采用 Option B：260 个复用父 ID 家族触及的 761 条旧边全部标记 `rescopeRequired`，其中 301 条旧 reviewed 降级为 machine；49 个 covered 父主题持久化 `coveredBy` 并退出儿童视图。
- 拆分 apply 新增强制 child 完整性、重复 ID、确定排序和旧边重定责；关系 apply 新增输入图 fingerprint、批次 provenance、年龄倒退警告及受控结构/课标候选召回。
- 儿童 API、详情页和知识脉络只使用 reviewed 且非 rescope 的边；canonical centrality 同样只由可发布边计算。迁移后 reviewed 985 / machine 1,634（37.6%），纠正此前被语义漂移旧边虚高的覆盖率。

### DAG 完整性修复（P0/v1.1）
- **破环**：删 283 条成环边（含 200 反平行对），密度 1.55→1.377，0 含环 SCC。删除旧 `removeCycles` 的 3 个 bug（`_weak` 未赋值/`pass<10` 上限/先破环后合并导致重新成环），重写为 `scripts/break-cycles.mjs`（迭代 Tarjan + 贪心评分，全局破环）。
- **审核闸门**：每条依赖边加 `reviewStatus`（machine/reviewed/rejected）。规则边标 reviewed（1286）/ LLM 边标 machine（976），覆盖率 56.9%。viewer 默认只展示 reviewed，machine 边降级为"AI 推测·未核对"。
- **快照机制**：`scripts/snapshot.mjs`（--list/--diff）+ Makefile 目标 + git tag `data-snapshot-v1-pre-fix`。

### 核心度 + 节点类型（B1）
- **nodeKind 字段**：concept(1183) / text(210, 课文) / skill(247)。区分可迁移知识点 vs 一次性课文。
- **centrality**：只对 concept+skill 计算（下游可达概念数/maxReach，逆向工程上游算法 r=0.79）。text 节点 centrality=null。修复 v1 语义污染（Top 20 不再是课文）。
- 双审发现并修复："太空一日"等课文虚高问题 → 引入 nodeKind 字段（opus 方案）。

### 学段桥（A2）
- 新增 8 条小学→初中强桥（道法 4 + 语文 4）。小学作 prereq 边 16→24。
- KPI：≥30 目标由 C1a Math/Science 桥补足。

### 合规整改
- 清理 4 条踩线 note（S1.NA.01/02, S1.O.01/03 含中文课标短语，违反 codes-only）。改为英文映射提示。

### 小学数学课标对齐（C1a）
- **C1a-1**：补 67 条小学 NA/GE/SP 课标 code（原仅 12 条）+ 77 条英文 note 区分覆盖范围。
- **C1a-2**：用 Claude Sonnet 5 对齐 398 个 mt_ 小学数学节点。写入 329 条（high 213 + medium 116），跳过 68 条 low（含分数边界 case + 时间金钱错位，留 fix-list）。
- 4 轮双审迭代：试跑→补 note→修 reason→mask low。

### 桥冲突分析（P2）
- 47 条 cn-bridge 无真冲突（无反向边/重叠/多 prereq 冗余）。
- bridge 加 reviewStatus（审核闸门一致性）。

### 工具链
- omp 恢复（claude_sub2api 本地 Claude Sonnet 5 代理，替代余额耗尽的智谱 API）。
- align 脚本支持 anthropic 格式（`LLM_API=anthropic`）。

### 测试
- 31 个单元测试：破环(10) + centrality/nodeKind(15) + align-utils(6)。
- validate 加 DAG 断言（Kahn 拓扑）+ nodeKind + reviewStatus 校验。

## [1.0.0-zh.0] — 2026-07-14

骨架版本（skeleton）。项目基础设施搭建完成，含数学、科学两个学科的少量示例数据。

### 项目结构
- 目录结构、JSON Schema、零依赖校验脚本。
- LICENSE（ODbL 1.0）+ LICENSE-CONTENT（CC BY-SA 4.0）全文，继承自上游。
- 合规文件 PROVENANCE.md：教育部课标 codes-only 策略、教材版本说明。

### 已含数据（示例）
- **4 个微主题**（中文翻译）：数学 2 + 科学 2。
- **4 条前置依赖**（reason 中文化）。
- **4 个领域聚类摘要**（中文化）。
- **2 套中国课标 / 4 个编号键**（moe-2022-math、moe-2022-sci，codes-only）。

### 工具脚本
- `validate.mjs`：结构校验 + 上游对齐 + cnStandards 引用完整性 + 校验和。
- `sync-upstream.mjs`：检测上游结构变更，报告待翻译/已漂移的 topic。
- `checksum.mjs`：更新 manifest 的 SHA-256 校验和。

### 排除
- 教育部课标原文条款（codes-only，见 PROVENANCE.md）。
- 语义嵌入向量。
- 任何儿童/用户数据。

## [上游 v1] — 2026-07-08

参见上游 [CHANGELOG](https://github.com/withmarbleapp/os-taxonomy/blob/main/CHANGELOG.md)。
