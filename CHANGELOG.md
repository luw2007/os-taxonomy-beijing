# Changelog

本项目是 [Marble Skill Taxonomy](https://github.com/withmarbleapp/os-taxonomy) 的中文衍生版。
版本号格式：`<上游版本>-zh.<中文修订号>`（如 `v1-zh.0`）。

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
