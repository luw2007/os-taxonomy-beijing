# Beijing Skill Taxonomy（中文版）

[Marble Skill Taxonomy](https://github.com/withmarbleapp/os-taxonomy) 的中文衍生项目——
把面向英语世界小学生的"学习图谱"翻译为中文，并对齐**中国教育部《义务教育课程方案和
课程标准（2022 年版）》**，优先覆盖**北京小学**阶段。

> **状态：** `skeleton` · 已翻译微主题：4（数学 2 + 科学 2）· 上游总量：1,590

## 这是什么

上游 Marble 做了一件有价值的事：把英美课程体系拆成 1,590 个细粒度"微主题"，
用前置依赖关系连成一张**有向无环图（DAG）**——"学 X 之前必须先掌握 Y"。

但它是英美体系（NGSS / Common Core / UK NC）。中国小孩用不了。本项目的任务是：

1. **翻译**上游的微主题文本（名称、描述、掌握证据、评估话术）为中文
2. **替换**课程标准对齐——从英美标准换成中国教育部 2022 版课标
3. **保留**图的拓扑结构（mt_ ID + 依赖关系）不变，使其能持续同步上游

## 为什么以教育部课标为准

中国各省、市、区选用的**教材版本不同**。以北京为例：

| 科目 | 海淀区 | 东城/西城/朝阳 | 通州/顺义/房山 |
|---|---|---|---|
| 语文 | 部编版 | 人教版（部编） | 北京版 |
| 数学 | 北师大版 | 人教版 | 北京版 |
| 英语 | 人教版 | 人教版 | 北京版 |

教材是课标的"产生品"——不同出版社的教材只是同一课标的不同实现。
**课标才是所有教材共同的、稳定的基准。** 所以本项目只对齐教育部课标，
不对齐任何出版社的具体教材。

参见 [北京市中小学教材选用实施细则](https://xinwen.bjd.com.cn/content/s66f77761e4b01a5d71c94c6c.html)。

## 数据文件

所有数据在 [`data/`](data/) 目录，UTF-8 JSON。

| 文件 | 内容 |
|---|---|
| [`data/topics.zh.json`](data/topics.zh.json) | 微主题中文翻译（图**节点**）。复用上游 mt_ ID。 |
| [`data/dependencies.zh.json`](data/dependencies.zh.json) | 前置依赖的中文说明（图**边**）。 |
| [`data/clusters.zh.json`](data/clusters.zh.json) | 领域聚类摘要（面向中国家长）。 |
| [`data/cn-curriculum-standards.json`](data/cn-curriculum-standards.json) | 中国教育部课标条目编号（**codes-only**，不含原文）。 |
| [`data/manifest.json`](data/manifest.json) | 计数 + SHA-256 校验和。 |

### 中文微主题的结构

```jsonc
{
  "id": "mt_OvyoRo47K-",           // 与上游完全相同的 ID
  "name": "加法：把两组合在一起",      // 中文译名
  "description": "理解加法是把两组物体合并...",  // 中文描述
  "evidence": [                     // 掌握证据，条数与上游一致
    "用实物"合在一起"操作并说出总数",
    "演示"增加"情境..."
  ],
  "assessmentPrompt": "如果 {{name}} 有 4 辆玩具车...",  // 保留 {{name}} 占位符
  "cnStandards": ["moe-2022-math:S1.NA.01"],  // 对应中国课标编号
  "translationStatus": "reviewed"   // 翻译质量标记
}
```

**关键设计**：中文文件**只含翻译字段**，不含 `type`/`subject`/`domain`/`ageRange`/
`centrality` 等结构字段——这些保留在上游 topics.json，通过 mt_ ID 关联。
这样上游更新结构时，中文文件不用改，diff 干净，永远能同步。

### 与上游的关系

```
上游 os-taxonomy               本项目 os-taxonomy-beijing
┌─────────────────┐            ┌──────────────────────┐
│ topics.json     │──mt_ ID───▶│ topics.zh.json       │ ← 只含翻译
│ dependencies    │──edge ID──▶│ dependencies.zh.json │ ← 只译 reason
│ clusters.json   │──(s,d,age)▶│ clusters.zh.json     │ ← 只译 summary
│ curriculum-...  │            │ cn-curriculum-...    │ ← 中国课标
└─────────────────┘            └──────────────────────┘
```

## 使用

纯数据，无运行时依赖。

```js
import topicsZh from './data/topics.zh.json' with { type: 'json' };

// 如需完整字段，合并上游结构
import topicsUpstream from '../os-taxonomy/data/topics.json' with { type: 'json' };
const byId = new Map(topicsUpstream.topics.map(t => [t.id, t]));
const full = topicsZh.topics.map(zh => ({ ...byId.get(zh.id), ...zh }));
```

校验数据完整性 + 上游对齐：

```bash
node scripts/validate.mjs              # 默认从 ../os-taxonomy 读上游
node scripts/validate.mjs --upstream /path/to/os-taxonomy
```

检查上游变更，看哪些 topic 待翻译：

```bash
node scripts/sync-upstream.mjs --subject Mathematics
node scripts/sync-upstream.mjs --subject Science
```

更新校验和（修改数据后运行）：

```bash
node scripts/checksum.mjs
```

## 许可证

本项目是 [Marble Skill Taxonomy](https://github.com/withmarbleapp/os-taxonomy)
（© Generative Spark, Inc.）的衍生作品，**继承其双层许可证**：

| 层 | 内容 | 许可证 |
|---|---|---|
| **数据库** | 集合结构、ID、关系 | [**ODbL 1.0**](LICENSE) — share-alike，商用友好 |
| **文本** | 中英文教学点、描述、评估话术 | [**CC BY-SA 4.0**](LICENSE-CONTENT) — 署名 + share-alike |
| **中国课标编号** | 教育部 2022 版课标条目编号 | 各自上游许可证，**codes-only** |

**关于中国课标**：本项目只收录课标条目的编号/映射键，**不收录课标原文条款**。
详见 [PROVENANCE.md](PROVENANCE.md)。

### 署名

使用本项目必须同时署名上游和课标来源：

> Beijing Skill Taxonomy (zh-CN, v1-zh) · 衍生自 Marble Skill Taxonomy (v1)，
> © Generative Spark, Inc. (Marble) · https://withmarble.com ·
> ODbL 1.0（数据库）+ CC BY-SA 4.0（文本）。
> 课程标准编号来源于教育部《义务教育课程方案和课程标准（2022年版）》。

## Roadmap

- [x] 项目骨架 + 合规文件 + 校验工具
- [x] 数学 + 科学示例数据
- [ ] **数学全部翻译**（上游 503 个微主题）+ 完整课标对齐
- [ ] **科学全部翻译**（上游 547 个微主题）+ 完整课标对齐
- [ ] 英语（需新增国内课标，因中国小学英语非母语）
- [ ] 道德与法治（中国特有，上游无对应）
- [ ] 语文（中国特有，上游无对应，含拼音/识字/古诗文）
- [ ] 自动翻译流水线（术语表 + LLM 批量 + 人工校对流程）

## 贡献

欢迎贡献翻译、课标对齐、校对。请先阅读 [PROVENANCE.md](PROVENANCE.md) 了解
codes-only 原则——**不要在 PR 中收录教育部课标的原文条款**。
