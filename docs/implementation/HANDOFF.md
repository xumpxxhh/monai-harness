# HANDOFF — 实现交接

> 最后更新：2026-09-02（**M2 Agent Loop 增强已实装完成**）

## 当前状态（一句话）

**P0–P9、M1（真实模型簇）及 M2（Agent Loop 增强）均已完成。**
- Function calling：`ModelDecision` → Action 映射（控制 XOR 领域批次）
- 并行工具：`Action.calls[]`、Policy 按条判定、`prepare-tool-calls` 扇出、Step 闭合
- Dialogue Context：Event → DialogueTurn → ModelMessage[]；超阈值 `context.summary_created`
- Session Demo：`pnpm demo:session` 多轮 CLI；`FsWorkspace` 磁盘工作区
- Eval 114 用例全绿（stub）。Knowledge 检索后置。

## 下一步

1. **Knowledge 检索切片**（design 08 §2.6：KnowledgePort 真实检索接入与 Context selections）
2. **ConfirmationGrant / confirm_once**（P5 增强）
3. **真实单机 / Docker 联调与真实模型 End-to-End 演示加固**

## 禁区

- Eval / Golden 114 用例不得改用真实模型（07：固定 Tool 桩）
- 模型 API Key 不得进 Context / Event 明文（只经 SecretPort lease）
- 不得在 Reducer / Hook 中绕过安全边界
- 不宣称 design 08 阶段 A 仅因接供应商而关闭（Knowledge 未做仍缺口）

## 回归基线

```text
pnpm --filter @monai/runtime test
pnpm --filter @monai/secret-env test
pnpm --filter @monai/model-openai test
pnpm --filter @monai/observability test     # 114 Eval（stub）
pnpm --filter harness test
```

## 关键路径

| 用途 | 路径 |
| --- | --- |
| M2 总结 | `docs/implementation/sessions/0019-post-m1-agent-loop.md` |
| M1 总结 | `docs/implementation/sessions/0018-real-model-cluster-plan.md` |
| Function catalog / 决策映射 | `packages/runtime/src/model/function-catalog.ts`、`map-decision.ts` |
| 并行 prepared | `packages/runtime/src/execution/prepare-tool-calls.ts` |
| Context ModelView | `packages/runtime/src/context/build-model-context.ts` |
| Context Builder | `packages/runtime/src/context/build-context.ts` |
| BudgetGuard | `packages/runtime/src/control/budget-guard.ts` |
| execute_turn 模型调用 | `packages/runtime/src/engine/execute-turn.ts` |
| Session CLI | `apps/harness/src/cli/demo-session.ts` |
| 磁盘 Workspace | `apps/harness/src/workspace/fs-workspace.ts` |
| SecretPort (Env) | `packages/adapters/secret-env/src/index.ts` |
| OpenAI ModelPort | `packages/adapters/model-openai/src/index.ts` |
| 模型与 Context 指标 | `packages/observability/src/metrics/compute-model-metrics.ts` |
| harness 装配 | `apps/harness/src/bootstrap/container.ts` |
