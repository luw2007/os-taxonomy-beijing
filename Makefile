.PHONY: all install serve translate validate checksum term-lint check clean help
.PHONY: normalize-domains dedupe-topics build-deps deps-plan deps-dryrun

NODE ?= node

# 默认目标：安装依赖 + 全量校验（不改数据，安全）
all: check

# 安装依赖（当前为纯 Node 零依赖项目，预留给未来）
install:
	@npm install

# --- 开发服务器 ---
# 启动 viewer（知识浏览器，默认端口 3000）
#   make serve              默认 3000
#   make serve PORT=8080    指定端口
serve:
	$(NODE) scripts/serve.mjs $(if $(PORT),--port $(PORT))

# --- 数据治理（建图前的前置清理，按需手动跑）---
# domain 命名归一化（AI→Artificial Intelligence 等，合并同义 domain）
#   make normalize-domains          预览（不写盘）
#   make normalize-domains WRITE=1  写盘
normalize-domains:
	$(NODE) scripts/normalize-cn-domains.mjs $(if $(WRITE),,--dry-run)

# 清理 splitFrom 残留的完全重复节点（description+evidence 一致）
#   make dedupe-topics              预览
#   make dedupe-topics WRITE=1      写盘
dedupe-topics:
	$(NODE) scripts/dedupe-cn-topics.mjs $(if $(WRITE),,--dry-run)

# --- cn 依赖图 LLM 重建 ---
#   make deps-plan        只看分桶统计 + 前 3 桶 prompt（首次必跑）
#   make deps-dryrun      调模型但不写盘（结果在 data/.llm-deps-work/）
#   make build-deps       正式写盘
#   make build-deps MODEL=glm-5.2                  临时换模型
#   make build-deps BUCKETS=data/.llm-deps-work/lowq-buckets.txt  批量指定桶
build-deps:
	$(NODE) scripts/build-deps-llm.mjs $(if $(MODEL),--model $(MODEL)) $(if $(BUCKETS),--buckets-file $(BUCKETS))

deps-plan:
	$(NODE) scripts/build-deps-llm.mjs --plan

deps-dryrun:
	$(NODE) scripts/build-deps-llm.mjs --dry-run $(if $(MODEL),--model $(MODEL))

# --- 翻译管线 ---
# 同步上游 + 翻译（翻译后处理自动读 glossary + terminology 防错译复发）
translate:
	$(NODE) scripts/translate.mjs

sync-upstream:
	$(NODE) scripts/sync-upstream.mjs

# --- 校验链（按依赖顺序）---
# 重算 manifest 校验和（改完 data/ 后必须先跑）
checksum:
	$(NODE) scripts/checksum.mjs

# 结构完整性校验（计数 / ID / 课标引用 / 上游对齐 / SHA-256）
validate:
	$(NODE) scripts/validate.mjs

# 术语命名检查（发现中美命名不一致，默认 warning 不阻断）
#   make term-lint          扫描报告
#   make term-lint-strict   命中即失败（CI 用）
#   make term-lint-fix      预览修复（不落盘）
term-lint:
	$(NODE) scripts/term-lint.mjs

term-lint-strict:
	$(NODE) scripts/term-lint.mjs --strict

term-lint-fix:
	$(NODE) scripts/term-lint.mjs --fix

# 全量校验：checksum → validate → term-lint（strict）
check: checksum validate term-lint-strict
	@echo "✓ 全量校验通过（checksum + validate + term-lint strict）"

# --- 清理 ---
clean:
	@rm -f data/.terminology-cache.json data/.translate-progress.json
	@echo "✓ 已清理缓存文件"

# --- 帮助 ---
help:
	@echo "os-taxonomy-beijing 常用命令："
	@echo ""
	@echo "  开发："
	@echo "    make serve                启动 viewer（默认 3000，PORT=8080 指定端口）"
	@echo ""
	@echo "  数据治理（按需手动跑）："
	@echo "    make normalize-domains    domain 命名归一化（WRITE=1 写盘）"
	@echo "    make dedupe-topics        清理重复节点（WRITE=1 写盘）"
	@echo ""
	@echo "  cn 依赖图 LLM 重建："
	@echo "    make deps-plan            看分桶统计 + prompt 样本"
	@echo "    make deps-dryrun          调模型但不写盘（MODEL=glm-5.2 换模型）"
	@echo "    make build-deps           正式写盘（MODEL= / BUCKETS= 可选）"
	@echo ""
	@echo "  翻译上游："
	@echo "    make translate            翻译（自动读 terminology 防错译复发）"
	@echo "    make sync-upstream        对比上游差异（只读）"
	@echo ""
	@echo "  校验："
	@echo "    make checksum             重算 manifest SHA-256（改完 data/ 后跑）"
	@echo "    make validate             结构完整性校验"
	@echo "    make term-lint            术语命名检查"
	@echo "    make term-lint-strict     术语检查（命中即失败，CI 用）"
	@echo "    make check                全量校验（checksum + validate + term-lint strict）"
	@echo "    make clean                清理缓存文件"
