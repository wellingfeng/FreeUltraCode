# UltraGameStudio Remote Runner（远程执行后端）

让你在 **UltraGameStudio 桌面端输入指令，但任务实际在你自己的云服务器上执行**。
代码同步用 Git，模型调用用已安装的 CLI（claude / codex / gemini）。密钥可放服务器，
也可由客户端按任务下发。Runner 支持两种身份模式：旧版共享 Token，或邮箱注册 + 验证码 + 密码登录的多用户模式。

```
UltraGameStudio 桌面端
  ──(HTTPS + Bearer Token / 用户 JWT)──▶  ugs-remote-runner（你的云服务器）
                                  ├─ 用户 -> 项目 -> 服务端工作区路径
                                  ├─ git clone/pull 项目仓库
                                  ├─ 调用 claude/codex/gemini CLI 改代码、跑命令
                                  ├─ 记录 accountId + token 用量
                                  ├─ git diff 生成 patch
                                  └─ 可选 commit & push 到新分支
  ◀──(SSE 实时日志 + 结果/patch)──┘
```

## 快速开始

### Windows bat

```bat
start-remote-backend.bat
```

兼容旧入口：`start-remote-runner.bat` 仍可用。

第一次运行会创建 `backend\.env`。本地启动脚本会在 `UGS_RUNNER_TOKEN` 为空时写入同机稳定 Token；公网/生产环境建议手动设置强随机 Token。单用户模式下，把同一个 Token 填到桌面端“添加云端项目”里。

### 直接用 Node

```bash
cd backend
cp .env.example .env
node src/local-token.mjs
# 本机自用可把输出写进 .env 的 UGS_RUNNER_TOKEN；公网/生产请改用强随机 Token
npm start
```

服务器需要安装要用的 Agent CLI（`claude` / `codex` / `gemini`），并保证它们在 `PATH` 中。

## 多用户邮箱登录

设置 `UGS_RUNNER_AUTH_MODE=multiuser` 后，Runner 使用邮箱注册/登录：

- `POST /auth/register`：邮箱 + 密码注册，发送 6 位邮箱验证码。
- `POST /auth/verify-email`：邮箱 + 验证码，验证成功后签发 access token + refresh token。
- `POST /auth/login`：邮箱 + 密码登录；邮箱未验证会拒绝。
- `POST /auth/forgot-password`、`POST /auth/reset-password`：邮箱验证码重置密码。
- `POST /auth/refresh`、`POST /auth/logout`、`GET /auth/me`：会话刷新、退出、读取当前用户。

多用户模式需要：

```env
UGS_RUNNER_AUTH_MODE=multiuser
UGS_RUNNER_JWT_SECRET=换成长随机字符串
UGS_MAILER=smtp
UGS_SES_SMTP_USER=你的腾讯云 SES SMTP 用户
UGS_SES_SMTP_PASS=你的腾讯云 SES SMTP 密码
```

开发联调用 `UGS_MAILER=console`，验证码只打印到 Runner 日志，不消耗 SES 额度。生产默认发信地址为 `noreply@mail.ultragamestudio.com`，SMTP 默认 `smtp.qcloudmail.com:465`；也可用 `UGS_MAILER=api` 配合 `UGS_SES_SECRET_ID` / `UGS_SES_SECRET_KEY`（region 默认 `ap-hongkong`）。

`UGS_RUNNER_TOKEN` 在多用户模式下仍作为服务级运维 Token 使用，可访问全局任务/账户 API；普通用户 JWT 只能访问自己的项目、任务、设置和用量。

## 多账户与 Token 消费

参考 MonkeyCode 的“模型分组、账户/积分、任务 token 统计”思路，Runner 支持多账户池：

```env
UGS_RUNNER_ACCOUNTS=[{"id":"claude-main","label":"Claude 主号","adapter":"claude","apiKeyEnv":"ANTHROPIC_API_KEY","model":"claude-sonnet-4-20250514","monthlyTokenLimit":50000000},{"id":"codex-main","label":"Codex 主号","adapter":"codex","apiKeyEnv":"OPENAI_API_KEY","model":"gpt-5.1-codex","monthlyTokenLimit":50000000}]
```

字段：

- `id`：账户唯一 ID，会记录到 job 上。
- `label`：桌面端显示名。
- `adapter`：`claude` / `codex` / `gemini`。
- `model`：可选默认模型。
- `apiKey` / `apiKeyEnv`：直接写 key 或引用环境变量名。推荐 `apiKeyEnv`。
- `baseUrl` / `baseUrlEnv`：可选模型网关地址。
- `dailyTokenLimit` / `monthlyTokenLimit`：软限制。超限后该账户不再自动接新任务。

账户来源有两种：

- `.env` 的 `UGS_RUNNER_ACCOUNTS`：适合固定服务器配置，不能通过 API 删除。
- `/accounts` API：桌面端“测试连接”成功后可新增服务器模型账户。

选账户规则：优先客户端指定 `accountId`，否则按 adapter 匹配，选择累计 token 最少且未超限的账户。CLI 输出中出现 OpenAI/Codex/Anthropic 风格 usage JSON 时，会自动汇总 input/output/cache/total tokens。

## 桌面端接入

打开 UltraGameStudio → 左上角工作区切换器 → **添加云端项目**，填入：

- 服务器地址：`http://服务器IP:8787`（公网建议 HTTPS 反代）
- 访问 Token：单用户模式填 `UGS_RUNNER_TOKEN`；多用户模式选择“邮箱登录”
- 项目名称、项目仓库、分支、Agent、模型
- 可选：自己的模型 API Key / Base URL。不填则用服务器账户池或服务器环境变量。

