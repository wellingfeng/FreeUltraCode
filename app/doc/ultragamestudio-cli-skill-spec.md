# `/ultragamestudio` Skill & CLI 完整规格

> 版本：v0.1.0-draft  
> 状态：可据以实现（Ready for Implementation）  
> 依赖上游结论：UltraGameStudio 纯 CLI 模式技术上完全可行，Node.js CLI 先行，Rust 渐进跟进。

---

## 1. 概述与定位

### 1.1 问题定义

UltraGameStudio 当前是一个**可视化设计时工具**（Vite + React + Tauri 桌面应用）。用户通过画布设计 workflow，然后运行或导出脚本。但存在以下空白：

- **CI/CD 集成**：无法在无头环境中运行已设计的 workflow。
- **脚本化使用**：无法从命令行直接 `run` 一个 `.ugs.json` 文件。
- **编辑器集成**：无法与 VS Code / Vim / Emacs 等编辑器打通（如一键运行当前 workflow）。
- **批量处理**：无法批量 `emit`/`parse`/`validate` 多个 workflow 文件。

### 1.2 解决方案：三层架构

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 3: Claude Code Skill (/ultragamestudio)                 │
│  ── 薄触发层，SKILL.md 驱动，负责参数解析和 CLI 调用调度       │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Node.js CLI (app/cli/)                             │
│  ── 纯计算命令 + 运行时引擎，直接 import app/src/core/*.ts     │
├─────────────────────────────────────────────────────────────┤
│  Layer 1: 共享核心 (app/src/core/ + runtime/)                │
│  ── IRGraph 类型、emit/parse、DAG 调度器、交互协议             │
│  ── GUI 与 CLI 共用，零重复建设                               │
└─────────────────────────────────────────────────────────────┘
```

### 1.3 互补关系（CLI vs GUI）

| 维度 | GUI（现有） | CLI（新增） |
|------|------------|------------|
| **核心场景** | 设计时、可视化调试、画布编辑 | CI/CD、批量处理、无头运行、编辑器集成 |
| **用户输入** | 鼠标拖拽、属性面板、AI 对话 | 命令行参数、stdin、环境变量 |
| **运行反馈** | React Flow 动画、消息气泡、状态着色 | stdout/stderr 流、JSON/日志文件、exit code |
| **交互协议** | 哨兵块 → React 控件渲染 → 用户操作 | 哨兵块 → readline/inquirer → stdin 回答 |
| **状态持久化** | Tauri SQLite + localStorage | 本地 JSONL / 文件系统 / 无状态 |
| **共享资产** | `core/ir.ts`, `core/emitter.ts`, `core/parser.ts`, `core/interaction.ts` 等 | 同上 |

**原则**：CLI 不替代 GUI，两者共享 Layer 1 核心逻辑。CLI 是 GUI 的「编译器 + 运行时」命令面延伸。

---

## 2. SKILL.md 规格

### 2.1 文件位置

```
# 项目级（推荐，随仓库分发）
.claude/skills/ultragamestudio/SKILL.md

# 用户级（个人全局安装）
~/.claude/skills/ultragamestudio/SKILL.md
```

### 2.2 Frontmatter

```yaml
---
name: ultragamestudio
description: >
  UltraGameStudio CLI skill — compile, validate, and run AI agent workflows
  from the command line. Works with .ugs.json blueprints and .js workflow scripts.
  Supports Claude Code, Codex, and Gemini adapters.
version: "0.1.0"
argument-hint: "<subcommand> [options] [args]"
allowed-tools:
  - Bash
  - Read
  - Write
  - AskUserQuestion
context: inline
---
```

**字段说明**：

| 字段 | 取值 | 理由 |
|------|------|------|
| `name` | `ultragamestudio` | 用户输入 `/ultragamestudio` 触发 |
| `description` | 多行描述 | Claude 自动触发时判断相关性 |
| `argument-hint` | `<subcommand> [options] [args]` | 提示用户 skill 的用法 |
| `allowed-tools` | Bash, Read, Write, AskUserQuestion | CLI 需要执行命令、读写配置文件 |
| `context` | `inline` | Skill 本身只是 prompt 层，实际工作委托给本地 CLI 子进程；无需 fork 子 agent |
| `disable-model-invocation` | 省略（默认 false） | 允许 Claude 在检测到 workflow 相关上下文时自动建议 |

**不使用的字段**：
- 不设 `model` / `effort` — 由底层 CLI 的 `--model` flag 控制，不硬编码。
- 不设 `hooks` — Skill 定位为薄触发层，安全检查由 CLI 自身负责。
- 不设 `sensitive` — 不涉及凭证存储（API key 走环境变量或 `.env`）。

### 2.3 参数传递

Skill 采用**位置参数**风格，与底层 CLI 命令一对一映射：

```yaml
arguments: [subcommand, args]
```

**变量映射**：

| 变量 | 含义 | 示例 |
|------|------|------|
| `$ARGUMENTS` | 用户输入的完整参数字符串 | `"run workflow.ugs.json --model sonnet"` |
| `$0` | 子命令 | `run`, `emit`, `parse` 等 |
| `$1` | 第一个位置参数（通常是文件路径） | `workflow.ugs.json` |
| `$2...` | 后续参数 | `--model`, `sonnet` |

**示例交互**：
```
User: /ultragamestudio run my-flow.ugs.json --adapter claude-code --var "input=./src"
Skill 接收: $0=run, $1=my-flow.ugs.json, $2...=--adapter claude-code --var "input=./src"
Skill 执行: npx ugs run my-flow.ugs.json --adapter claude-code --var "input=./src"
```

### 2.4 SKILL.md 主体指令

```markdown
# /ultragamestudio

You are the UltraGameStudio CLI skill. Your job is to translate user requests
into `ugs` CLI commands and present the results.

## Core behavior

1. **Parse the subcommand** from `$0`. Supported: `init`, `emit`, `parse`, `validate`, `run`, `list`, `convert`, `diff`, `info`, `help`.
2. **Delegate to the local CLI** via Bash:
   ```bash
   npx ugs $ARGUMENTS
   ```
   If `ugs` is not installed globally or via npx, guide the user to run:
   ```bash
   cd app && npm install && npm run cli:build
   ```
3. **Stream output back** to the user. Do not summarize unless the output exceeds 200 lines.
4. **For `run` with `--interactive`**: if the CLI process emits an interaction sentinel (`<<UGS_ASK>>...<<UGS_ASK_END>>`), pause and use `AskUserQuestion` to collect the answer, then write it back to the CLI's stdin.
5. **For errors**: if the CLI exits non-zero, report the error message and suggest the next step (e.g., `ugs validate <file>` for validation errors).

## File path resolution

- If `$1` is a relative path, resolve it from the current working directory.
- If `$1` ends with `.ugs.json`, treat as blueprint.
- If `$1` ends with `.js`, treat as workflow script.
- If `$1` is `-` or `--stdin`, read from stdin.

## Adapter & model defaults

- If no `--adapter` is provided, default to `claude-code`.
- If no `--model` is provided, let the CLI use its own default (or omit `--model` flag).
- API keys are read from environment: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`.

## Safety rules

- Do not write API keys to disk.
- Do not execute arbitrary code from workflow files — only emit/parse/validate/run through the `ugs` CLI.
- If a workflow file is untrusted, suggest `ugs validate --strict` first.
```

---

## 3. 子命令完整规格

### 全局选项（所有子命令共享）

```
Options:
  -c, --config <path>     指定配置文件路径（默认：~/.ugs/config.json）
  -j, --json              所有输出为 JSON 格式（机器可读）
  -v, --verbose           详细日志（调试级别）
  -q, --quiet             静默模式（仅错误输出）
  --version               显示版本号
  -h, --help              显示帮助
```

---

### 3.1 `ugs init [name]` — 新建蓝图

**用途**：创建最小合法的 IRGraph 文件。

```
Usage: ugs init [name] [options]

Options:
  -t, --template <name>   使用内置模板（blank, agent-pipeline, code-review, parallel-scan）
  -f, --from <script>     从现有 .js 脚本反向导入（parse → 初始化）
  -o, --output <path>     输出路径（默认：<name>.ugs.json）
  --stdout                输出到 stdout（不写入文件）
  --adapter <adapter>     设置默认适配器（默认：claude-code）

Arguments:
  name                    工作流名称（用于 meta.name 和文件名）
```

**输出格式**（`.ugs.json`）：
```json
{
  "version": 1,
  "meta": {
    "name": "my-workflow",
    "description": "",
    "adapter": "claude-code"
  },
  "nodes": [
    { "id": "n_start", "type": "start", "label": "Start", "params": {} },
    { "id": "n_end", "type": "end", "label": "End", "params": {} }
  ],
  "edges": [],
  "layout": {}
}
```

**行为边界**：
- 创建最小合法 IRGraph（必须含 `start` + `end` 哨兵）。
- `--from` 时，先调用 `parseClaudeScript(src)`，然后注入 `meta.name`。
- 模板读取顺序：`~/.ugs/templates/<name>.ugs.json` → 内置模板 → 错误退出。
- 不运行、不验证逻辑正确性（`validate` 负责）。

**错误码**：
- `1`：名称缺失或非法（空字符串、含 `/` 等）
- `2`：模板不存在
- `3`：`--from` 脚本解析失败（fatal parse → 仍输出退化图 + 警告）

---

### 3.2 `ugs emit <file>` — 蓝图 → 可运行脚本

**用途**：将 `.ugs.json` 编译为可运行的 Claude Code workflow 脚本。

```
Usage: ugs emit <file> [options]

Options:
  -o, --output <path>     输出路径（默认：stdout）
  -a, --adapter <adapter> 覆盖 meta.adapter
  -s, --schema <name=def> 追加/覆盖 schema definition（可多次）
  --format <format>       输出格式：pretty | minified（默认：pretty）
  --strip-annotations     去掉 // @node 注释（用于发布）
  --dry-run               验证可 emit，不输出

Arguments:
  file                    输入 .ugs.json 路径，或 - 表示 stdin
```

**输出格式**（`.js`）：
```js
export const meta = { name: 'workflow', adapter: 'claude-code' }

phase('Scan')
const scan = await agent('Analyze the codebase...', { agentType: 'explore' }) // @node n_scan

phase('Review')
const review = await agent('Review findings...', { from: [scan] }) // @node n_review
```

**行为边界**：
- 调用 `emitClaudeScript(ir)` 进行编译。
- `--adapter` 覆盖 `ir.meta.adapter`。
- `--schema` 追加到 `ir.meta.schemaDefs`。
- `--strip-annotations` 去掉 `// @node` 注释（牺牲 round-trip 能力，换取干净输出）。
- `--dry-run` 执行完整编译但丢弃结果，exit 0 表示成功。
- **不执行**脚本，仅编译。

**错误码**：
- `1`：输入文件不存在或不可读
- `2`：JSON 解析失败
- `3`：IRGraph 结构无效（缺少必要字段）
- `4`：emit 过程中出现内部错误

---

### 3.3 `ugs parse <file>` — 脚本 → 蓝图

**用途**：将现有 `.js` workflow 脚本反向解析为 `.ugs.json`。

```
Usage: ugs parse <file> [options]

Options:
  -o, --output <path>     输出路径（默认：stdout）
  -p, --preserve-layout <file>  从现有 .ugs.json 复用 layout 字段
  --annotate              在 stderr 输出解析统计（节点数、边数、问题）

Arguments:
  file                    输入 .js 路径，或 - 表示 stdin
```

**行为边界**：
- 调用 `parseClaudeScript(src)` 进行解析。
- `--preserve-layout` 读取旧 `.ugs.json` 的 `layout` 字段，合并到输出中（保持画布坐标）。
- `--annotate` 在 stderr 输出：
  ```
  Parsed: 8 nodes, 7 edges (5 exec, 2 data)
  Warnings: 1 unknown statement → codeblock node
  ```
- 解析错误处理：fatal 时输出包含单个 `codeblock` 节点的退化图（与现有 parser 行为一致）。
- **不运行**脚本。

**错误码**：
- `1`：输入文件不存在或不可读
- `2`：Babel 解析失败（fatal → 仍输出退化图 + warning exit 0）
- `3`：输出文件写入失败

---

### 3.4 `ugs validate <file>` — 验证

**用途**：验证蓝图或脚本的结构与语义正确性。

```
Usage: ugs validate <file> [options]

Options:
  -f, --format <format>   输入格式：auto | ugs | js（默认：auto，按扩展名推断）
  --strict                严格模式：要求所有 data edges 无悬空引用、所有 agent 节点必须有 exec 出边
  --json                  诊断报告为 JSON（与全局 --json 叠加）

Arguments:
  file                    输入文件路径
```

**输出格式**（默认文本）：
```
✓ 8 nodes, 7 edges
✓ exec spine: start → phase(Scan) → agent → parallel → end (connected)
✓ all data edges resolve to valid producer nodes
⚠ node n_agent_2 has no outbound connections
```

**验证项**：
1. **语法**：JSON 格式合法、必填字段存在（`version`, `meta`, `nodes`, `edges`）。
2. **结构**：
   - 存在且仅存在一个 `start` 和一个 `end` 节点。
   - `start` 有且仅有一条 exec 出边；`end` 有且仅有一条 exec 入边。
   - 所有 `edge.from.node` 和 `edge.to.node` 指向存在的节点。
   - 所有 `edge.from.port` 和 `edge.to.port` 指向存在的端口。
3. **语义**（`--strict` 时增加）：
   - 无悬空 data edge（目标节点被删除但边仍存在）。
   - 所有 `agent` 节点至少有 1 条 exec 出边（防止死节点）。
   - `parallel`/`pipeline`/`consensus` 的子节点存在且类型合法。
   - `branch` 的条件表达式可解析（轻量检查）。

**错误码**：
- `0`：通过
- `1`：错误（语法/结构失败）
- `2`：警告（在 `--strict` 模式下，语义检查未通过）

---

### 3.5 `ugs run <file>` — 执行工作流

**用途**：执行蓝图或脚本。

```
Usage: ugs run <file> [options]

Options:
  -a, --adapter <adapter> 指定适配器（覆盖文件中的配置）
  -m, --model <model>     指定模型（如 sonnet, opus, haiku）
  -p, --provider <id>     指定 provider ID（用于 gateway 路由）
  --var <key=value>       注入变量到工作流（可多次）
  -o, --output <path>     将运行结果写入 JSON 文件
  --dry-run               仅 emit + validate，不真正执行
  --interactive           启用交互模式（处理节点级用户交互）
  --resume                从上次失败的节点恢复运行
  --concurrency <n>       覆盖并发限制（默认从配置读取）
  --max-retries <n>       覆盖最大重试次数（默认 2）
  --timeout <seconds>     单节点超时（默认 300）
  --cwd <path>            设置工作目录（默认：当前目录）
  --no-color              禁用 ANSI 颜色输出

Arguments:
  file                    .ugs.json 或 .js 路径，或 - 表示 stdin
```

**执行流程**：
```
1. 读取输入文件
2. 如果是 .ugs.json → emitClaudeScript(ir) → 临时 .js
   如果是 .js → 直接使用
3. 调用 validate（内部，不输出）
4. 构建 DAG 依赖图
5. 按拓扑顺序执行节点（并发受 --concurrency 限制）
6. 每个节点：构建 data context → 拼接 prompt → 调用 CLI/API
7. 收集输出，写入 --output（如指定）
8. 清理临时文件
```

**输出格式**：
- **默认**：流式日志到 stderr，最终结果到 stdout（或 `--output`）。
- **日志格式**（stderr）：
  ```
  [14:32:01] ▶ start
  [14:32:01] ● phase: Scan
  [14:32:02] ▶ agent n_scan (claude-code/sonnet)
  [14:32:15] ✓ agent n_scan — 13.2s
  [14:32:15] ● phase: Review
  [14:32:15] ▶ parallel n_parallel (3 branches)
  [14:32:15] ▶   branch: security-review
  [14:32:15] ▶   branch: performance-check
  [14:32:15] ▶   branch: code-style
  [14:32:28] ✓   branch: security-review — 12.8s
  [14:32:30] ✓   branch: performance-check — 14.5s
  [14:32:31] ✓   branch: code-style — 15.9s
  [14:32:31] ✓ parallel n_parallel — 16.1s
  [14:32:31] ▶ end
  [14:32:31] ✓ Workflow complete — 29.8s total
  ```
- **JSON 输出**（`--json`）：
  ```json
  {
    "success": true,
    "durationMs": 29800,
    "nodeResults": {
      "n_scan": { "status": "success", "output": "...", "durationMs": 13200 },
      "n_parallel": { "status": "success", "output": "...", "durationMs": 16100 }
    },
    "outputs": { "n_scan": "...", "n_parallel": "..." }
  }
  ```

**交互模式**（`--interactive`）：
- 当节点输出包含 `<<UGS_ASK>>...<<UGS_ASK_END>>` 哨兵块时：
  1. 暂停该节点的执行。
  2. 在终端渲染交互提示（`select`/`input`/`confirm`）。
  3. 用户回答后，将答案格式化为协议文本追加到节点 prompt。
  4. 继续执行。
- 实现：复用 `core/interaction.ts` 的 `parseInteraction()` + `formatAnswerForPrompt()`，CLI 侧用 `readline` 驱动。

**恢复模式**（`--resume`）：
- 读取 `.ugs-run/<workflow-name>/last-run.json` 中的状态快照。
- 从 `failedNodeId` 开始重新执行，已成功的节点跳过（复用 `seedOutputs`）。

**运行时状态目录**：
```
.ovf-run/
└── <workflow-name>/
    ├── last-run.json       # 运行状态快照（用于 --resume）
    ├── logs/
    │   └── 2026-06-01T143201.log  # 详细日志（保留最近 10 次）
    └── outputs/
        └── <node-id>.txt   # 各节点原始输出（可选保留）
```

**错误码**：
- `0`：全部成功
- `1`：运行中发生错误（节点失败、超时、spawn 失败）
- `2`：用户中断（Ctrl+C）
- `3`：验证失败（dry-run 或预检失败）
- `4`：配置错误（适配器不存在、API key 缺失）

**行为边界**：
- 对 `IRGraph` 始终**只读**。
- 运行状态写入独立的 `RunContext` / 文件系统，不修改输入文件。
- 取消信号：响应 `SIGINT`（一次 graceful，两次 force kill）。
- 节点重试：自动重试瞬态失败（timeout / idle_timeout / exit / wait），backoff 1.5s, 3s, 4.5s, cap 15s。

---

### 3.6 `ugs list <resource>` — 列出可用资源

**用途**：查询环境能力。

```
Usage: ugs list <resource> [options]

Resources:
  adapters                列出已安装的适配器 CLI
  models                  列出可用模型（需指定 --adapter）
  templates               列出内置和用户模板

Options:
  -a, --adapter <adapter> 指定适配器（用于 list models）
  --json                  JSON 输出
```

**输出示例**：
```bash
$ ugs list adapters
ADAPTER      PATH                    VERSION
claude-code  /usr/local/bin/claude   2.1.112
codex        /usr/local/bin/codex    0.7.2
gemini       /usr/local/bin/gemini   1.2.0

$ ugs list models --adapter claude-code
MODEL              CLASS    DESCRIPTION
claude-opus-4-8    opus     Most capable
claude-sonnet-4-6  sonnet   Balanced
claude-haiku-4-5   haiku    Fastest
```

**行为边界**：
- `adapters`：扫描 `PATH` 找 `claude`/`codex`/`gemini` 可执行文件，复用 `cli_runtime.rs` 的扫描逻辑。
- `models`：调用适配器 CLI 的模型列表能力（若支持），否则返回内置列表。
- `templates`：读取 `~/.ugs/templates/` + 内置模板目录。
- 纯查询，不修改状态。

---

### 3.7 `ugs convert` — 格式互转

**用途**：在不同格式间转换 workflow。

```
Usage: ugs convert <file> [options]

Options:
  --from <format>         源格式：auto | ugs | js | yaml（默认：auto）
  --to <format>           目标格式：ugs | js | yaml（默认：ugs）
  -o, --output <path>     输出路径（默认：stdout）
  --strip-layout          去掉 layout 坐标（适合版本控制）
  --strip-run             去掉运行状态快照

Arguments:
  file                    输入文件路径，或 - 表示 stdin
```

**支持矩阵**：

| From \ To | `.ugs.json` | `.js` | `.yaml` |
|-----------|-------------|-------|---------|
| `.ugs.json` | ✓ (noop) | emit | 序列化 |
| `.js` | parse | ✓ (noop) | parse → yaml |
| `.yaml` | 反序列化 | 反序列化 → emit | ✓ (noop) |

**行为边界**：
- 不验证语义，只做格式转换。
- `--strip-layout` 去掉 `layout` 字段。
- `--strip-run` 去掉 `meta.run` 字段。

---

### 3.8 `ugs diff <fileA> <fileB>` — 比较

**用途**：结构级比较两个 workflow。

```
Usage: ugs diff <fileA> <fileB> [options]

Options:
  --ignore-layout         忽略坐标差异
  --ignore-ids            仅比较结构（判断同构）
  --json                  JSON diff 输出

Arguments:
  fileA, fileB            两个输入文件（支持混合 .ugs.json / .js）
```

**输出格式**（默认）：
```diff
--- workflow-v1.ugs.json
+++ workflow-v2.ugs.json
@@ meta @@
  name: security-audit
- description: Automated security review
+ description: Automated security & performance review
@@ nodes @@
+ agent "n_agent_3" (security-review, model=opus)
- agent "n_agent_2" (explore)
@@ edges @@
+ data: n_scan.out → n_agent_3.in
- data: n_scan.out → n_agent_2.in
@@ params @@
  n_agent_1.prompt: "Review code..."
- n_agent_1.model: sonnet
+ n_agent_1.model: opus
```

**行为边界**：
- 统一归一化为 `IRGraph` 后比较。
- `--ignore-layout` 忽略 `layout` 字段差异。
- `--ignore-ids` 按节点类型+参数比较结构，忽略 `id` 差异（用于判断两个图是否同构）。

---

### 3.9 `ugs info <file>` — 显示元数据

**用途**：快速了解工作流内容。

```
Usage: ugs info <file> [options]

Options:
  --json                  JSON 输出

Arguments:
  file                    .ugs.json 或 .js 路径
```

**输出格式**（默认）：
```
Name:        security-audit
Description: Automated security review workflow
Adapter:     claude-code
Nodes:       8 (2 agent, 1 parallel, 3 phase, 1 branch, 1 codeblock)
Edges:       7 (5 exec, 2 data)
Phases:      Scan → Review → Verify
Status:      last run 2026-05-30, success
Size:        4.2 KB
```

**行为边界**：
- 只读展示，不修改。
- `.js` 输入时先 `parse` 再统计。

---

## 4. 核心模块对接规格

### 4.1 直接复用模块（零改动）

以下模块在 CLI 中直接 `import` 使用，无需任何修改：

| 模块 | 导入路径 | 用途 |
|------|----------|------|
| `IRGraph` 类型系统 | `core/ir.ts` | 类型定义、常量 |
| `emitClaudeScript` | `core/emitter.ts` | `ugs emit` |
| `parseClaudeScript` | `core/parser.ts` | `ugs parse`, `ugs validate` |
| `roundtrip` | `core/roundtrip.ts` | `ugs validate --roundtrip`（可选） |
| `topoOrderExec` | `core/topo.ts` | `ugs run` DAG 排序 |
| `isRunnable` | `core/topo.ts` | `ugs run` 节点可运行性判断 |
| `parseInteraction` | `core/interaction.ts` | `ugs run --interactive` |
| `stripInteraction` | `core/interaction.ts` | `ugs run --interactive` |
| `INTERACTION_PROTOCOL` | `core/interaction.ts` | 交互协议常量 |
| `assessConsensusFit` | `core/consensusHeuristic.ts` | `runConsensus` 策略选择 |
| `readStartUserInputs` | `core/startInputs.ts` | `start` 节点用户输入处理 |
| `defaultBlueprint` | `core/defaultBlueprint.ts` | `ugs init` 默认模板 |
| `isEmptyWorkflow` | `core/isEmptyWorkflow.ts` | `ugs validate` 空图检查 |

### 4.2 需抽象后复用的运行时模块

当前这些逻辑内嵌在 `store/useStore.ts` 中，需要通过 `RunCallbacks` 接口抽象后抽出到 `runtime/` 目录：

#### 4.2.1 `RunCallbacks` 接口（新增）

```typescript
// runtime/types.ts

export interface RunCallbacks {
  /** 节点开始执行 */
  onNodeStart(node: IRNode): void;

  /** 节点成功完成 */
  onNodeSuccess(node: IRNode, output: string): void;

  /** 节点失败 */
  onNodeFailure(node: IRNode, failure: RunFailure): void;

  /** 通用日志 */
  onLog(text: string, role?: 'system' | 'node' | 'error'): void;

  /** 流式进度更新（用于实时显示） */
  onProgress?(chunk: string): void;

  /** 取消信号检查 */
  isCancelled(): boolean;

  /** 交互请求：CLI 实现用 readline，GUI 实现用 React state */
  promptInteraction?(req: InteractionRequest): Promise<InteractionAnswer>;
}

