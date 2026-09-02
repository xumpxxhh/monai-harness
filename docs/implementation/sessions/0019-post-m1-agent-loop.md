# Session 0019 — M2 Agent Loop 增强（function calling / 并行工具 / Dialogue Context / Session Demo）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-02 |
| 类型 | 实现（M2 归档） |
| HANDOFF 已更新 | 是 |

## 目标

M1 完成后，对齐已修订的 design 01/03/05 与 engineering 04，落地 **M2 Agent Loop 增强**：

- function calling：`ModelDecision` → Action 映射
- `Action.calls[]` 并行工具 prepared / Policy 按条判定
- Dialogue Context 分层投影与压缩
- harness Session CLI 多轮对话 demo

## 改动路径（摘要）

| 切片 | 路径 |
| --- | --- |
| M2a contracts | `packages/contracts/src/action.ts`（`calls[]`）、`dialogue.ts` |
| M2b 模型决策 | `packages/runtime/src/model/function-catalog.ts`、`map-decision.ts`、`hydrate-action.ts`、`normalize-action.ts` |
| M2c 并行工具 | `packages/runtime/src/execution/prepare-tool-calls.ts`、`control/project-approval.ts`、`policy/evaluate-policy.ts`、`engine/execute-turn.ts` |
| M2d Context 投影 | `packages/runtime/src/context/build-model-context.ts`、`project-dialogue.ts`、`compress-dialogue.ts`、`project-messages.ts`、`preview/publish-model-context.ts` |
| M2e harness demo | `apps/harness/src/cli/demo-session.ts`、`demo-shared.ts`、`session-transcript.ts`、`observer/session-demo-observer.ts`、`workspace/fs-workspace.ts` |
| adapters | `packages/adapters/model-openai`、`model-stub` |
| design/engineering | `docs/design/01,03,04,05`；`docs/engineering/02,04`（代码提交中已更新） |

## 验证

```text
pnpm --filter @monai/runtime test
pnpm --filter @monai/model-openai test
pnpm --filter harness test
pnpm --filter @monai/observability test   # Eval 仍 stub，114 绿
```

## 未完成

- KnowledgePort 真实检索
- ConfirmationGrant / confirm_once
- `atomic` / `dependencies` 依赖图执行
- Memory 进 Context（MVP 仍 `memoryEnabled=false`）
