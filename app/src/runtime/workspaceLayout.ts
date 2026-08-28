/**
 * 工作区目录约定：注入到每个 agent 节点 prompt，让「派生/工作副产物」统一落到
 * `.ultragamestudio/` 下，而不是散落在项目根目录或各工程目录里。
 *
 * 这是纯字符串拼接，桌面 GUI 与 headless CLI 都会经由 `runAgentWithInteraction`
 * 走到这里，因此约定对二者、对所有使用该工具的工程都一致生效。
 */

/**
 * 追加到节点 prompt 的目录约定。保持简洁稳定：它必须能塞进每个节点的 prompt，
 * 又不挤占节点自身的任务指令。
 */
export const WORKSPACE_LAYOUT_DIRECTIVE = `---
工作区目录约定（必须遵守）：
- 任何「不属于项目本身」或「项目没有指定位置」的派生/工作副产物，一律写入工作区根目录下的 .ultragamestudio/ 对应子目录，不要直接生成在工作区根目录。
  - .ultragamestudio/temp/ —— 临时文件、缓存、一次性产物、构建输出
  - .ultragamestudio/temp/planning/ —— 任务规划文件（task_plan.md / findings.md / progress.md）
  - .ultragamestudio/scripts/ —— 临时脚本、一次性脚本（.py/.sh/.ps1 等）
  - .ultragamestudio/tests/ —— 测试文件、测试脚本、测试产物
  - .ultragamestudio/docs/reading/ —— 阅读文档、调研报告、外部资料、克隆的参考仓库
  - .ultragamestudio/docs/dev/ —— 开发文档、分析记录、技术笔记、复盘报告
  - .ultragamestudio/logs/ —— 日志文件（*.log、运行/构建输出）
  - .ultragamestudio/backup/ —— 备份文件（如 *-backup-*.log）
- 只有明确属于项目本身的源码、配置、构建脚本，才放进项目对应目录。
- .ultragamestudio/ 下的运行期自动目录（assets/、clipboard-images/、jobs/、model-assets/、session-captures/、session-changes/、sidecar/）不要当临时目录使用。`;

/** 把工作区目录约定追加到一个节点 prompt 之后。 */
export function appendWorkspaceLayout(prompt: string): string {
  return `${prompt}\n\n${WORKSPACE_LAYOUT_DIRECTIVE}`;
}
