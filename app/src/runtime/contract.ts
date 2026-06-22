/**
 * CONTRACT: the node-execution contract appendix. Pure string concatenation,
 * moved verbatim from store/useStore.ts (`withNodeExecutionContract`).
 */
export function appendExecutionContract(prompt: string): string {
  return `${prompt}

---
UltraGameStudio node execution contract:
- Treat this as one bounded workflow node, not an open-ended session.
- Finish with a concise final answer even if optional verification remains.
- Do not start long-running ad-hoc harnesses after the requested checks pass.
- If a command or investigation stops making progress, stop and report the exact next step instead of waiting indefinitely.`;
}
