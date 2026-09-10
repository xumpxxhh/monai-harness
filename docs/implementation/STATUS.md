# 实现状态看板

> 与各 [packages/](./packages/) / [adapters/](./adapters/) 进展页同步。不一致时：**先修包页到与代码一致，再改本表**（见 [CONVENTIONS.md](./CONVENTIONS.md)）。  
> 最后同步：2026-09-08（**0026** session resume + context 增量压缩；implementation 文档纠错）

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
| [M1](./PHASES.md#m1--真实模型簇可选) | `done` | M1a–M1h；Token/cost 已收口；KnowledgePort deferred |
| [M2](./PHASES.md#m2--agent-loop-增强) | `done` | function calling + 并行工具 + Dialogue Context + Session Demo |
| [M3](./PHASES.md#m3--rag-knowledge-search-tool) | `done` | EDR-016：`knowledge_search`；KnowledgePort 仍 deferred |
| [可替换 infra](./PHASES.md#可替换-infra-适配器queue--lease--objectstore--sandbox) | `done` | Queue/Lease/ObjectStore + sandbox stub；artifact 已接；subprocess opt-in（0025） |

## 2. 包状态

| 单元 | 状态 | 进展页 |
| --- | --- | --- |
| tooling / 仓库根 | `done`（P0） | [tooling.md](./packages/tooling.md) |
| contracts | `done`（M2a） | [contracts.md](./packages/contracts.md) — Action.calls[] / DialogueTurn |
| ports | `done`（M1e + M2b） | [ports.md](./packages/ports.md) — ModelDecision / SecretPort；Sandbox 默认拒绝+opt-in |
| runtime | `done`（M2 + 压缩增强） | [runtime.md](./packages/runtime.md) — 决策环 / 并行工具 / Context 投影与增量压缩 |
| delivery | `done`（M2c） | [delivery.md](./packages/delivery.md) — 多 ToolCall 派发 |
| api | `done`（P8c） | [api.md](./packages/api.md) |
| pack-sdk | `done`（P9a） | [pack-sdk.md](./packages/pack-sdk.md) |
| packs/workspace-generic | `done`（write/delete + RAG/sandbox 元数据） | [workspace-generic.md](./packages/workspace-generic.md) |
| governance | `done`（P9c） | [governance.md](./packages/governance.md) |
| observability | `done`（M1g） | [observability.md](./packages/observability.md) — Token/cost + Context 指标 |
| apps/harness | `done`（M2e + resume） | [apps-harness.md](./packages/apps-harness.md) — Session Demo / `--resume` / FsWorkspace |

## 3. Adapter 状态

| 单元 | 状态 | 进展页 |
| --- | --- | --- |
| persistence | `done`（P8a L2 + P9d L1-on-PG） | [persistence.md](./adapters/persistence.md) |
| queue | `done`（memory + postgres） | [queue.md](./adapters/queue.md) |
| lease | `done`（memory + postgres） | [lease.md](./adapters/lease.md) |
| model | `done`（stub + openai；M2b function calling） | [model.md](./adapters/model.md) |
| workspace | `done`（memory + harness FsWorkspace；Windows 矩阵缺口） | [workspace.md](./adapters/workspace.md) |
| objectstore | `done`（fs；artifact 已接） | [objectstore.md](./adapters/objectstore.md) |
| knowledge-http / `knowledge_search` | `done`（EDR-016） | [knowledge.md](./adapters/knowledge.md) |
| KnowledgePort / Context `knowledge` | `deferred` | [knowledge.md](./adapters/knowledge.md) |
| secret | `done`（`@monai/secret-env`；M1e） | [secret.md](./adapters/secret.md) |
| sandbox-stub | `done` | [sandbox-stub.md](./adapters/sandbox-stub.md) — 默认拒绝 |
| sandbox-subprocess | `done`（opt-in） | [sandbox-subprocess.md](./adapters/sandbox-subprocess.md) — 0025 |
| synthetic-sink | `done`（P4–P5） | [synthetic-sink.md](./adapters/synthetic-sink.md) |

## 4. 阻塞与风险

| 项 | 级别 | 说明 |
| --- | --- | --- |
| Eval 完整矩阵 | 信息 | 114/114 绿（stub） |
| KnowledgePort | 信息 | `deferred`；RAG Tool 已接 |
| ConfirmationGrant | 信息 | `deferred`；单次审批主路径已够 |
| EDR-010 | 低 | Deferred（isolated_extension） |
| sandbox_exec opt-in | 信息 | 默认关；Session 联调仍可做 |
| `project-dialogue` 未提交改动 | 信息 | 工作区有未收口微调；见 HANDOFF |

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
| 2026-09-02 | M2 | Accepted | function calling + Action.calls[] + Dialogue Context + Session Demo |
| 2026-09-02 | EDR-016 | Accepted | RAG HTTP → `knowledge_search` Tool；非 KnowledgePort |
| 2026-09-07 | EDR-014 | Accepted（澄清） | 默认禁用；`sandbox_exec` 可 opt-in（0025）；Eval 仍关 |

## 6. 测试 readiness

| 层 | 状态 | 备注 |
| --- | --- | --- |
| L0 纯函数 | `done`（M1b/c + M2） | BudgetGuard、Context Builder、Dialogue 投影/压缩、prepare-tool-calls、map-decision |
| L1 InMemory | `done`（M1d/f + M2c） | execute-turn 并行工具、OpenAiModelPort function calling |
| L1-on-PG | `done`（全 postgres queue/lease） | CreateRun→running 3/3 |
| L2 真实单库 | `done`（lease-postgres） | recovery + prepared 4/4；persistence 单测 8 |
| L3 Eval / Golden | `done`（P9b-sec） | Golden 30 + 控制面 76 + 安全 8 = 114 绿 |
| L0 governance | `done`（P9c） | GovernanceEvent store + Pack 注册 3/3 |
| M2 harness demo | `done` | `demo:session`；`--resume`（postgres）；`FsWorkspace` |

## 7. 快捷链接

- 交接：[HANDOFF.md](./HANDOFF.md)
- 阶段：[PHASES.md](./PHASES.md)（历史路线；已完成 = 快照）
- 约定：[CONVENTIONS.md](./CONVENTIONS.md)
- M1 计划（已归档）：[sessions/0018](./sessions/0018-real-model-cluster-plan.md)
- M2 归档：[sessions/0019](./sessions/0019-post-m1-agent-loop.md)
- M3 RAG Tool：[sessions/0020](./sessions/0020-knowledge-search-tool.md)
- 可替换 infra（已归档）：[sessions/0024](./sessions/0024-replaceable-infra-adapters-plan.md)
- sandbox_exec opt-in：[sessions/0025](./sessions/0025-sandbox-exec-opt-in.md)
- session resume + 压缩：[sessions/0026](./sessions/0026-context-compress-session-resume.md)
- 工程 EDR：[../engineering/00-implementation-baseline.md](../engineering/00-implementation-baseline.md)
