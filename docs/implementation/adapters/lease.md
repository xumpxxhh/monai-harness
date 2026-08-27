# 进展：adapters/lease

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/lease-*/` |
| 实现端口 | LeasePort |
| 状态 | `in_progress`（`lease-memory` done） |
| 首触阶段 | P2 |
| 上游 | [design/03 §3](../../design/03-run-lifecycle.md)、[engineering/03 §7](../../engineering/03-persistence-and-transactions.md)、EDR-006 |
| 最后更新 | 2026-08-27 |

## 1. 范围

- bind / heartbeat / validate / release（epoch 由 Engine CommitPlan 递增后 bind）
- heartbeat ≤ TTL/3；不递增 epoch

## 2. 非目标

- 把 lease 元数据当成 State 真相

## 3. 验收清单

- [x] stale owner 无法 heartbeat/validate 成功（内存实现校验 owner+epoch）
- [x] 与 Engine fencing 集成（P2 闭环测试）
- [ ] 多 worker 模拟下无双持有执行权（后置）

## 4. 依赖

ports；EDR-006。包：`@monai/lease-memory`。

## 5. 缺口与风险

- 与 persistence 同事务写入留到 PG 适配器

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | P2：`@monai/lease-memory`（bind 语义） |
| 2026-08-27 | 创建进展页 |
