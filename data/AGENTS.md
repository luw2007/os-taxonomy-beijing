# data/ 命名规范

本目录所有数据文件的命名遵循以下规则。新增文件前请先阅读本规范。

## 三种命名模式

文件的**来源角色**决定其命名模式：

| 模式 | 含义 | 来源角色 |
|---|---|---|
| `<entity>.zh.json` | 上游实体的中文翻译 / 中英映射 | **上游派生**——含中文内容，与上游 `os-taxonomy` 关联 |
| `cn-<entity>.json` | 中国原生数据 | **中国原生**——无上游对应，自带完整结构 + 中文内容 |
| `<entity>.json` | 本地配置与元数据 | **本地配置**——展示层配置、工具配置、校验和，不含翻译性质 |

> 规则：来源标记只出现在**固定位置**——中国原生用 `cn-` **前缀**，上游派生用 `.zh` **后缀**，本地配置**无标记**。不混用前缀与后缀。

### 1. `<entity>.zh.json` — 上游派生（中文内容）

与上游 `os-taxonomy/data/<entity>.json` 关联，包含中文翻译或中英映射。分两个子类：

- **上游平行翻译**（有 `upstreamVersion` 字段，复用上游 `mt_` ID，只含翻译字段）：
  `topics.zh.json` · `dependencies.zh.json` · `clusters.zh.json`
- **本地中文映射**（无 `upstreamVersion`，英→中键值映射，服务展示层）：
  `domains.zh.json`

### 2. `cn-<entity>.json` — 中国原生（无上游对应）

中国特有数据，上游无对应实体。自带完整结构字段（`type`/`subject`/`domain`/`ageRange`）+ 中文内容。ID 用 `mtc_` 前缀（区别于上游 `mt_`）。

`cn-curriculum-standards.json` · `cn-topics.json`（中国特有微主题）

### 3. `<entity>.json` — 本地配置与元数据

纯配置 / 元数据，不含翻译性质，不与上游平行。

`dimensions.json`（维度切换配置）· `glossary.json`（术语表）· `manifest.json`（计数 + SHA-256 校验和）

## 实体命名约定

- 单一实体用**约定名词**，保持与上游一致：`topics` / `dependencies` / `clusters` / `curriculum-standards`
- 实体名在整个文件名中只出现一次，不加重复修饰
- 配置类用**功能名**而非实体名：`dimensions` / `glossary` / `manifest`

## ID 前缀与文件命名的呼应

| ID 前缀 | 含义 | 所在文件 |
|---|---|---|
| `mt_` | 上游微主题（翻译） | `topics.zh.json` |
| `mtc_` | 中国特有微主题（原生） | `cn-topics.json` |

ID 前缀与文件来源标记一致：`mt_` → `.zh.json`，`mtc_` → `cn-` 前缀。

## 新增文件决策流程

```
新文件有上游对应实体？
  ├─ 是 → 含中文翻译？
  │       ├─ 是 → <entity>.zh.json
  │       └─ 否 → （上游直接引用，不在此目录新建）
  └─ 否 → 中国特有数据？
          ├─ 是 → cn-<entity>.json
          └─ 否 → <entity>.json（本地配置/元数据）
```

## 现有文件清单

| 文件 | 模式 | 状态 |
|---|---|---|
| `topics.zh.json` | `.zh.json`（上游平行翻译） | ✓ 合规 |
| `dependencies.zh.json` | `.zh.json`（上游平行翻译） | ✓ 合规 |
| `clusters.zh.json` | `.zh.json`（上游平行翻译） | ✓ 合规 |
| `domains.zh.json` | `.zh.json`（本地中文映射） | ✓ 合规 |
| `cn-curriculum-standards.json` | `cn-` 前缀（中国原生） | ✓ 合规 |
| `dimensions.json` | 无标记（配置） | ✓ 合规 |
| `glossary.json` | 无标记（配置） | ✓ 合规 |
| `manifest.json` | 无标记（元数据） | ✓ 合规 |
| `cn-topics.json` | `cn-` 前缀（中国原生） | ✓ 合规 |
| `cn-dependencies.json` | `cn-` 前缀（中国原生） | ✓ 合规（DAG 已破环，每边带 `reviewStatus`） |
| `cn-bridge-dependencies.json` | `cn-` 前缀（中国原生） | ✓ 合规（mt_↔mtc_ 跨图桥接） |

## 配套规则

- 编码：UTF-8 无 BOM，2 空格缩进
- 每个数据文件在 `schema/` 下有对应 schema（同名替换 `.json` → `.schema.json`）
- 每个数据文件的 `bytes` + `sha256` 记录在 `manifest.json` 的 `files` 字段
- 修改任何数据文件后，运行 `node scripts/checksum.mjs` 更新校验和，再运行 `node scripts/validate.mjs` 校验完整性
