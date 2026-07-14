# 小学课标 Gap 分析报告

对比**中国教育部《义务教育课程方案和课程标准（2022 年版）》小学段**与上游
[Marble Skill Taxonomy](https://github.com/withmarbleapp/os-taxonomy) 的差距，并按 os-taxonomy
的微主题思路生成补全草案。

> 本目录为**分析草案**，非正式数据。经评审后，`proposed-topics` 中认可的主题会落地进 `data/`。

## 为什么基准是教育部课标

"北京教委学习要求"实质就是教育部 2022 版课标。北京各区（海淀/东城/通州…）仅**教材版本**不同
（北师大版 / 人教版 / 北京版），教材是课标的"产生品"。**课标才是所有教材共同的稳定基准。**
本项目 `data/cn-curriculum-standards.json` 的来源也同样是教育部 2022 版课标。

小学段 = 第一至第三学段 = **1–6 年级（约 6–12 岁）**。

## 文件

| 文件 | 说明 | 行数 |
|---|---|---|
| `gap-analysis-primary-school.csv` | Gap 主表：每个缺口一行（学科 × 学段 × 课标领域） | 43 条 |
| `proposed-topics-primary-school.csv` | 微主题草案：按 os-taxonomy 思路生成的补全主题，含完整字段 | 132 条 |

两表通过 `gap_id` ↔ `source_gap_id` 关联（proposed 每行注明它补的是哪个 gap）。

## Gap 概览

### 第一类：整学科缺失（上游 0 内容，中国小学必修）
语文、道德与法治、体育与健康、艺术（音乐/美术）、信息科技、劳动、综合实践活动。

### 第二类：学科内错位/缺模块（有学科但缺中国课标关键模块）
- **数学** — 缺「综合与实践」「中华数学文化」
- **科学** — 缺「技术与工程」「人类活动与环境（中国语境）」「中国本土生态」
- **英语** — 中国是"外语"视角（三大主题/语言技能/学习策略），上游是"母语"视角（Phonics/Grammar），需视角调整

## 字段字典

### gap-analysis-primary-school.csv

| 字段 | 说明 |
|---|---|
| `gap_id` | 缺口唯一编号，`G-<学科缩写>-<NN>`（外键，被 proposed 表引用） |
| `subject` / `subject_en` | 课标学科中文名 / 英文名 |
| `stage` | 涉及学段 |
| `cn_domain` | 课标领域 / 模块名 |
| `gap_type` | `missing_subject`(整学科缺失) / `missing_domain`(领域缺失) / `misaligned`(视角错位) / `coverage_pending`(上游有但中文未译) |
| `upstream_subject` | 上游对应学科（`—` 表示无对应） |
| `upstream_status` | 上游覆盖现状说明 |
| `severity` | `高` / `中` / `低` |
| `action` | `新建学科` / `新建模块微主题` / `视角调整` / `翻译即可` |
| `note` | 补充说明 |

### proposed-topics-primary-school.csv

字段对齐上游 `topics.json` 结构 + 本项目中文翻译层。

| 字段 | 说明 |
|---|---|
| `id` | `mtc_<NNN>` — china-origin 微主题（区别于上游翻译的 `mt_`） |
| `subject` / `subject_en` | 学科中文 / 英文名 |
| `domain` / `domain_en` | 领域（学科内子分类）中文 / 英文名 |
| `name` | 微主题名称（中文） |
| `type` | 复用上游 5 类枚举：`CONCEPTUAL` / `PROCEDURAL` / `REPRESENTATIONAL` / `LANGUAGE` / `META` |
| `age_range_start` / `age_range_end` | 适用年龄段（岁），与学段对应 |
| `stage` | 对应课标学段 |
| `description` | 微主题描述（自拟中文教学化表达） |
| `evidence` | 掌握证据，多条用 `；`分隔 |
| `assessment_prompt` | 评估话术，含 `{{name}}` 占位符（与 `data/topics.zh.json` 一致） |
| `cn_standards` | 课标编号草案，格式见下文 |
| `source_gap_id` | 外键，指向 gap 表的 `gap_id` |
| `origin` | `cn_only`(中国特有) / `cross_domain`(跨领域新建) / `upstream_adapt`(上游改编) |

## 课标编号方案（codes-only）

扩展现有 `data/cn-curriculum-standards.json` 的编号规则 `moe-2022-<学科>:S<学段>.<领域>.<序号>`：

| 学科 | slug | 领域缩写（示例） |
|---|---|---|
| 语文 | `moe-2022-chinese` | RW 识字写字 / RA 阅读鉴赏 / EC 表达交流 / SI 梳理探究 / CP 古诗文 / CLT 传统文化 |
| 数学（补） | `moe-2022-math` | CP 综合与实践 / CMC 中华数学文化 |
| 科学（补） | `moe-2022-sci` | TE 技术与工程 / CE 中国本土生态 / ENV 人类活动与环境 |
| 英语 | `moe-2022-english` | THM 主题 / SK 语言技能 / KN 语言知识 / STR 学习策略与文化 |
| 道德与法治 | `moe-2022-moral` | MS 我与自己 / MO 我与他人 / MC 我与国家 / MH 我与社会 / MW 我们的世界 |
| 体育与健康 | `moe-2022-pe` | FM 基本运动 / PF 体能 / HE 健康教育 / SS 专项运动 / CR 跨学科 |
| 艺术 | `moe-2022-art` | AP 欣赏 / PR 表现 / CR 创造 / CO 联系融合 |
| 信息科技 | `moe-2022-it` | DAT 数据 / ALG 算法 / NET 网络 / IP 信息处理 / IS 信息安全 / AI 人工智能 |
| 劳动 | `moe-2022-labor` | DL 日常 / PL 生产 / SL 服务 |
| 综合实践 | `moe-2022-practice` | PRAC 综合实践活动 |

**学段编号**：`S1`=第一学段(1~2 年级) · `S2`=第二学段(3~4 年级) · `S3`=第三学段(5~6 年级)。

例：`moe-2022-chinese:S1.RW.01` = 语文课标 / 第一学段 / 识字与写字 / 第 01 条。

## 与项目现有数据的关系

- 现有 `data/cn-curriculum-standards.json` 仅有数学(S1.NA)、科学(S1.O) 各 2 条。本报告的编号方案是其**扩展草案**，
  落地时需在 `data/cn-curriculum-standards.json` 新增对应学科的 curricula 与 entries（仍遵守 `textIncluded: false`）。
- proposed 主题的 `mtc_` id 为**新建**，不与上游 `mt_` 关联——它们是中国特有或跨领域新建，上游无对应节点。
- 上游 `mt_` 翻译（数学 501 / 科学 545 / 英语约 150 待译）对应 gap 表中 `coverage_pending` 类型，走 `scripts/sync-upstream.mjs` 翻译流程，
  **不在本报告的 proposed 范围内**——本报告只产出"上游没有、需新建"的主题。

## 后续落地路径

1. 评审 proposed-topics，确认保留 / 修改 / 剔除条目
2. 为新学科在 `data/cn-curriculum-standards.json` 新增 curricula + 编号 entries（codes-only）
3. 把认可的 `mtc_` 主题写入新的数据文件（如 `data/topics.zh.json` 扩展，或独立 `data/topics.cn-origin.json`）
4. 为新主题补充依赖关系（`dependencies`）和聚类摘要（`clusters`），并接入 `scripts/validate.mjs` 校验

## 合规说明

严守项目 **codes-only 原则**：本报告只含课标编号 / 分类标签 / 课程模块名 + **自拟的中文教学化描述**
（description / evidence / assessment_prompt 均为原创教学表达，非课标原文条款）。
不收录教育部课标条文原文。详见根目录 [PROVENANCE.md](../../PROVENANCE.md)。

CSV 编码 UTF-8（无 BOM），与 `data/` 一致；含逗号 / 分号的字段整体用双引号包裹转义。
