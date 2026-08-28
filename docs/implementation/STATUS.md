# 实现状态看板

> 与各 [packages/](./packages/) / [adapters/](./adapters/) 进展页同步。不一致时以包页为准。  
> 最后同步：2026-08-28（**M1 真实模型簇已完成**；P9 done）

## 1. 阶段

| 阶段 | 状态 | 备注 |
| --- | --- | --- |
| [P0](./PHASES.md#p0--monorepo-骨架) | `done` | pnpm/turbo 空仓可 build |
| [P1](./PHASES.md#p1--契约端口uowevent) | `done` | contracts/ports/memory UoW + L0 |
| [P2](./PHASES.md#p2--投递闭环-createrunrunning) | `done` | CreateRun→running + L1 |
| [P3](./PHASES.md#p3--light-决策环) | `done` | execute_turn + Policy/Reducer L0/L1 |
| [P4](./PHASES.md#p4--副作用-tool-链) | `done` | prepared/dispatch/unknown/reconcile |
| [P5](./PHASES.md#p5--等待态) | `done` | Approval / ask_user / Checkpoint |
| [P6](./PHASES.md#p6--恢复) | `done` | RecoveryService + L1 replay/lease |
| [P7](./PHASES.md#p7--观测与评测门禁) | `done` | EventStream + MVP 指标 + Eval 子集 |
| [P8](./PHASES.md#p8--http--postgresql) | `done` | PG L2 + harness bootstrap + Hono HTTP/SSE |
| [P9](./PHASES.md#p9--阶段-a-收口) | `done` | P9a–P9d 完成 |
| [M1](./PHASES.md#m1--真实模型簇可选) | `done` | M1a–M1h 实装完成；Knowledge 后置 |

## 2. 包状态

| 单元 | 状态 | 进展页 |
| --- | --- | --- |
| tooling / 仓库根 | `done`（P0） | [tooling.md](./packages/tooling.md) |
| contracts | `done`（M1a） | [contracts.md](./packages/contracts.md) — ContextBuildRecord / usage / priceTable |
| ports | `done`（M1e） | [ports.md](./packages/ports.md) — SecretPort lease / ModelPort 签名 |
| runtime | `done`（M1b–M1d） | [runtime.md](./packages/runtime.md) — BudgetGuard / Builder / Policy |
| delivery | `done`（P9d） | [delivery.md](./packages/delivery.md) |
| api | `done`（P8c） | [api.md](./packages/api.md) |
| pack-sdk | `done`（P9a） | [pack-sdk.md](./packages/pack-sdk.md) |
| packs/workspace-generic | `done`（P9a） | [workspace-generic.md](./packages/workspace-generic.md) |
| governance | `done`（P9c） | [governance.md](./packages/governance.md) |
| observability | `done`（M1g） | [observability.md](./packages/observability.md) — Token/cost + Context 指标 |
| apps/harness | `done`（M1h） | [apps-harness.md](./packages/apps-harness.md) — DI 装配 |

## 3. Adapter 状态

| 单元 | 状态 | 进展页 |
| --- | --- | --- |
| persistence | `done`（P8a L2 + P9d L1-on-PG） | [persistence.md](./adapters/persistence.md) |
| queue | `in_progress`（memory） | [queue.md](./adapters/queue.md) |
| lease | `in_progress`（memory） | [lease.md](./adapters/lease.md) |
| model | `done`（stub + openai；M1f） | [model.md](./adapters/model.md) |
| workspace | `done`（memory；P9a 路径防逃逸） | [workspace.md](./adapters/workspace.md) |
| objectstore | `not_started` | [objectstore.md](./adapters/objectstore.md) |
| knowledge | `not_started` | [knowledge.md](./adapters/knowledge.md) — M1 后置 |
| secret | `done`（`@monai/secret-env`；M1e） | [secret.md](./adapters/secret.md) |
| sandbox-stub | `not_started` | [sandbox-stub.md](./adapters/sandbox-stub.md) |
| synthetic-sink | `in_progress` | [synthetic-sink.md](./adapters/synthetic-sink.md) |

## 4. 阻塞与风险

| 项 | 级别 | 说明 |
| --- | --- | --- |
| Eval 完整矩阵 | 信息 | 114/114 绿（stub）；M1 未影响 Eval 门禁 |
| Knowledge 缺口 | 信息 | KnowledgePort 真实检索后置切片 |
| ConfirmationGrant | 信息 | P5 未做 confirm_once |
| EDR-010 | 低 | Deferred |

## 5. 决策关闭记录

| 日期 | EDR | 结果 | 备注 |
| --- | --- | --- | --- |
| 2026-08-27 | EDR-007 | Accepted | Hono（REST + SSE） |
| 2026-08-27 | EDR-005 | Accepted | PostgreSQL 单库 |
| 2026-08-27 | EDR-006 | Accepted | `runs` 行 `FOR UPDATE` |
| 2026-08-27 | EDR-008 | Accepted | Zod |
| 2026-08-27 | EDR-009 | Accepted | drizzle-orm |
| 2026-08-27 | — | CommitPlan → ports | |
| 2026-08-27 | — | LeasePort.bind | |
| 2026-08-28 | M1 | Accepted | Context Builder + BudgetGuard + SecretPort + OpenAiModelPort |

## 6. 测试 readiness

| 层 | 状态 | 备注 |
| --- | --- | --- |
| L0 纯函数 | `done`（M1b/c） | BudgetGuard 4/4，Context Builder 3/3，SecretPort 3/3 |
| L1 InMemory | `done`（M1d/f） | execute-turn fallback 6/6，OpenAiModelPort 2/2 |
| L1-on-PG | `done`（P9d） | CreateRun→running 循环 3/3 |
| L2 真实单库 | `done`（P8a） | Docker `postgres:16`；§2.3 全场景 12/12 |
| L3 Eval / Golden | `done`（P9b-sec） | Golden 30 + 控制面 76 + 安全 8 = 114 绿 |
| L0 governance | `done`（P9c） | GovernanceEvent store + Pack 注册 3/3 |

## 7. 快捷链接

- 交接：[HANDOFF.md](./HANDOFF.md)
- 阶段：[PHASES.md](./PHASES.md)（P9 done；M1 done）
- M1 计划：[sessions/0018-real-model-cluster-plan.md](./sessions/0018-real-model-cluster-plan.md)
- 工程 EDR：[../engineering/00-implementation-baseline.md](../engineering/00-implementation-baseline.md)
