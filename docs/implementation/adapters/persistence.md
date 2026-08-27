# 进展：adapters/persistence

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/persistence-*/` |
| 实现端口 | PersistencePort、OutboxPort（同 UoW）、Idempotency（可并入） |
| 状态 | `done`（P8a：memory + postgres L2 §2.3；L1-on-PG 仍可选） |
| 首触阶段 | P1；**P8a** persistence-postgres |
| 上游 | [engineering/03](../../engineering/03-persistence-and-transactions.md)、EDR-003/005/006/009 |
| 最后更新 | 2026-08-27（P8d：P8 收尾） |

## 1. 范围

- UnitOfWork：Event append、Run/State/投影、Outbox、Idempotency 同连接提交
- Run 级互斥（`FOR UPDATE` — EDR-006；内存用 per-run mutex 模拟）
- 加载聚合与按 sequence 读取
- 测试可用内存实现，但 L2 必须真实库路径

**P8a — `@monai/persistence-postgres`**（路径 `packages/adapters/persistence-postgres`）：

- 实现 `PersistencePort` + `OutboxPort` + `IdempotencyPort`（与 memory 三合一）
- 依赖：`drizzle-orm`、`pg`；EDR-009，事务边界仅在 adapter
- drizzle schema 最小表族（对齐 [engineering/03 §2.1](../../engineering/03-persistence-and-transactions.md#21-单库表族acceptedpostgresql)）：`runs`、`events`、`run_state`、`tool_calls`、`approvals`、`checkpoints`、`continuations`、`state_snapshots`、`outbox`、`idempotency`（lease 仍由 `lease-memory`）
- UoW：`BEGIN` → `SELECT runs … FOR UPDATE` → 校验 revision/leaseEpoch → 分配 sequence → INSERT events + UPSERT 投影 + outbox/idempotency → `revision++` → `COMMIT`
- 冲突：`revision` 不匹配 → `conflict`；lease 失效 → `lease_lost`；幂等同键异摘要 → `conflict`
- L2 测试：连接根目录 `docker-compose.yml` 的固定服务 `postgres`（`DATABASE_URL` 或默认 `127.0.0.1:54329`）；**不**在测试里 docker run/rm

## 2. 非目标

- 领域状态机
- 跨事务持有 Model/Tool 调用
- Artifact 正文、Secret、GovernanceEvent、Evaluation 进 Run 真相库（见 engineering/03 §2.2）

## 3. 验收清单

- [x] CreateRun 原子性（内存：失败无脏数据 / revision 冲突不写入）
- [x] revision 冲突 → `conflict`；lease 失效 → `lease_lost`
- [x] sequence 连续唯一
- [x] Outbox 事务内 insert + 事务外 claim（内存）
- [x] EDR-005/006/009 已 Accepted
- [x] Checkpoint 提交时写入 stateRef 快照（P6 recovery）
- [x] `@monai/persistence-postgres` 包（P8a）
- [x] drizzle schema + `FOR UPDATE` UoW
- [x] L2 单测（vitest + Docker `postgres:16` 或 `DATABASE_URL`），对齐 [engineering/05 §2.3](../../engineering/05-testing-and-evolution.md#23-l2-真实单库集成)：
  - [x] CreateRun 原子性（失败无 Run/Event/脏 Outbox）
  - [x] Outbox claim 并发唯一
  - [x] revision 冲突
  - [x] leaseEpoch fencing → `lease_lost`
  - [x] sequence 连续无洞
  - [x] Idempotency 同键异摘要 → `conflict`
  - [x] 恢复：无/有 Checkpoint replay 后 State hash 一致
  - [x] prepared-before-dispatch
- [ ] 现有 L1 用例在 PG 上全绿（可选；不挡 P8b）

**P8a**：schema → UoW → L2 §2.3 全场景 — **已完成**（12 测）。

## 4. 依赖

contracts/ports；`@monai/persistence-memory`（参考）；`@monai/persistence-postgres`（本阶段）。

## 5. 缺口与风险

- L1 全套尚未在 PG 上重跑（可选）
- L2 依赖本机固定 Compose PG：`pnpm db:up`（`docker-compose.yml` → `monai-harness-postgres`）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | P8d：标记 persistence P8 范围 `done`（L1-on-PG 仍可选） |
| 2026-08-27 | P8a 收尾：L2 recovery State hash + prepared-before-dispatch（12/12） |
| 2026-08-27 | P8a：`persistence-postgres` + Docker L2（8 测绿）；去掉 embedded-postgres |
| 2026-08-27 | P8a：postgres 计划写入本页（自 P8-HTTP-PG 归并） |
| 2026-08-27 | P6：`getStateSnapshot(stateRef)`；Checkpoint 时存 state 快照 |
| 2026-08-27 | P5：Approval/Checkpoint/Continuation 持久化；commit 戳 revision/sequence |
| 2026-08-27 | P4：ToolCallRecord 持久化 |
| 2026-08-27 | P3：`getState` + CommitPlan.state 持久化 |
| 2026-08-27 | P2：listRunsByStatus / requeueOutbox 供补偿 |
| 2026-08-27 | P1：新增 `@monai/persistence-memory` + L0 revision/sequence 测试 |
| 2026-08-27 | 创建进展页 |
