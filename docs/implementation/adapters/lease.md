# 进展：adapters/lease

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/lease-*/` |
| 实现端口 | LeasePort |
| 状态 | `done`（`lease-memory` + `lease-postgres`） |
| 首触阶段 | P2 |
| 上游 | [design/03 §3](../../design/03-run-lifecycle.md)、[engineering/03 §7](../../engineering/03-persistence-and-transactions.md)、EDR-006 |
| 最后更新 | 2026-09-07 |

## 1. 范围

- bind / heartbeat / validate / release（epoch 由 Engine CommitPlan 递增后 bind）
- heartbeat ≤ TTL/3；不递增 epoch

## 2. 非目标

- 把 lease 元数据当成 State 真相

## 3. 验收清单

- [x] stale owner 无法 heartbeat/validate 成功（memory + postgres）
- [x] 与 Engine fencing 集成（P2 闭环测试；PG adapter 单测覆盖 owner/epoch）
- [x] 多 worker 模拟下无双持有执行权（postgres：bind 换 epoch 后旧 owner validate 失败）

## 4. 依赖

ports；EDR-006。包：`@monai/lease-memory`、`@monai/lease-postgres`。

## 5. 缺口与风险

- Lease 行与 Persistence `runs.lease_epoch` 仍分表；不在同一 DB 事务内写（与 memory 语义一致）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-09-07 | L2 recovery/prepared 场景改用 `lease-postgres` |
| 2026-09-07 | `@monai/lease-postgres`：`run_leases` 表；harness `LEASE_DRIVER` |
| 2026-09-07 | L1 CreateRun 套件改用 postgres lease（与 persistence/queue 同库） |
| 2026-09-07 | 计划归档：lease-postgres + 装配开关（0024） |
| 2026-08-27 | P2：`@monai/lease-memory`（bind 语义） |
| 2026-08-27 | 创建进展页 |
