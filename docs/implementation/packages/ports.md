# 进展：packages/ports

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/ports/` |
| 状态 | `in_progress`（P6：getStateSnapshot） |
| 首触阶段 | P0–P1 |
| 上游 | [engineering/02](../../engineering/02-runtime-composition.md)、[engineering/04](../../engineering/04-ports-extensions-and-security.md)、设计 02 §7 |
| 最后更新 | 2026-08-27 |

## 1. 范围

- PersistencePort / OutboxPort / QueuePort / LeasePort / ModelPort / … 接口
- **CommitPlan / CommitResult / HarnessCommand**（锁定在本包）
- 无具体客户端、无副作用实现

## 2. 非目标

- Adapter 实现
- Engine 编排逻辑

## 3. 验收清单

- [x] 包仅依赖 `contracts`
- [x] Persistence `beginUnitOfWork` + commit 形状与 [engineering/03](../../engineering/03-persistence-and-transactions.md) 一致
- [x] Queue/Lease/Outbox 方法集：Outbox 已具 claim/mark；Queue/Lease 为 stub 签名（P2 兑现）
- [x] SandboxPort 接口存在且标明 MVP 不挂载执行
- [x] Persistence getStateSnapshot（P6 recovery）

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| contracts | 类型 |
| CommitPlan | **本包**（与 [contracts](./contracts.md) 互链） |

## 5. 缺口与风险

- ApprovalPort 仍为 stub（决定经 Engine `approval_decision` 命令）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | P6：`PersistencePort.getStateSnapshot` |
| 2026-08-27 | P5：CommitPlan 审批/检查点类型；Persistence getApproval/Checkpoint/Continuation |
| 2026-08-27 | P4：getToolCall / listToolCalls；CommitPlan.toolCalls |
| 2026-08-27 | P3：`PersistencePort.getState`；CommitPlan.state → RunState |
| 2026-08-27 | P1：CommitPlan/HarnessCommand/Persistence/Outbox + stub ports |
| 2026-08-27 | 创建进展页 |
