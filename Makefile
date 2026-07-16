.PHONY: all install serve translate validate checksum term-lint check clean help

NODE ?= node

# 默认目标：安装依赖 + 全量校验（不改数据，安全）
all: check

# 安装依赖（当前为纯 Node 零依赖项目，预留给未来）
install:
	@npm install

# --- 开发服务器 ---
# 启动 viewer（3D 力导向图）
serve:
	$(NODE) scripts/serve.mjs

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
	@echo "  make serve            启动 viewer 开发服务器"
	@echo "  make translate        翻译上游（自动读 terminology 防错译复发）"
	@echo "  make checksum         重算 manifest SHA-256（改完 data/ 后跑）"
	@echo "  make validate         结构完整性校验"
	@echo "  make term-lint        术语命名检查（中美命名发现与纠错）"
	@echo "  make term-lint-fix    预览术语修复（不落盘，加 --yes 落盘见脚本）"
	@echo "  make check            全量校验（checksum + validate + term-lint strict）"
	@echo "  make clean            清理缓存文件"