export interface RunContext {
  cwd: string;
  adapter: string;
  model?: string;
  providerId?: string;
  concurrency: number;
  maxRetries: number;
  timeoutSeconds: number;
  idleTimeoutSeconds: number;
  gatewaySelection?: GatewaySelection;
  env?: Record<string, string>;   // --var 注入的变量
}

export interface RunResult {
  success: boolean;
  durationMs: number;
  nodeResults: Record<string, NodeRunResult>;
  outputs: Record<string, string>;
  failedNodeId?: string;
  error?: RunFailure;
}

export interface NodeRunResult {
  status: 'idle' | 'running' | 'success' | 'error';
  output?: string;
  durationMs?: number;
  failure?: RunFailure;
  retryCount?: number;
}
```

#### 4.2.2 抽出函数映射

| 原函数（useStore.ts） | 抽出后位置 | 抽象方式 |
|----------------------|-----------|----------|
| `executeViaCliInterpreter` | `runtime/dag.ts` → `executeWorkflowDag(ir, callbacks, context, options?)` | 替换 `ch` 为 `callbacks` + `context` |
| `runNode` | `runtime/node-dispatch.ts` → `dispatchNode(node, workflow, results, context, callbacks)` | 替换 `ch` 为 `context` + `callbacks` |
| `runParallel` | `runtime/node-dispatch.ts` | 同上 |
| `runPipeline` | `runtime/node-dispatch.ts` | 同上 |
| `runConsensus` | `runtime/node-dispatch.ts` | 同上 |
| `resolveConsensus` | `runtime/node-dispatch.ts` | 同上 |
| `processNode` (内嵌) | `runtime/dag.ts` → `processNodeWithRetry(...)` | 替换 `ch` 为 `context` + `callbacks` |
| `runWithConcurrency` | `runtime/concurrency.ts` → `runWithConcurrency<T, R>(items, limit, fn)` | 已是通用函数，直接复制 |
| `dataContextString` | `runtime/context.ts` → `buildDataContextString(node, workflow, results)` | 已是纯函数，直接复制 |
| `dataInputsFor` | `runtime/context.ts` → `getDataInputs(node, workflow, results)` | 已是纯函数，直接复制 |
| `withNodeExecutionContract` | `runtime/contract.ts` → `appendExecutionContract(prompt)` | 纯字符串拼接，直接复制 |
| `describeRunFailure` | `runtime/failure.ts` → `parseRunFailure(error)` | 纯正则解析，直接复制 |
| `isRetryableFailure` | `runtime/failure.ts` → `isRetryable(failure)` | 纯判断，直接复制 |
| `failureTitle` | `runtime/failure.ts` | 纯格式化，直接复制 |
| `formatFailureLine` | `runtime/failure.ts` | 纯格式化，直接复制 |
| `runFailureMeta` | `runtime/failure.ts` | 纯格式化，直接复制 |
| `buildRunDependencies` | `runtime/dag.ts` → `buildDependencyGraph(order, workflow)` | 纯图算法，直接复制 |
| `runnableOrder` | `runtime/dag.ts` → `getRunnableNodes(workflow)` | topoOrderExec 的包装，直接复制 |
| `invokeGatewayAgent` | `runtime/gateway.ts` → `invokeAgent(prompt, selection, context)` | 替换 `ch` 为 `context` |
| `invokeAgentCli` | `runtime/gateway.ts` | 同上 |
| `runCliWithInteraction` | `runtime/gateway.ts` → `runAgentWithInteraction(opts)` | 替换流式/UI 耦合为 `callbacks.onProgress` + `callbacks.promptInteraction` |
| `runNodeGatewaySelection` | `runtime/gateway.ts` → `resolveNodeGateway(node, workflow, context)` | 将 localStorage 配置替换为 `context.gatewaySelection` |

### 4.3 必须替换的 IO 层

| 现有实现 | CLI 替代 | 说明 |
|----------|----------|------|
| `lib/tauri.ts` → `aiEditViaCli()` | `runtime/io/cli-spawn.ts` → `spawnCliAgent(opts)` | Node `child_process.spawn` 调用 `claude -p` / `codex exec` / `gemini` |
| `lib/tauri.ts` → `cancelAiCli()` | `spawn.kill('SIGTERM')` / `SIGKILL` | 进程信号 |
| `onWorkflowLog` / `onWorkflowNode` Tauri events | `stdout`/`stderr` 流 + `readline` | 实时输出 |
| `lib/anthropic.ts` → `streamAnthropic()` | Node `fetch` / `@anthropic-ai/sdk` | 直调 API |
| `lib/modelGateway/adapters/*.ts` | Node `fetch` / 各 provider SDK | 直调 API |
| `lib/persist.ts` | Node `fs` / `path` | 文件读写 |
| `store/history/store.ts` | 本地 JSONL / SQLite / 无状态 | 会话持久化（可选） |
| `awaitInteraction()` (React state) | `readline` / `inquirer` | CLI 交互 |

---

## 5. 模块边界与共享契约

### 5.1 共享层（GUI + CLI）

```
app/src/core/
├── ir.ts              ← 数据契约（类型定义）
├── emitter.ts         ← 编译器（IR → JS）
├── parser.ts          ← 反编译器（JS → IR）
├── roundtrip.ts       ← 验证工具
├── topo.ts            ← 拓扑排序
├── interaction.ts     ← 交互协议（纯文本）
├── consensusHeuristic.ts
├── startInputs.ts
├── defaultBlueprint.ts
├── isEmptyWorkflow.ts
├── sample.ts
└── fixtures.ts

app/src/runtime/       ← 新增：运行时引擎（从 useStore.ts 抽出）
├── types.ts           ← RunCallbacks, RunContext, RunResult
├── dag.ts             ← DAG 调度器
├── node-dispatch.ts   ← 节点分发器
├── concurrency.ts     ← 并发池
├── context.ts         ← 数据上下文构建
├── contract.ts        ← 执行契约
├── failure.ts         ← 错误解析
└── gateway.ts         ← Gateway 调用抽象
```

**契约保证**：
- `core/` 模块**永不** import `react` / `zustand` / `tauri`。
- `runtime/` 模块**永不** import `react` / `zustand` / `tauri`。
- GUI (`store/useStore.ts`) 和 CLI (`cli/`) 都通过 `RunCallbacks` 消费 `runtime/` 的输出。

### 5.2 GUI 独占层

```
app/src/store/useStore.ts          ← 保留 Zustand 状态管理
app/src/store/history/store.ts     ← Tauri SQLite 会话历史
app/src/lib/tauri.ts               ← Tauri IPC 调用
app/src/lib/persist.ts             ← Tauri 文件对话框
app/src/canvas/                    ← React Flow 画布
app/src/panels/                    ← UI 面板
```

**改造方式**：
- `useStore.ts` 中的运行逻辑**渐进式迁移**到 `runtime/`，保留 UI 相关的状态更新代码。
- `executeViaCliInterpreter` 调用改为 `executeWorkflowDag(ir, guiCallbacks, context)`。
- `guiCallbacks` 实现：`onNodeStart` → `setState` 更新节点颜色；`onLog` → `pushChannelMessage`；`promptInteraction` → `awaitInteraction()`（React state 阻塞）。

### 5.3 CLI 独占层

```
app/cli/                           ← 新增：Node.js CLI 入口
├── bin/ugs.ts                     ← CLI 入口（commander）
├── commands/
│   ├── init.ts
│   ├── emit.ts
│   ├── parse.ts
│   ├── validate.ts
│   ├── run.ts
│   ├── list.ts
│   ├── convert.ts
│   ├── diff.ts
│   └── info.ts
├── io/
│   ├── cli-spawn.ts               ← child_process 封装
│   ├── stream.ts                  ← stdout/stderr 流式输出
│   └── interaction.ts             ← readline 交互驱动
├── config/
│   ├── providers.ts               ← 替代 gatewayConfig / apiConfig
│   └── shell.ts                   ← 替代 shellConfig
└── utils/
    ├── format.ts                  ← 表格/颜色格式化
    └── fs.ts                      ← 文件工具
```

---

## 6. Node.js CLI 实现路径

### 6.1 目录结构

```
app/
├── src/
│   ├── core/              ← 现有，共享
│   ├── runtime/           ← 新增，从 useStore.ts 抽出
│   └── ...                ← 现有 GUI 代码
├── cli/                   ← 新增
│   ├── bin/
│   │   └── ugs.ts         ← shebang + commander 入口
│   ├── commands/          ← 各子命令实现
│   ├── io/                ← CLI IO 层
│   ├── config/            ← CLI 配置管理
│   └── utils/             ← 辅助函数
├── package.json           ← 添加 "bin": { "ugs": "./cli/bin/ugs.ts" }
└── tsconfig.cli.json      ← CLI 专用 tsconfig
```

### 6.2 package.json 修改

```json
{
  "name": "@ultragamestudio/cli",
  "version": "0.1.0",
  "bin": {
    "ugs": "./cli/dist/bin/ugs.js"
  },
  "scripts": {
    "cli:build": "tsc -p tsconfig.cli.json",
    "cli:dev": "tsx cli/bin/ugs.ts",
    "cli:test": "vitest run cli/"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "chalk": "^5.3.0",
    "inquirer": "^9.2.0"
  }
}
```

### 6.3 构建与分发

```bash
# 开发（直接运行 TS）
cd app
npx tsx cli/bin/ugs.ts run workflow.ugs.json

# 构建（编译到 cli/dist/）
npm run cli:build

# 本地链接
npm link
ugs --version

# 发布到 npm
npm publish --access public
```

---

## 7. Rust CLI 对接（长期）

### 7.1 定位

Rust CLI 不是重新实现，而是**Node.js CLI 的高性能分发形态**：
- 单文件 `.exe`，无需 Node.js 运行时。
- 复用 `cli_runtime.rs` 的进程调用基础设施。
- `emit`/`parse` 等纯计算命令通过 `napi-rs` 调用 TypeScript 核心。

### 7.2 架构

```
app/src-tauri/src/cli/           ← 新增 Rust CLI 模块
├── mod.rs                       ← CLI 命令定义（clap）
├── commands/
│   ├── run.rs                   ← 复用 cli_runtime.rs
│   ├── list.rs                  ← PATH 扫描
│   └── info.rs                  ← 纯 Rust 实现
└── napi/                        ← napi-rs 绑定（调用 TS core）
    ├── emit.rs
    ├── parse.rs
    └── validate.rs
```

### 7.3 渐进策略

| 阶段 | 命令 | 实现方式 |
|------|------|----------|
| Phase 1 | `run` | 纯 Rust，复用 `cli_runtime.rs` + `tokio::process` |
| Phase 1 | `list` | 纯 Rust，复用 `scan_model_clis()` |
| Phase 2 | `emit`, `parse`, `validate` | 通过 `napi-rs` 调用 `app/src/core/*.ts` |
| Phase 3 | `init`, `convert`, `diff`, `info` | 纯 Rust 或 napi-rs |

---

## 8. Phase 0 解耦实施步骤

在 CLI 功能实现之前，必须先完成「运行引擎从 useStore.ts 解耦」。以下是具体步骤：

### Step 0.1：创建 `runtime/` 目录结构

```bash
mkdir -p app/src/runtime
```

### Step 0.2：迁移零副作用纯函数（1 天）

按依赖顺序迁移以下函数（已确认无 UI/Tauri 依赖）：

1. `runtime/context.ts`：
   - `dataInputsFor()` → `getDataInputs()`
   - `dataContextString()` → `buildDataContextString()`

2. `runtime/contract.ts`：
   - `withNodeExecutionContract()` → `appendExecutionContract()`

3. `runtime/failure.ts`：
   - `describeRunFailure()` → `parseRunFailure()`
   - `isRetryableFailure()` → `isRetryable()`
   - `failureTitle()` / `formatFailureLine()` / `runFailureMeta()`

4. `runtime/concurrency.ts`：
   - `runWithConcurrency()`

5. `runtime/dag.ts`：
   - `buildRunDependencies()` → `buildDependencyGraph()`
   - `runnableOrder()` → `getRunnableNodes()`

**验证**：每次迁移后运行 `npm run typecheck` 确认无类型错误。

### Step 0.3：定义 `RunCallbacks` + `RunContext` 接口（0.5 天）

在 `runtime/types.ts` 中定义接口（见 §4.2.1）。

### Step 0.4：抽象 `runNode` 和 `runCliWithInteraction`（1 天）

1. 将 `runNode()` 抽出到 `runtime/node-dispatch.ts`：
   - 替换 `ch: RunChannel` 为 `context: RunContext` + `callbacks: RunCallbacks`。
   - 保留 `switch(node.type)` 分发逻辑。

2. 将 `runCliWithInteraction()` 抽出到 `runtime/gateway.ts`：
   - 替换 `createStreamMessage()` / `sm.append` 为 `callbacks.onProgress(chunk)`。
   - 替换 `awaitInteraction()` 为 `callbacks.promptInteraction(req)`。
   - 替换 `aiEditViaCli()` 为 `spawnCliAgent()`（接口层，CLI/GUI 各实现）。

### Step 0.5：抽象 DAG 调度器（1 天）

将 `executeViaCliInterpreter` 抽出到 `runtime/dag.ts` → `executeWorkflowDag()`：
- 替换 `useStore.setState` 为 `callbacks.onNodeStart()` / `onNodeSuccess()` / `onNodeFailure()`。
- 替换 `pushRunLog()` 为 `callbacks.onLog()`。
- 替换 `stillRunning(ch)` 为 `callbacks.isCancelled()`。
- 保留 `pickReady()` + `pump()` + `processNode` retry loop 核心算法不变。

### Step 0.6：GUI 侧适配（0.5 天）

修改 `useStore.ts`：
```typescript
// 旧：直接内嵌运行逻辑
// 新：调用抽出的 runtime 函数
import { executeWorkflowDag } from '../runtime/dag';

const guiCallbacks: RunCallbacks = {
  onNodeStart: (node) => setState(...),
  onNodeSuccess: (node, output) => setState(...),
  onNodeFailure: (node, failure) => setState(...),
  onLog: (text, role) => pushChannelMessage(...),
  isCancelled: () => ch.cancelled,
  promptInteraction: (req) => awaitInteraction(req),  // 现有 React 阻塞
};

await executeWorkflowDag(ir, guiCallbacks, context, options);
```

### Step 0.7：验证（0.5 天）

1. `npm run typecheck` — 全量类型检查通过。
2. 在浏览器中打开应用，运行一个 sample workflow，确认行为与解耦前一致。
3. 在 dev console 执行 `UltraGameStudio.roundtrip()`，确认 emit/parse 无损。

---

## 9. Skill 与 CLI 的协作流程

### 9.1 用户请求 → Skill → CLI 的完整链路

```
User: /ultragamestudio run my-flow.ugs.json --model sonnet --interactive

Claude (Skill):
  1. 解析 $0=run, $1=my-flow.ugs.json
  2. 检查 ugs CLI 是否可用（which ugs 或 npx ugs --version）
  3. 执行：npx ugs run my-flow.ugs.json --model sonnet --interactive
  4. 流式读取 stdout/stderr，实时展示给用户
  5. 如果 stdout 中出现 <<UGS_ASK>>...<<UGS_ASK_END>>：
     a. 解析为 InteractionRequest
     b. 调用 AskUserQuestion 向用户提问
     c. 将回答格式化为协议文本
     d. 通过 stdin 写回 CLI 进程
  6. CLI 退出后，展示最终 Summary
```

### 9.2 Skill 定位原则

| 原则 | 说明 |
|------|------|
| **薄触发层** | Skill 不做任何业务逻辑，只负责参数透传和结果展示。 |
| **不内嵌 IR** | Skill 不直接操作 IRGraph JSON，所有图操作委托给 CLI。 |
| **状态外置** | Skill 不维护运行状态，状态由 CLI 的 `.ugs-run/` 目录管理。 |
| **交互代理** | Skill 是 CLI `promptInteraction` 的一个实现端（通过 `AskUserQuestion`）。 |

---

## 10. 配置与凭证管理

### 10.1 配置层级（优先级从高到低）

```
1. 命令行 flag（--adapter, --model, --concurrency 等）
2. 环境变量（ANTHROPIC_API_KEY, OPENAI_API_KEY, UGS_RUN_CONCURRENCY 等）
3. 项目级配置文件（./.ugs.json 或 ./.ugs/config.json）
4. 用户级配置文件（~/.ugs/config.json）
5. 内置默认值
```

### 10.2 配置文件格式（`~/.ugs/config.json`）

```json
{
  "version": 1,
  "defaults": {
    "adapter": "claude-code",
    "model": "sonnet",
    "concurrency": 3,
    "maxRetries": 2,
    "timeoutSeconds": 300
  },
  "gateways": {
    "claude-code": {
      "providerId": "default",
      "channelId": null
    },
    "codex": {
      "providerId": "openai-default"
    }
  },
  "templatesDir": "~/.ugs/templates"
}
```

### 10.3 凭证管理

- **API Keys**：通过环境变量注入，**绝不**写入配置文件或日志。
- **CLI 可执行文件路径**：通过 `PATH` 自动发现，或配置文件中 `adapters.<name>.path` 显式指定。

---

## 11. 测试策略

### 11.1 单元测试

| 模块 | 测试范围 | 工具 |
|------|----------|------|
| `core/emitter.ts` | emit 输出匹配预期脚本 | vitest |
| `core/parser.ts` | parse 后 IRGraph 结构正确 | vitest |
| `core/roundtrip.ts` | emit→parse 无损 | vitest |
| `runtime/dag.ts` | 拓扑排序、依赖图、调度顺序 | vitest |
| `runtime/failure.ts` | 错误解析分类正确 | vitest |
| `cli/commands/*.ts` | 各子命令参数解析、exit code | vitest |

### 11.2 集成测试

| 场景 | 命令 | 断言 |
|------|------|------|
| 完整 round-trip | `ugs emit X.ugs.json \| ugs parse --stdin` | 输出 IRGraph 与输入同构 |
| validate 通过 | `ugs validate valid.ugs.json` | exit 0 |
| validate 失败 | `ugs validate broken.ugs.json` | exit 1 + 错误信息 |
| dry-run | `ugs run workflow.ugs.json --dry-run` | exit 0，不 spawn CLI |
| 空图 init | `ugs init test && ugs validate test.ugs.json` | exit 0 |

### 11.3 端到端测试

- 使用 mock CLI 适配器（不调用真实 API），验证完整 DAG 执行流程。
- 测试并发限制、重试逻辑、取消信号传播。

---

## 12. 风险与缓解

| # | 风险 | 严重度 | 缓解方案 |
|---|------|--------|----------|
| 1 | `useStore.ts` 解耦过程中引入回归 | 🔴 中 | 每次迁移后运行 GUI 端到端测试；保留原函数作为 wrapper 渐进替换。 |
| 2 | CLI `run` 命令与 GUI 运行结果不一致 | 🟡 中 | 共享 `runtime/` 核心逻辑；差异仅存在于 callbacks 实现。 |
| 3 | 交互模式用户体验差（纯文本 vs GUI 控件） | 🟡 中 | 明确文档限制；支持 `--non-interactive` 自动跳过交互节点。 |
| 4 | Skill 上下文预算限制（大型 IR JSON） | 🟢 低 | Skill 只传文件路径，不内嵌 IR JSON。 |
| 5 | Node.js CLI 与 Rust CLI 行为分叉 | 🟢 低 | Rust CLI 优先调用共享 TS 核心（napi-rs）；纯 Rust 命令保持最小。 |

---

## 13. 附录

### 13.1 术语表

| 术语 | 定义 |
|------|------|
| **IRGraph** | UltraGameStudio 中间表示图，workflow 的单一数据源。 |
| **蓝图** | `.ugs.json` 文件，IRGraph 的 JSON 序列化。 |
| **脚本** | `.js` 文件，Claude Code workflow script，由 `emitClaudeScript` 生成。 |
| **适配器** | 底层 AI CLI（`claude-code`, `codex`, `gemini`）。 |
| **Gateway** | 模型路由层，决定用哪个适配器/模型/ provider 执行节点。 |
| **哨兵块** | `<<UGS_ASK>>...<<UGS_ASK_END>>` 协议文本，用于节点向用户请求交互。 |
| **exec spine** | 执行流脊柱，由 `exec` 边连接的控制流拓扑路径。 |

### 13.2 参考文件

| 文件 | 作用 |
|------|------|
| `app/src/core/ir.ts` | IRGraph 类型定义 |
| `app/src/core/emitter.ts` | `emitClaudeScript` 实现 |
| `app/src/core/parser.ts` | `parseClaudeScript` 实现 |
| `app/src/store/useStore.ts` | 现有运行时引擎（待解耦） |
| `app/src-tauri/src/cli_runtime.rs` | Rust CLI 运行时基础设施 |
| `.claude/skills/ultragamestudio/SKILL.md` | Claude Code Skill 定义 |

### 13.3 相关 Memory

- [[consensus-node]] — 共识/投票节点策略
- [[run-execution-model]] — 运行时执行模型
- [[run-performance]] — 性能优化
- [[run-auto-retry]] — 自动重试机制
- [[run-channel-background]] — RunChannel 解耦
- [[litellm-model-resolution]] — 模型路由
- [[headless-roundtrip-verification]] — 验证测试

---

*本规格基于上游「并行调研三块独立信息」+「可复用能力盘点」+「CLI 命令面与用例」+「多视角交叉验证」四份输出的综合结论撰写。*
