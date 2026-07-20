# 中国课标 Gap 分析报告（小学 / 初中 / 高中）

对比**中国教育部课程标准**与上游
[Marble Skill Taxonomy](https://github.com/withmarbleapp/os-taxonomy) 的差距，按 os-taxonomy
的微主题思路逐学段生成补全草案。

> 本目录为**分析草案**，非正式数据。经评审后，`proposed-topics` 中认可的主题会落地进 `data/`。

## 基准来源（codes-only）

| 学段 | 课标基准 | 年级 | 年龄 |
|---|---|---|---|
| 小学（第一~三学段） | 《义务教育课程方案和课程标准（2022年版）》 | 1~6 年级 | 6~12 岁 |
| 初中（第四学段） | 《义务教育课程方案和课程标准（2022年版）》 | 7~9 年级 | 12~15 岁 |
| 高中 | 《普通高中课程方案和课程标准（2017年版2020年修订）》 | 10~12 年级 | 15~18 岁 |

> "北京教委学习要求"实质就是教育部课标。北京各区（海淀/东城/通州…）仅**教材版本**不同（北师大版/人教版/北京版），
> 教材是课标的"产生品"。**课标才是所有教材共同的稳定基准。** 本项目 `data/cn-curriculum-standards.json` 的来源也同样是教育部课标。

## 文件清单

| 文件 | 说明 | 行数 |
|---|---|---|
| `gap-analysis-primary-school.csv` | 小学 Gap 主表 | 43 条 |
| `proposed-topics-primary-school.csv` | 小学微主题草案 | 132 条 |
| `gap-analysis-junior-high.csv` | 初中 Gap 主表 | 52 条 |
| `proposed-topics-junior-high.csv` | 初中微主题草案 | 354 条 |
| `gap-analysis-senior-high.csv` | 高中 Gap 主表 | 35 条 |
| `proposed-topics-senior-high.csv` | 高中微主题草案 | 188 条 |
| `textbook-gap-report.csv` | 课本目录 vs 课标微主题对比 | 1684 条 |
| `textbook-topics.json` | 全量课本目录知识点（北京课本解析） | — |
| `textbook-topics-物理.json` | 物理课本目录知识点 | — |
| `textbook-topics-化学.json` | 化学课本目录知识点 | — |

各 stage 的 gap 表与 proposed 表通过 `gap_id` ↔ `source_gap_id` 关联。

## 草案 → 落地的粒度拆解

proposed CSV 共 674 条草案（小学 132 + 初中 354 + 高中 188），实际落地到
`data/cn-topics.json` 的微主题有 **1,640 条**。差异来自两个拆解过程：

1. **微技能级粒度拆解**：proposed CSV 的一条草案（如“物理·物态变化”）落地时按
   课标内容要求拆解为多条可独立评估的微技能（熔化凝固 / 汽化液化 / 升华凝华），
   每条 `description` 聚焦一个单一概念、`evidence` 可观测、`assessment_prompt` 可评估。
2. **课本补充知识点**（`origin: textbook`，共 809 条）：来自 `textbook-gap-report.csv` +
   `textbook-topics.json` 的北京课本目录解析，覆盖课本有但课标微主题遗漏的具体知识点。

落地后 cn-topics 的 origin 分布：`cn_only` 531 / `textbook` 809 / `progression` 154 /
`upstream_adapt` 119 / `cross_domain` 27。

## 与上游 os-taxonomy 的关系

上游 Marble 课纲本质是**面向英语世界小学生的**课纲：1,590 个微主题中，age_range_start≥13 的仅 28 条（1.8%），
且**无独立的物理 / 化学 / 生物 / 地理 / 政治 / 世界史学科**。因此：

| 学段 | 上游覆盖 | 缺口性质 |
|---|---|---|
| **小学** | 数学 446 / 科学 449 / 英语 252 等可直接翻译，部分学科缺失（语文/道法/体育/艺术/劳动等需新建） | 翻译为主 + 部分新建 |
| **初中** | 数学(方程/几何/统计)/科学(生物/物理基础)部分可翻译改编；物理/化学/历史/地理/道法大量新建 | 改编 + 大量新建 |
| **高中** | 上游几乎为空，数学/物理/化学/生物/政治/历史/地理/通用技术等**全部需新建** | 几乎全量新建 |

## Gap 全貌

### 小学 — 第一类：整学科缺失（上游 0 内容，中国必修）
语文、道德与法治、体育与健康、艺术（音乐/美术）、信息科技、劳动、综合实践活动。

### 小学 — 第二类：学科内错位/缺模块
- **数学** — 缺「综合与实践」「中华数学文化」
- **科学** — 缺「技术与工程」「人类活动与环境（中国语境）」「中国本土生态」
- **英语** — 中国是"外语"视角，上游是"母语"视角，需视角调整

### 初中（第四学段，7~9 年级）
- **物理**（整学科新建）— 物质 / 运动和相互作用 / 能量 / 实验探究 / 跨学科实践
- **化学**（整学科新建）— 科学探究与实验 / 物质的性质与应用 / 组成与结构 / 化学变化 / 跨学科实践
- **生物学**（整学科新建）— 结构层次 / 多样性 / 环境 / 植物生活 / 人体生理 / 遗传与进化
- **历史** — 上游仅西方古代史；**中国古代史/近代史/现代史全部新建**，世界近代史/现代史缺失
- **地理**（整学科新建）— 地球与地图 / 世界地理 / 中国地理 / 乡土地理
- **道德与法治** — 法治教育(宪法/权利义务) / 国情教育 / 革命传统教育
- **数学/英语** — 方程/函数/几何可翻译改编；需补锐角三角函数等中国特有编排

### 高中（10~12 年级，必修课程）

高中微主题**绝大部分是初中已建微主题的进阶延伸**（`progression`），而非凭空新建。gap 表的 `jh_base` 列
标注了每条高中知识点对应的初中基础微主题 ID，体现知识从定性到定量、从具体到抽象的螺旋上升。

- **数学** — 函数(mtc_155~157→SH)、概率统计(mtc_165~166→SH)为**进阶延伸**；集合/平面向量/复数为**全新概念**
- **物理** — 运动学与牛顿定律(mtc_170~172→SH)、能量(mtc_179~181→SH)、电路电磁(mtc_177~178→SH)为**进阶延伸**；
  曲线运动/万有引力、静电场为**全新模块**
- **化学** — 实验(mtc_183~184→SH)、无机物(mtc_185~189→SH)、结构反应(mtc_190~193→SH)为**进阶延伸**；
  有机化合物为**全新模块**
- **生物学** — 分子与细胞(mtc_194~195→SH)、遗传与进化(mtc_201~202→SH)为**进阶延伸**
- **思想政治** — 中国特色社会主义(mtc_230~232→SH)、经济社会(mtc_230~231→SH)、政治法治(mtc_228~229→SH)为**进阶延伸**；
  哲学与文化(必修四)为**全新模块**
- **历史** — 中国史(mtc_205~213→SH)、世界史(mtc_214~216→SH)为**进阶延伸**（从通史叙事到专题视角）
- **地理** — 自然地理(mtc_217~219→SH)为**进阶延伸**；人文地理为**全新模块**
- **信息技术** — 数据与计算(mtc_242~243→SH)、信息系统(mtc_244~247→SH)为**进阶延伸**
- **通用技术** — **整学科新建**（初中及上游均无，中国高中特色学科）
- **语文/英语/体育/艺术** — 均为初中对应微主题的深度延伸

## 字段字典

### gap-analysis-*.csv

| 字段 | 说明 |
|---|---|
| `gap_id` | 缺口唯一编号。小学 `G-<学科缩写>-<NN>`；初中 `G-JH-<学科缩写>-<NN>`；高中 `G-SH-<学科缩写>-<NN>`（外键，被 proposed 表引用） |
| `subject` / `subject_en` | 课标学科中文名 / 英文名 |
| `stage` | 涉及学段 |
| `cn_domain` | 课标领域 / 模块名 |
| `gap_type` | `missing_subject`(整学科缺失) / `missing_domain`(领域缺失) / `misaligned`(视角错位) / `coverage_pending`(上游有但中文未译) / `progression`(已有低学段基础，需向高学段进阶) |
| `upstream_subject` | 上游对应学科（`—` 表示无对应）；高中表无此列 |
| `upstream_status` | 上游覆盖现状说明（含与初中已建微主题的衔接关系） |
| `severity` | `高` / `中` / `低` |
| `action` | `新建学科` / `新建模块微主题` / `视角调整` / `翻译即可` / `初高中进阶` |
| `jh_base` | （仅高中表）对应的初中已建微主题 ID，如 `mtc_170~mtc_172`；`—` 表示初中也无基础（真正全新） |
| `note` | 补充说明 |

### proposed-topics-*.csv

字段对齐上游 `topics.json` 结构 + 本项目中文翻译层。

| 字段 | 说明 |
|---|---|
| `id` | `mtc_<NNN>` — china-origin 微主题（区别于上游翻译的 `mt_`）。小学 mtc_001~132，初中 mtc_133~247，高中 mtc_248~333 |
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
| `origin` | `cn_only`(中国特有，初高中均无基础) / `cross_domain`(跨领域新建) / `upstream_adapt`(上游改编) / `progression`(低学段已建基础，向高学段进阶延伸) |

## 课标编号方案（codes-only）

扩展现有 `data/cn-curriculum-standards.json` 的编号规则 `moe-2022-<学科>:S<学段>.<领域>.<序号>`：

**学段编号**：`S1`=第一学段(1~2 年级) · `S2`=第二学段(3~4 年级) · `S3`=第三学段(5~6 年级) · `S4`=第四学段(7~9 年级) · `SH`=高中必修。

| 学科 | slug | 领域缩写（示例） |
|---|---|---|
| 语文 | `moe-2022-chinese` | RW 识字写字 / RA 阅读鉴赏 / EC 表达交流 / SI 梳理探究 / CP 古诗文 / CC 文言文 / CLT 传统文化 / WB 整本书阅读 |
| 数学 | `moe-2022-math` | NA 数与代数 / EQ 方程与不等式 / FN 函数 / GE 图形与几何 / TR 图形变换 / SP 统计概率 / CP 综合实践 / CMC 数学文化 / PR 预备知识 / GA 几何与代数 / MM 数学建模 |
| 科学 | `moe-2022-sci` | TE 技术与工程 / CE 中国生态 / ENV 环境 |
| 英语 | `moe-2022-english` | THM 主题 / SK 语言技能 / KN 语言知识 / IU 综合运用 / STR 学习策略 |
| 物理 | `moe-2022-physics` | MA 物质 / MM 运动相互作用 / EN 能量 / IN 实验探究 |
| 化学 | `moe-2022-chem` | EX 实验 / PA 物质性质 / CS 组成结构 / CH 化学变化 / OC 有机 / IN 无机物 / SR 结构与反应 |
| 生物学 | `moe-2022-bio` | BS 结构层次 / BD 多样性 / BE 环境 / PL 植物生活 / HH 人体生理 / HE 遗传进化 / MC 分子与细胞 |
| 历史 | `moe-2022-history` | AC 中国古代 / MC 中国近代 / CC 中国现代 / WA 世界古代 / WM 世界近现代 |
| 地理 | `moe-2022-geo` | EM 地球地图 / WG 世界地理 / CG 中国地理 / PG 自然地理 / HG 人文地理 |
| 道德与法治 | `moe-2022-moral` | MS/MO/MC/MH/MW（小学）/ LS 生命安全 / RL 法治 / NC 国情 / RT 革命传统 / TC 传统文化（初中） |
| 思想政治 | `moe-2022-pol` | SCC 中国特色社会主义 / ES 经济社会 / PF 政治法治 / PC 哲学文化 |
| 体育与健康 | `moe-2022-pe` | FM 基本运动 / PF 体能 / HE 健康 / SS 专项 / CR 跨学科 |
| 艺术 | `moe-2022-art` | AP 欣赏 / PR 表现 / CR 创造 / CO 联系融合 |
| 信息科技 | `moe-2022-it` | DAT 数据 / ALG 算法 / NET 网络 / IP 信息处理 / IS 信息安全 / AI 人工智能 / IN 互联网 / IOT 物联网 / DC 数据与计算 |
| 信息技术(高中) | `moe-2022-it` | DC 数据与计算 / IS 信息系统 |
| 劳动 | `moe-2022-labor` | DL 日常 / PL 生产 / SL 服务 |
| 通用技术 | `moe-2022-gt` | TD1 技术与设计1 / TD2 技术与设计2 |
| 综合实践 | `moe-2022-practice` | PRAC 综合实践活动 |

例：`moe-2022-physics:S4.MM.02` = 物理课标 / 初中第四学段 / 运动和相互作用 / 第 02 条；
`moe-2022-math:SH.FN.03` = 数学课标 / 高中必修 / 函数 / 第 03 条。

## 与项目现有数据的关系

- `data/cn-curriculum-standards.json` 已落地 **17 套课标 / 1,423 条编号**，覆盖小学到高中全部学科
  （语文/数学/科学/英语/物理/化学/生物/历史/地理/道德与法治/思想政治/体育/艺术/信息科技/劳动/通用技术/综合实践），
  均遵守 `textIncluded: false`（codes-only）。
- `data/cn-topics.json` 已落地 **1,640 条中国特有微主题**（`mtc_` 前缀），不与上游 `mt_` 关联——
  它们是中国特有、跨领域新建、进阶延伸或课本补充的主题。
- 上游 `mt_` 翻译对应 gap 表中 `coverage_pending` 类型，走 `scripts/sync-upstream.mjs` 翻译流程，
  **不在本报告的 proposed 范围内**——本报告只产出"上游没有、需新建"的主题。

## 落地状态

| 步骤 | 状态 |
|---|---|
| proposed-topics 草案生成（小学 132 + 初中 354 + 高中 188 = 674 条） | ✅ 完成 |
| 微技能级粒度拆解（674 条 → 1,640 条） | ✅ 完成 |
| 课本补充知识点（textbook origin，809 条） | ✅ 完成 |
| 课标编号落地（17 套 / 1,423 条） | ✅ 完成 |
| 依赖关系 + 聚类摘要 | ⬜ 待补 |
| 接入 `scripts/validate.mjs` 完整校验 | ✅ 完成 |

## 合规说明

严守项目 **codes-only 原则**：本报告只含课标编号 / 分类标签 / 课程模块名 + **自拟的中文教学化描述**
（description / evidence / assessment_prompt 均为原创教学表达，非课标原文条款）。
不收录教育部课标条文原文。详见根目录 [PROVENANCE.md](../../PROVENANCE.md)。

CSV 编码 UTF-8（无 BOM），与 `data/` 一致；含逗号 / 分号的字段整体用双引号包裹转义。

## 术语命名检查（term-lint）

中美数学/科学术语命名常有差异（如 `Pythagorean theorem` 上游英文名 ↔ 中国教材叫「勾股定理」，直译「毕达哥拉斯定理」属错译）。
本项目用 `scripts/term-lint.mjs` 建立**数据驱动的发现—纠错—防护闭环**，不依赖人工逐条排查。

### 机制

**Wikidata 当裁判**：拿上游英文专名 → 查 Wikidata `enwiki→zh` 标题拿中国标准中文名 → 比对中文译文 → 不一致即实锤错译（正解同时到手）。

### 涉及文件

| 文件 | 角色 |
|---|---|
| `data/terminology.json` | 单一事实源。每条带 `en`（翻译防护用）、`bad[]→good`（检测用）、`qid`（Wikidata 来源）。增删不影响 validate |
| `data/.terminology-cache.json` | Wikidata 查询结果缓存（增量更新，避免重复联网） |
| `scripts/term-lint.mjs` | 发现（扫译文 + 查 Wikidata）与修复（`--fix`） |
| `scripts/translate.mjs` | 后处理同时读 glossary + terminology 的 `en→good`，防重译复发 |

### 用法

```bash
npm run term-lint                     # 扫描报告（exit 0）
npm run term-lint -- --strict         # 命中即 exit 1（供 CI）
npm run term-lint -- --fix            # 预览修复（不落盘）
npm run term-lint -- --fix --yes      # 落盘修复
npm run term-lint -- --no-network     # 仅用本地缓存，不联网
```

### 频次控制

Wikidata 匿名查询有频次限制，脚本采用：串行请求（绝不并发）+ 2s 间隔 + 本地缓存（查过的不再查）+ 429 即停（缓存已保存进度，重跑增量续查）。

## 权威来源

- [义务教育课程方案（2022年版）PDF — moe.gov.cn](http://www.moe.gov.cn/srcsite/A26/s8001/202204/W020220420582343217634.pdf)
- [义务教育课程标准 PDF 汇总 — ICTR 下载中心](https://www.ictr.edu.cn/download_center/ywjy.html)
- [教育部关于印发普通高中课程方案和语文等学科课程标准（2017年版2020年修订）— moe.gov.cn](http://www.moe.gov.cn/srcsite/A26/s8001/202006/t20200603_462199.html)
- [普通高中课程方案及20科课程标准 — 人教社专题](https://www.pep.com.cn/xw/zt/rjwy/gzkb2020/)
- [普通高中课程方案 PDF（2017年版2020年修订）— ICTR](https://www.ictr.edu.cn/download_center/put.html)
