# 0004 — P3 light 决策环

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P3 → `done` |
| HANDOFF 已更新 | 是 |

## 目标

打通 `execute_turn`：Pre/PostReasoning Hook → Context → Model stub → Policy →（只读）Observation → Fact → Reducer。

## 改动

- contracts：Action / Observation / FactEnvelope / RunState；TURN_EVENT_TYPES
- ports：`getState`；CommitPlan.state → RunState
- pack-sdk：HookPoint / HookResult / HookHandler
- model-stub：StubModelPort（echo / deny / approve / finish）
- runtime：HookRunner、ContextBuilder、evaluatePolicy、reduce、execute_turn
- persistence-memory：持久化 state
- apps/harness：链接 pack-sdk + model-stub

## 验证

- [x] `pnpm build` / `check-types`
- [x] `pnpm --filter @monai/runtime test`（13）
- [x] delivery / persistence-memory 既有测试仍通过

## 未完成

- P4 Tool prepared/dispatch/reconcile（替换 readonly 旁路）
- P5 require_approval → awaiting_approval
- HTTP（EDR-007）
