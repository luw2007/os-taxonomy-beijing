# Provenance & third-party licensing

本项目是 [Marble Skill Taxonomy](https://github.com/withmarbleapp/os-taxonomy) 的中文衍生项目。

中文翻译的 Marble 教学点文本、中文领域摘要，以及本项目作者有权许可的原创内容，
均在 CC BY-SA 4.0 下发布（见 [LICENSE-CONTENT](LICENSE-CONTENT)）。
中文版数据库（集合结构、ID、topic↔topic 和 topic↔standard 关系）在 ODbL 1.0 下
发布（见 [LICENSE](LICENSE)）。项目代码在 MIT 下发布（见 [LICENSE-CODE](LICENSE-CODE)）。
各路径和材料类型的准确许可边界见 [LICENSES.md](LICENSES.md)，第三方署名见
[NOTICE](NOTICE)。

**`data/cn-curriculum-standards.json` 是特殊的。** 这些标准来源于中国教育部的
《义务教育课程方案和课程标准（2022 年版）》，本项目**不拥有、也不能再授权**其原文。
你只能获得上游权利人授予的权利。

---

## 三个数据来源，三套规则

### 一、上游 Marble 原创文本（已翻译）

来源：[Marble Skill Taxonomy v1](https://github.com/withmarbleapp/os-taxonomy)

- **性质**：Marble 原创的教学点 `name` / `description` / `evidence` /
  `assessmentPrompt`、依赖 `reason`、聚类 `summary`。
- **上游许可证**：CC BY-SA 4.0（文本）+ ODbL 1.0（数据库）。
- **本项目处理**：翻译为中文，作为衍生作品继续以 CC BY-SA 4.0 + ODbL 1.0 发布。
- **署名要求**：见下方「署名」节。

### 二、中国教育部课程标准（codes-only）

来源：中华人民共和国教育部《义务教育课程方案和课程标准（2022 年版）》

- **发布机关**：中华人民共和国教育部
- **正式出版物**：北京师范大学出版社（单行本）
- **官方获取**：[教育部通知页面](http://www.moe.gov.cn/srcsite/A26/s8001/202204/t20220420_619921.html)
  · [课程教材研究所下载中心](https://www.ictr.edu.cn/download_center/ywjy.html)

#### ⚠️ codes-only 原则

对于中国教育部课标，本项目**只收录条目的编号/映射键**（一种简短的**事实标识符**，
版权风险低），**不收录课标原文条款**（章节条文、内容要求、学业质量描述等）。

我们在 `cn-curriculum-standards.json` 中标记 `textIncluded: false`。
`topics.zh.json` 里的 `cnStandards` 字段保存的是这些编号键——
"这个微主题对应课标条目 X"的关系被完整保留，但课标原文不在本项目中。

#### 编号键说明

2022 版课标采用章节式条文，没有类似 Common Core（如 `K.OA.2`）的标准化短代码。
本项目自行设计了稳定的映射键（如 `moe-2022-math:S1.NA.01`），用于关联微主题与课标条目。
**这些编号键是我们的映射标识符，不是课标原文，也不是课标的官方编号。**
条目中的 `strand`（学段/领域）字段是我们的分类标签，同样不是原文。

如需课标原文，请从上述官方渠道获取。

### 三、教材衍生微主题（知识结构引用）

来源：[ChinaTextbook](https://github.com/TapXWorld/ChinaTextbook) 提供的
北京海淀各版本教材 PDF（人教/部编/北师大/中图/鲁科/教科等）。

- **性质**：`cn-topics.json` 当前包含 1,069 条 `origin: textbook` 微主题，其知识结构
  （章节标题、教学单元划分）参考了教材目录体系，以填充上游 Marble 未覆盖的
  中国特有学科和初高中进阶内容。
- **公开范围**：教材 PDF、Markdown 转换产物、正文、插图、练习题、版式、页码、
  出版社路径和年级路径均不纳入版本库；`textbookSource` / `textbookPath` /
  `textbookGrade` 字段也未发布。
- **作品目录元数据**：1,069 条教材来源节点中有 290 条 `nodeKind: text` 记录，保留
  作品名称，部分记录同时保留作者姓名；相关依赖理由也可能引用这些名称。它们用于
  识别、索引和追溯作品，不包含作品正文、原文摘录或内容摘要。
- **许可边界**：作品名称、部分作者姓名和来源作为事实性元数据提供，本项目不对这些事实
  主张独占版权。本项目原创的 `description` / `evidence` / `assessmentPrompt` 等
  教学模板文本按 CC BY-SA 4.0 发布；ID、分类、映射和依赖关系等数据库编排按
  ODbL 1.0 发布。这不授予任何未包含在仓库中的教材正文、插图、练习题或版式权利。
- **本地来源**：教材 PDF/MD 仅供本地知识图谱构建参考，不纳入 Git 发布物。

---

## 中国教材版本说明

中国各省、市、区选用的教材版本不同。以北京为例：

| 科目 | 海淀区 | 东城/西城/朝阳 | 通州/顺义/房山 |
|---|---|---|---|
| 语文 | 部编版 | 人教版（部编） | 北京版 |
| 数学 | 北师大版 | 人教版 | 北京版 |
| 英语 | 人教版 | 人教版 | 北京版 |

**本项目以教育部课标为唯一基准，不以任何出版社的教材为基准。**
教材版本是课标的"产生品"，不同出版社的教材只是同一课标的不同实现。
课标才是所有教材共同的、稳定的来源。

参考：[北京市中小学教材选用实施细则政策解读](https://xinwen.bjd.com.cn/content/s66f77761e4b01a5d71c94c6c.html)

---

## 署名

任何使用本项目的方式必须同时署名两个来源：

> Beijing Skill Taxonomy (zh-CN, v1.2.0-zh.0) · 衍生自 Marble Skill Taxonomy (v1)，
> © Generative Spark, Inc. (Marble) · https://withmarble.com ·
> 数据库 ODbL 1.0，项目原创及有权许可的文本 CC BY-SA 4.0，代码 MIT。
> 课程标准编号来源于中华人民共和国教育部《义务教育课程方案和课程标准
> （2022 年版）》；教材作品名、部分作者名和来源作为事实性元数据保留。

正式引用格式见 [CITATION.cff](CITATION.cff)。
