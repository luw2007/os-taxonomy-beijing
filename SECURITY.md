# 安全政策

## 支持版本

项目处于 alpha 阶段，只对 `main` 分支的最新版本提供安全修复。

## 禁止提交任何密钥

`.env`（LLM API key，见 `.env.example`）已在 [`.gitignore`](.gitignore) 中排除，**不得**以
任何形式提交到仓库、粘贴进 PR/issue/commit message，或写死在脚本里。发现历史提交中
泄漏了密钥，请**立即**私下联系维护者轮换密钥，不要在公开 issue 里讨论细节。

## 范围

- **本地开发服务器**（`node scripts/serve.mjs`，默认 3000 端口）默认只绑定
  `127.0.0.1`，匿名 `/api/chat` 和 `/api/resolve` 不会对局域网开放。若明确需要 LAN
  调试，必须显式传 `--host 0.0.0.0`；此模式不是公网部署方案，仍缺身份认证、TLS 与
  生产级限流。
- **用户数据**：学习进度、掌握状态、用户档案等保存在浏览器 `localStorage`，服务端不落库、不建账号。用户主动使用 AI 解析后，输入描述与已有画像会发送给 DeepSeek API；使用 AI 学习伙伴后，提问、有限对话历史、当前知识点和筛选上下文会发送给 DeepSeek API。掌握记录不会上传，换浏览器或清缓存会丢失本地数据。
- **范围外**：课程内容准确性、依赖关系是否合理（走 [CONTRIBUTING.md](CONTRIBUTING.md)
  的边审核工作流，不是安全问题）；上游 [Marble os-taxonomy](https://github.com/withmarbleapp/os-taxonomy)
  数据本身的安全问题请上报至上游仓库。

## 报告漏洞

优先使用本仓库 GitHub 的 **Security → Report a vulnerability**（Private Vulnerability
Reporting）私下提交，附复现步骤、受影响路径、影响面与建议修复方案。

如尚未启用该功能，请提交一个**不含漏洞细节**的公开 issue，请求维护者开通私密渠道。

请勿在公开 issue、PR 或 commit message 中披露未修复漏洞的可利用细节。
