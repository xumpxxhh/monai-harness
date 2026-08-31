# HANDOFF — 实现交接

> 最后更新：2026-08-28（**M1 真实模型簇已实装完成**）

## 当前状态（一句话）

**P0–P9 及 M1（真实模型簇）均已完成。**
- Context Builder（design 05 优先级与预算裁剪 + ContextBuildRecord 持久化）
- BudgetGuard（step / token / cost / wall 校验，超额不调模型）
- Model Policy 循环与 fallback / attempt 追踪
- SecretPort 与 `@monai/secret-env` 租约隔离
- 真实 OpenAI 兼容 Adapter `@monai/model-openai`
- Observability Token/cost 与 Context overflow 指标重算
- Eval 114 用例全绿。Knowledge 检索后置。

## 下一步

1. **Knowledge 检索切片**（design 08 §2.6：KnowledgePort 真实检索接入与 Context selections）
2. **ConfirmationGrant / confirm_once**（P5 增强）
3. **真实单机 / Docker 联调与真实模型 End-to-End 演示**

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
| M1 总结 | `docs/implementation/sessions/0018-real-model-cluster-plan.md` |
| Context Builder | `packages/runtime/src/context/build-context.ts` |
| BudgetGuard | `packages/runtime/src/control/budget-guard.ts` |
| execute_turn 模型调用 | `packages/runtime/src/engine/execute-turn.ts` |
| SecretPort (Env) | `packages/adapters/secret-env/src/index.ts` |
| OpenAI ModelPort | `packages/adapters/model-openai/src/index.ts` |
| 模型与 Context 指标 | `packages/observability/src/metrics/compute-model-metrics.ts` |
| harness 装配 | `apps/harness/src/bootstrap/container.ts` |
