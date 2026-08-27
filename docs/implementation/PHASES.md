# 实现阶段路线（P0–P8）

对齐 [engineering/05 §6](../engineering/05-testing-and-evolution.md#6-建议实现顺序仅规划)，并增加 **P0 建仓**。每阶段退出必须带上对应测试层，禁止「假闭环」。

## 总览

| 阶段 | 名称 | 状态 | 主要包 |
| --- | --- | --- | --- |
| P0 | Monorepo 骨架与工具链 | `done` | tooling、apps/harness 空壳 |
| P1 | contracts + ports + Persistence UoW + Event append | `done` | contracts、ports、persistence-memory、runtime(commit) |
| P2 | Outbox + 内联 Queue + Scheduler + CreateRun→running | `done` | delivery、queue-memory、lease-memory、api(命令)、runtime(Engine) |
| P3 | light 循环 + Model stub + Policy + Fact/Reducer | `done` | runtime、model adapter、pack-sdk |
| P4 | Tool prepared/dispatch/unknown/reconcile + synthetic | `done` | runtime/execution、synthetic-sink、workspace-generic |
| P5 | Approval + ask_user + Checkpoint/Continuation | `done` | runtime、api、governance(最小) |
| P6 | Recovery + L1/L2 故障注入 | `done` | runtime、persistence、test fixtures |
| P7 | EventStream + 指标 + Golden/Eval 接线 | `done` | api、observability、apps/harness、eval fixtures |
| P8 | HTTP API + PostgreSQL Persistence | `done` | persistence-postgres、api(http/sse)、apps/harness(bootstrap) |

阶段依赖：严格 `P0 → P1 → … → P7 → P8` 主链；P8 与 Eval 完整矩阵并列可选。治理/观测不得提前获得 Run 写权。

## P0 — Monorepo 骨架

**目标**：pnpm + Turborepo + TS 根配置；空包可 `build`/`check-types`。

**退出条件**：

- [x] 根 `package.json` / `pnpm-workspace.yaml` / `turbo.json` 符合 [turborepo.md](../turborepo.md)
- [x] `packages/contracts|ports|runtime` 等空包或最小 stub 可被 turbo 调度
- [x] `apps/harness` 可启动占位进程（不必有业务）
- [x] 架构依赖约束方式已选定（eslint boundaries / dependency-cruiser 等，可先文档化后启用）

**非目标**：业务逻辑、真实 DB。

## P1 — 契约、端口、UoW、Event

**目标**：CommitPlan / Event append / revision+leaseEpoch 校验骨架。

**退出条件**：

- [x] contracts 覆盖 01 核心对象的 TS 类型（可迭代；P1 已含 Run/Event/Records/Error）
- [x] ports 暴露 Persistence/Outbox/… 接口
- [x] persistence 适配器能同 UoW 写 Event + Run + Outbox（`persistence-memory`）
- [x] L0：Event 排序与 revision 冲突单测
- [x] EDR-005/006 至少变为 Accepted 或显式记录偏差

## P2 — 投递闭环 CreateRun→running

**退出条件**：

- [x] `create_run` → outbox → queue → `queue_run` → `acquire_lease` → `running`
- [x] 严格 `created → queued → running` Event
- [x] 补偿扫描可重建 `{runId,revision}` 信号
- [x] L1：双投递去重；L2：CreateRun 原子性（若已接真实库）— L2 延后，L1 已覆盖

## P3 — light 决策环

**退出条件**：

- [x] Pre/PostReasoning Hook 点可调用
- [x] ContextBuilder + ModelPort stub → Action
- [x] Policy allow/deny/require_approval + `policy.evaluated`
- [x] Observation → Fact → Reducer → State（只读工具路径可先通）
- [x] L0：Reducer / Policy 确定性单测

## P4 — 副作用 Tool 链

**退出条件**：

- [x] prepared-before-dispatch + 同键幂等
- [x] outcome_unknown + reconcile
- [x] workspace.* 与 artifact.* MVP 工具
- [x] synthetic.write_high + reconcile（隔离 sink）
- [x] L1/L2：超时未知、禁止新幂等键盲重试 — L1 已覆盖；L2 延后

## P5 — 等待态

**退出条件**：

- [x] ApprovalRecord 单次消费与 prepared 同 UoW
- [x] 等待只唤醒到 `queued`
- [x] ask_user 输入 Schema + Continuation
- [x] Checkpoint 绑定 revision/sequence/state hash/cursor
- [x] 审批生命周期套件可跑通主路径

## P6 — 恢复

**退出条件**：

- [x] 无 Checkpoint 全量 replay 与有 Checkpoint 加速 hash 一致
- [x] stale lease 迟到结果走对账（`lease_lost` + `yieldStaleRunningRun`）
- [x] 08 恢复故障注入套件达到可统计次数（L1 子集；完整矩阵可 P7 前扩展）

## P7 — 观测与评测门禁

**退出条件**：

- [x] EventStream 按 sequence 订阅
- [x] 07 核心指标可从 Event 重算（MVP 子集；缺口见 `MVP_METRIC_GAPS`）
- [x] Golden / 审批 / 幂等套件接线（Golden 主路径 6×5=30 @ 90%；审批/幂等仍为子集）

## P8 — HTTP + PostgreSQL

**目标**：L2 真实单库 + 可部署 Harness + HTTP/SSE 接入（关闭 EDR-007）。

**上游**：[engineering/02](../engineering/02-runtime-composition.md)、[engineering/03](../engineering/03-persistence-and-transactions.md)、[engineering/05 §2.3](../engineering/05-testing-and-evolution.md#23-l2-真实单库集成)。

**建议顺序**（PG 优先；P8 退出以 PG L2 通过为准）：

```text
P8a  persistence-postgres  →  [adapters/persistence.md](./adapters/persistence.md)
  ↓
P8b  harness bootstrap     →  [packages/apps-harness.md](./packages/apps-harness.md)
  ↓
P8c  HTTP + SSE            →  [packages/api.md](./packages/api.md)
  ↓
P8d  文档 / STATUS 同步；可选 PG 上 Golden 6×5 回归
```

**子阶段**：

| 子阶段 | 焦点 | 进展页 |
| --- | --- | --- |
| P8a | `@monai/persistence-postgres`：drizzle schema、UoW、L2 单测 | [adapters/persistence.md](./adapters/persistence.md) |
| P8b | bootstrap DI、`PERSISTENCE_DRIVER`、delivery 循环 | [packages/apps-harness.md](./packages/apps-harness.md) |
| P8c | REST 路由、错误映射、SSE EventStream | [packages/api.md](./packages/api.md) |
| P8d | HANDOFF/STATUS/包页勾选；EDR-007 关闭 | 本页 + [HANDOFF.md](./HANDOFF.md) |

**第一刀**：建 `packages/adapters/persistence-postgres` → drizzle schema（`runs`/`events`/`outbox`/`idempotency`）→ `UoW-CreateRun` → L2 CreateRun 原子性 + sequence。

**退出条件**：

- [x] `@monai/persistence-postgres` 实现 Persistence/Outbox/Idempotency，行为等价 memory（L2 主路径子集）
- [x] L2：[engineering/05 §2.3](../engineering/05-testing-and-evolution.md#23-l2-真实单库集成) 场景全绿（含 recovery / prepared-before-dispatch）
- [x] harness：PG 上 CreateRun → running → `execute_turn` 端到端
- [x] HTTP：REST 写经 `Engine.handle`；读经 PersistencePort 只读
- [x] SSE：`/v1/runs/:runId/events/stream` 推送已 commit Event
- [x] EDR-007 Accepted；category → HTTP 映射表落地
- [x] `.env.example` 含 `DATABASE_URL`、`PERSISTENCE_DRIVER`、`PORT`

**非目标**：Eval 完整矩阵、ConfirmationGrant、拆多进程、真实 ObjectStore。

**与 Eval 矩阵**：P8 与「安全 8×1 / 恢复 8×5 / 审批·幂等完整矩阵」并列可选；Eval 完整矩阵与 **PG 上 Golden 6×5** 延后为 P8 之后可选工作（P8d 未强制）。

**P8d（2026-08-27）**：文档/STATUS 同步完成；回归：postgres L2 12/12、api HTTP/SSE 2/2、delivery 10/10、harness memory（含 Golden 30/30）+ postgres demo。

## 阶段与测试层映射

| 阶段 | 最低测试层 |
| --- | --- |
| P0 | `check-types` / 空 build |
| P1 | L0 + 部分 L1 |
| P2 | L1 双投递；争取 L2 |
| P3–P5 | L0 + L1 |
| P6 | L1 + L2 故障注入 |
| P7 | L3 Eval 接线 |
| P8 | L2 真实单库 + HTTP 集成 |

详见 [engineering/05](../engineering/05-testing-and-evolution.md)。
