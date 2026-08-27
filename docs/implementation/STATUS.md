# 实现状态看板

> 与各 [packages/](./packages/) / [adapters/](./adapters/) 进展页同步。不一致时以包页为准。  
> 最后同步：2026-08-27（P8b harness bootstrap；下一刀 P8c）

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
| [P8](./PHASES.md#p8--http--postgresql) | `in_progress` | P8a+P8b 完成；下一刀 **P8c** HTTP/SSE（EDR-007） |

## 2. 包状态

| 单元 | 状态 | 进展页 |
| --- | --- | --- |
| tooling / 仓库根 | `done`（P0） | [tooling.md](./packages/tooling.md) |
| contracts | `in_progress` | [contracts.md](./packages/contracts.md) |
| ports | `in_progress` | [ports.md](./packages/ports.md) |
| runtime | `in_progress` | [runtime.md](./packages/runtime.md) |
| delivery | `in_progress` | [delivery.md](./packages/delivery.md) |
| api | `in_progress` | [api.md](./packages/api.md) |
| pack-sdk | `in_progress` | [pack-sdk.md](./packages/pack-sdk.md) |
| packs/workspace-generic | `not_started` | [workspace-generic.md](./packages/workspace-generic.md) |
| governance | `not_started` | [governance.md](./packages/governance.md) |
| observability | `in_progress` | [observability.md](./packages/observability.md) |
| apps/harness | `in_progress` | [apps-harness.md](./packages/apps-harness.md) — P8b bootstrap 完成 |

## 3. Adapter 状态

| 单元 | 状态 | 进展页 |
| --- | --- | --- |
| persistence | `in_progress`（memory + postgres） | [persistence.md](./adapters/persistence.md) — P8a L2 §2.3 全绿 |
| queue | `in_progress`（memory） | [queue.md](./adapters/queue.md) |
| lease | `in_progress`（memory） | [lease.md](./adapters/lease.md) |
| model | `in_progress`（stub） | [model.md](./adapters/model.md) |
| workspace | `in_progress`（memory） | [workspace.md](./adapters/workspace.md) |
| objectstore | `not_started` | [objectstore.md](./adapters/objectstore.md) |
| knowledge | `not_started` | [knowledge.md](./adapters/knowledge.md) |
| secret | `not_started` | [secret.md](./adapters/secret.md) |
| sandbox-stub | `not_started` | [sandbox-stub.md](./adapters/sandbox-stub.md) |
| synthetic-sink | `in_progress` | [synthetic-sink.md](./adapters/synthetic-sink.md) |

## 4. 阻塞与风险

| 项 | 级别 | 说明 |
| --- | --- | --- |
| EDR-007 HTTP/SSE | 低 | Deferred → P8c 实装前 Accept（推荐 Hono） |
| L2 真实 PG | 信息 | P8a 已通（Docker；12 测含 recovery / prepared） |
| ConfirmationGrant | 信息 | P5 未做 confirm_once；Policy require_approval 主路径已通 |
| 实现体量大 | 信息 | 严格按阶段切分 |

## 5. 决策关闭记录

| 日期 | EDR | 结果 | 备注 |
| --- | --- | --- | --- |
| 2026-08-27 | EDR-005 | Accepted | PostgreSQL 单库 |
| 2026-08-27 | EDR-006 | Accepted | `runs` 行 `FOR UPDATE` |
| 2026-08-27 | EDR-008 | Accepted | Zod |
| 2026-08-27 | EDR-009 | Accepted | drizzle-orm |
| 2026-08-27 | — | CommitPlan → ports | |
| 2026-08-27 | — | LeasePort.bind | |

## 6. 测试 readiness

| 层 | 状态 | 备注 |
| --- | --- | --- |
| L0 纯函数 | `in_progress` | Event 排序；Policy；Reducer |
| L1 InMemory | `in_progress` | CreateRun→running；execute_turn；tool chain；approval；recovery replay |
| L2 真实单库 | `done`（P8a） | Docker `postgres:16`；engineering/05 §2.3 全场景 12/12 |
| L3 Eval / Golden | `in_progress` | Golden 6×5=30 已接线（100% 本机）；安全/恢复/审批/幂等完整矩阵待扩展 |

## 7. 快捷链接

- 交接：[HANDOFF.md](./HANDOFF.md)
- 阶段：[PHASES.md](./PHASES.md)（含 P8）
- 工程 EDR：[../engineering/00-implementation-baseline.md](../engineering/00-implementation-baseline.md)
