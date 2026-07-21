# Beijing Skill Taxonomy（中文版）

[Marble Skill Taxonomy](https://github.com/withmarbleapp/os-taxonomy) 的中文衍生项目——
把面向英语世界小学生的"学习图谱"翻译为中文，并对齐**中国教育部《义务教育课程方案和
课程标准（2022 年版）》**，优先覆盖**北京小学**阶段。

> **状态：** `v1.2.0-zh.0` · 已翻译微主题：1,590 / 1,590（100%）· 中国特有微主题：2,008 · 上游依赖：3,221 / 3,221（100%）· 中国特有依赖：2,619（DAG 已破环）· 审核覆盖率：49.1%（1,286 reviewed / 1,333 machine）

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
| [`data/cn-topics.json`](data/cn-topics.json) | 中国特有微主题（语文/道法/历史等）。ID 用 mtc_ 前缀。 |
| [`data/dependencies.zh.json`](data/dependencies.zh.json) | 前置依赖的中文说明（图**边**）。 |
| [`data/cn-dependencies.json`](data/cn-dependencies.json) | 中国特有微主题之间的依赖 DAG（**已破环**）。每条边带 `reviewStatus`：`reviewed`=已审核（默认展示）/`machine`=AI 推测未审核（降级显示）/`rejected`=已拒绝（隐藏）。 |
| [`data/cn-bridge-dependencies.json`](data/cn-bridge-dependencies.json) | 上游 mt_ 与中国 mtc_ 跨图桥接依赖。 |
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

### 数据快照

修改核心数据文件前，建议先快照备份（作为回滚点）：

```bash
node scripts/snapshot.mjs --label pre-v1.2   # 快照当前数据
node scripts/snapshot.mjs --list             # 列出所有快照
node scripts/snapshot.mjs --diff data/.snapshots/20260720-121037-pre-v1.2  # 对比差异
```

快照存在 `data/.snapshots/`（gitignore，不入版本库）。配合 `git tag data-snapshot-xxx` 做双重保护。

### 翻译流水线

用公开翻译 API（Google 免费端点 = Chrome 翻译后端，MyMemory 备选）批量翻译，**不使用模型**：

```bash
npm run translate                              # 翻译全部（1590 topics + 3221 deps）
node scripts/translate.mjs --subject Mathematics # 只翻译数学
node scripts/translate.mjs --limit 10 --dry-run # 试跑 10 条预览
node scripts/translate.mjs --concurrency 8      # 8 并发（默认 5）
```

特性：`{{name}}` 占位符保护、术语表后处理（`data/glossary.json`）、断点续传
（中断后重跑自动跳过已翻译）、Google→MyMemory 自动降级。翻译质量标记为
`"translationStatus": "machine"`，手工校对过的标 `"reviewed"`（不会被覆盖）。

### 中国特有依赖图（cn-dependencies）重建

`data/cn-dependencies.json` 描述 `mtc_` 中国特有微主题之间的知识依赖，由三层建图
叠加而成（密度 1.55 边/主题，达上游 2.03 的 77%）：

1. **LLM 桶内语义边**（主体）：按 `subject|domain|stage` 分桶，大桶滑窗（窗口 25、
   步长 15），逐桶调 LLM 判断"先修关系"。Prompt 强调区分「先修 vs 相关」，避免
   把平行技能（加法↔减法）误连为先修。
2. **ageRange 相邻链**（L1/L2，规则）：同 `subject|domain` 内按年龄排序连相邻节点，
   保留教学顺序（如笔画→偏旁→间架结构）。
3. **跨 domain 先修链**（L3，规则）：`scripts/_rule-deps.mjs` 的 `DOMAIN_PREREQ_CHAINS`
   定义跨知识领域先修（如「数与代数」→「方程」）。

后处理：环检测（破 LLM 产生的 A→B→A）、跨平行子领域错边过滤（剔除美术↔音乐、
体操↔球类等 domain 分类缺陷导致的伪先修）、幻觉端点过滤。

```bash
# 先拷贝 .env 填 LLM 配置（OpenAI 兼容接口）
cp .env.example .env

node scripts/build-deps-llm.mjs --plan      # 只看分桶 + prompt 样本（首次必跑）
node scripts/build-deps-llm.mjs --dry-run   # 调模型但不写盘，结果在 data/.llm-deps-work/
node scripts/build-deps-llm.mjs             # 正式写盘
node scripts/build-deps-llm.mjs --only-bucket Chinese_Literacy-_-Handwriting_小学  # 单桶重跑
```

raw 响应缓存在 `data/.llm-deps-work/raw/`（gitignore），支持断点续跑。
配套的数据治理脚本：`scripts/normalize-cn-domains.mjs`（domain 命名归一化）、
`scripts/dedupe-cn-topics.mjs`（清理 splitFrom 残留重复节点）。


## 本地知识浏览器

本项目内置一个**零依赖**的 Web 浏览器，可以在本地启动后用浏览器交互式浏览全部知识图谱——
微主题、依赖关系、领域聚类、课标对齐一目了然。

```bash
npm start                    # 默认端口 3000，自动从 ../os-taxonomy 读上游
# 或
node scripts/serve.mjs --port 8080 --upstream /path/to/os-taxonomy
```

然后浏览器打开 **http://localhost:3000**：

- **左侧目录树**：按学科 → 领域浏览，显示翻译覆盖率
- **搜索框**：即时搜索全部微主题（中英文均可）
- **概览页**：统计卡片 + 学科分布 + 许可证说明
- **微主题列表**：按学科/领域/翻译状态筛选，卡片式展示
- **详情页**：完整描述 + 掌握证据 + 评估话术（`{{name}}` 高亮为「孩子名字」）+ 课标对齐 + 前置/后续依赖关系图

浏览器会自动合并上游结构数据（subject/domain/ageRange/type）和中文翻译，
未翻译的微主题显示英文原文并标注「未译」，已翻译的优先显示中文。

## 许可证

本项目按材料类型分层许可，完整的逐路径边界见 [LICENSES.md](LICENSES.md)，
第三方署名与权利保留见 [NOTICE](NOTICE)：

| 层 | 内容 | 许可证 |
|---|---|---|
| **代码** | `scripts/`、`viewer/`、schema 与构建文件 | [**MIT**](LICENSE-CODE) |
| **数据库** | 集合结构、ID、关系 | [**ODbL 1.0**](LICENSE) — share-alike，商用友好 |
| **文本** | Marble 中文译文及本项目原创或有权许可的文本 | [**CC BY-SA 4.0**](LICENSE-CONTENT) — 署名 + share-alike |
| **中国课标编号** | 项目自建映射键，不含课标原文 | 事实性标识符；不授予课标原文权利 |
| **教材来源元数据** | 809 个教材来源节点，含 209 个具体阅读文本节点 | 作品名、部分作者名和来源作为事实性元数据保留；项目不主张独占版权 |

本项目不发布教育部课标原文、教材 PDF、Markdown 转换产物、正文、插图、练习题、
版式或页码。详见 [PROVENANCE.md](PROVENANCE.md)。

### 署名

使用上游 Marble 数据和文本时必须保留以下署名：

> Beijing Skill Taxonomy (zh-CN, v1.2.0-zh.0) · 衍生自 Marble Skill Taxonomy (v1)，
> © Generative Spark, Inc. (Marble) · https://withmarble.com ·
> 数据库 ODbL 1.0，项目原创及有权许可的文本 CC BY-SA 4.0，代码 MIT。
> 课程标准编号来源于教育部《义务教育课程方案和课程标准（2022年版）》；
> 教材作品名、部分作者名和来源作为事实性元数据保留。

## Roadmap

- [x] 项目骨架 + 合规文件 + 校验工具
- [x] 数学 + 科学示例数据
- [x] **全部翻译**（1,590 微主题 + 3,221 依赖说明，Google API 机翻）
- [x] 本地知识浏览器（零依赖 Web 服务）
- [x] **课标对齐**（17 套教育部课程标准，1,423 条 codes-only 映射）
- [x] **中国特有微主题**（2,008 个 `mtc_` 主题，覆盖语文/道法/物理/化学/生物/历史/地理/政治/通用技术等；238 个初高中宽泛主题已按 45 分钟粒度拆分，111 个边界不清主题待人工复核）
- [x] **中国特有依赖图重建**（原图 2,290 条；拆分子主题使用 deepseek-v4-flash 只追加回填 329 条 machine 边，当前 2,619 条）
- [x] **v1.2：DAG 完整性修复**（全局 SCC 破环，0 含环 SCC；`validate --dag` 断言）
- [x] **v1.2：审核闸门**（每条边加 `reviewStatus`；`reviewed` 1,286 条 / `machine` 1,333 条；viewer 默认只展示已审核边，未审核边降级为“AI 推测·未核对”）
- [ ] **人工校对**（`machine` → `reviewed`，优先数学/科学低龄段，当前覆盖率 49.1%）
- [ ] 领域聚类（clusters.zh.json）翻译
- [ ] bridge 依赖扩展（mt_↔mtc_ 跨图桥接，当前 47 条）

## 贡献

欢迎贡献翻译、课标对齐、校对。请先阅读 [PROVENANCE.md](PROVENANCE.md) 了解
codes-only 原则——**不要在 PR 中收录教育部课标的原文条款**。

## 致谢

- [**Marble Skill Taxonomy**](https://github.com/withmarbleapp/os-taxonomy) —
  本项目的上游，提供了 1,590 个微主题的知识图谱结构（DAG）、ID 体系和依赖关系。
- [**ChinaTextbook**](https://github.com/TapXWorld/ChinaTextbook) —
  提供了北京海淀各学段教材来源；本项目据此保留作品名、部分作者名和来源引用。

> 教材 PDF、Markdown 转换产物、正文、插图、练习题、版式和页码不纳入版本库。
