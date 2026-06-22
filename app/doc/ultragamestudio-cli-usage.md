# UltraGameStudio CLI 使用指南

UltraGameStudio 的命令行只有 **两个** 面向用户的命令：

- **`ugs gen`** —— 用自然语言**生成**或**修改**一个 workflow。
- **`ugs run`** —— **运行**一个 workflow。

对你而言，**workflow 就是一个 `.js` 脚本**。你写需求，`gen` 生成 `.js`；你提修改意见，
`gen` 改写这个 `.js`；`run` 运行它。其余（蓝图 / 中间结构 / 校验等）都是隐藏的内部过程，
你不需要关心。

## 零配置（无需 API key）

`gen` 和 `run` 都直接复用你本机的 **`claude` CLI 登录态**（和桌面端一致），**不需要配置任何
API key**。前置条件只有一个：

1. 安装 `claude` CLI；
2. 执行 `claude login` 完成登录。

如果没装或没登录，`ugs gen` 会报错并提示（退出码 4）。也可以用环境变量 `UGS_CLAUDE_PATH`
指定 `claude` 可执行文件的路径。

## 运行 CLI

目前没有全局安装，用 Node 跑仓库里打包好的 CLI：

```bash
node app/cli/dist/ugs.mjs <gen|run> [options] [args]
```

第一次使用前若 `app/cli/dist/ugs.mjs` 不存在，先构建一次：

```bash
cd app && npm install && npm run cli:build
```

## 典型流程：生成 → 看脚本 → 改 → 跑

### 1. 生成

```bash
node app/cli/dist/ugs.mjs gen "做一个代码审查流程：先理解改动，再审查，最后给结论" -o review.js
```

完成后会打印 `✓ 已生成 review.js（N 节点 / M 边）`。

### 2. 看脚本

`review.js` 就是普通的 Claude Code workflow 脚本，可以直接打开阅读：

```bash
cat review.js
```

### 3. 修改

把第一个参数换成已有脚本，第二个参数写修改意图，文件会被**原地改写**：

```bash
node app/cli/dist/ugs.mjs gen review.js "在审查后加一个验证节点，校验结论是否成立"
```

### 4. 运行

```bash
# 先干跑校验（不真正调用模型）
node app/cli/dist/ugs.mjs run review.js --dry-run

# 真正运行
node app/cli/dist/ugs.mjs run review.js
```

运行日志写到 stderr（`[time] ▶/●/✓` 形式），最终结果写到 stdout。运行状态保存在
`.ugs-run/<workflow>/` 下，**绝不回写你的脚本**。

## 常用选项

### ugs gen

| 选项 | 说明 |
|------|------|
| `-o, --output <path>` | 生成模式的输出脚本路径（也可作为第二个位置参数） |
| `-m, --model <model>` | 模型档位/ID（`haiku` \| `sonnet` \| `opus` \| …） |
| `-a, --adapter <id>` | 适配器，默认 `claude-code` |
| `--cli <path>` | 显式指定 CLI 可执行文件路径/名称 |
| `--json` | stdout 输出结构化结果（mode / output / nodes / edges） |

### ugs run

| 选项 | 说明 |
|------|------|
| `--dry-run` | 仅校验、不调用模型 |
| `--interactive` | 允许运行时向你提问（默认非交互） |
| `-m, --model <model>` | 模型覆盖 |
| `--var k=v` | 注入变量（可重复） |
| `--resume` | 从上次失败的节点继续 |
| `--json` | stdout 输出结构化运行结果 |

## 退出码

| 码 | 含义 |
|----|------|
| 0 | 成功 |
| 1 | 生成 / 运行错误 |
| 2 | 被中断 |
| 3 | 校验失败 |
| 4 | 配置错误（找不到可用的 `claude` CLI / 未登录） |

## 高级 / 内部（一般不需要）

CLI 内部仍保留 `init` / `emit` / `parse` / `validate` / `convert` / `diff` / `info` /
`list` 等步骤，被 `gen` / `run` 在内部复用，但它们**不出现在 `ugs --help`** 里，正常使用
完全不需要直接调用它们。