保存后 Runner 创建项目记录。服务端真实工作目录按 `UGS_RUNNER_WORKDIR/<userId>/<projectId>` 分配，桌面端只保存 `projectId`，不会填写或看到服务器路径。之后创建任务只传 `{ projectId, prompt }`；旧版 `{ repoUrl, gitToken }` 任务仍兼容自托管临时任务。

点“测试连接”后，桌面端会显示 Runner 账户数量、每个账户累计 token 消费、是否缺 Key。

## HTTP API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 无需鉴权。返回服务信息、adapter、账户数量 |
| POST | `/auth/register` | 多用户模式。注册并发送邮箱验证码 |
| POST | `/auth/verify-email` | 多用户模式。验证邮箱并返回登录态 |
| POST | `/auth/resend-code` | 多用户模式。重发注册验证码 |
| POST | `/auth/login` | 多用户模式。邮箱密码登录 |
| POST | `/auth/refresh` | 多用户模式。刷新 access token |
| POST | `/auth/logout` | 多用户模式。吊销 refresh token |
| GET | `/auth/me` | 多用户模式。返回当前用户 |
| POST | `/auth/forgot-password` | 多用户模式。发送重置密码验证码 |
| POST | `/auth/reset-password` | 多用户模式。验证码重置密码并返回登录态 |
| GET | `/usage` | 需要鉴权。返回账户、token 用量、最近任务 |
| GET | `/accounts` | 需要鉴权。列出服务器模型账户（不返回 Key） |
| POST | `/accounts` | 需要鉴权。创建/覆盖服务器模型账户 |
| PUT | `/accounts/:id` | 需要鉴权。更新服务器模型账户 |
| DELETE | `/accounts/:id` | 需要鉴权。删除服务器模型账户 |
| GET | `/projects` | 需要鉴权。列出当前用户项目（不返回 gitToken/服务器路径） |
| POST | `/projects` | 需要鉴权。创建项目。body: `{label, repoUrl, branch?, pushBranch?, adapter?, model?, gitToken?}` |
| GET | `/projects/:id` | 需要鉴权。读取项目 |
| PUT | `/projects/:id` | 需要鉴权。更新项目 |
| DELETE | `/projects/:id` | 需要鉴权。删除项目记录 |
| POST | `/jobs` | 创建任务。推荐 body: `{prompt, projectId, adapter?, model?, accountId?, apiKey?, baseUrl?}`；兼容旧 body: `{prompt, repoUrl?, branch?, pushBranch?, gitToken?}` |
| GET | `/jobs` | 任务列表（不含密钥） |
| GET | `/jobs/:id` | 单个任务（日志、结果/patch、usage） |
| GET | `/jobs/:id/stream` | SSE 实时日志与状态、最终结果 |
| POST | `/jobs/:id/cancel` | 取消任务 |

单用户模式：除 `/health` 外所有接口都要求 `Authorization: Bearer <UGS_RUNNER_TOKEN>`。
多用户模式：用户接口使用 `Authorization: Bearer <accessToken>`；服务级运维接口可继续使用 `UGS_RUNNER_TOKEN`。

## 安全

- 未配置 `UGS_RUNNER_TOKEN` 时，受保护接口一律拒绝。
- 多用户模式必须配置 `UGS_RUNNER_JWT_SECRET`；否则认证接口拒绝签发会话。
- 密码用 argon2id 哈希；验证码、refresh token 只存哈希并加密落盘。
- 邮箱验证码 6 位数字，5 分钟有效，一次性使用，60 秒发送限频，错误次数有限制。
- 普通用户 JWT 解析出的 `userId` 是项目、任务、设置、用量隔离边界；不信任请求体里的 `userId`。
- 项目 `gitToken` 存在服务端项目记录中，加密落盘，不随每个任务下发。
- 客户端下发的 `apiKey` / `baseUrl` 只用于当次任务，任务结束删除。旧版临时任务的 `gitToken` 也会在任务结束删除。
- clone/push 输出中的 `token@host` 会脱敏为 `***@host`。
- 公网使用必须前置 HTTPS（Caddy / Nginx），并建议加 IP 白名单。
- Runner 会执行模型 CLI 与 git/build 命令，只暴露给可信网络。

## 配置项

见 `.env.example`。常用：

- `UGS_RUNNER_TOKEN`：访问令牌。
- `UGS_RUNNER_AUTH_MODE`：`token` 或 `multiuser`。
- `UGS_RUNNER_JWT_SECRET`：多用户 JWT 签名密钥。
- `UGS_MAILER`：`console` / `smtp` / `api`。
- `UGS_SES_SMTP_USER` / `UGS_SES_SMTP_PASS`：腾讯云 SES SMTP 凭据。
- `UGS_SES_SECRET_ID` / `UGS_SES_SECRET_KEY`：腾讯云 SES API 凭据。
- `UGS_RUNNER_PORT`：监听端口，默认 8787。
- `UGS_RUNNER_WORKDIR`：任务工作目录。
- `UGS_RUNNER_DATADIR`：状态与用量文件目录。
- `UGS_RUNNER_MAX_CONCURRENCY`：最大并发任务数。
- `UGS_RUNNER_JOB_TIMEOUT`：单任务超时，秒。
- `UGS_RUNNER_ACCOUNTS`：多账户池 JSON。
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY`：服务器侧默认 key。

远程项目工作区由 Runner 管理在 `<UGS_RUNNER_WORKDIR>/<user>/<project>` 下。Runner 会拒绝越界的工作目录；项目/仓库任务只允许运行有工作区沙箱的适配器。当前 Codex 固定使用 `workspace-write` 沙箱，不提供全盘写入开关；Claude/Gemini 暂不作为远程项目执行适配器。

## 测试

```bash
cd backend
npm test
```
