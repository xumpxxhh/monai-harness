# 进展：packages/ports

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/ports/` |
| 状态 | `in_progress`（P6；**M1 ModelPort / SecretPort 接线**） |
| 首触阶段 | P0–P1；M1 SecretPort |
| 上游 | [engineering/02](../../engineering/02-runtime-composition.md)、[engineering/04](../../engineering/04-ports-extensions-and-security.md)、[design/02 §7](../../design/02-core-architecture.md#7-端口清单) |
| 最后更新 | 2026-08-28 |

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

### M1（计划 — [0018](../sessions/0018-real-model-cluster-plan.md)）

- [ ] `ModelPort.completeStructured` 签名确认 `modelPolicy` 必传
- [ ] `SecretPort` 接口 + lease 形状（M1e）；ExecutionContext 接线
- [ ] harness bootstrap 注入 SecretPort → Model adapter

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| contracts | 类型 |
| CommitPlan | **本包**（与 [contracts](./contracts.md) 互链） |

## 5. 缺口与风险

- ApprovalPort 仍为 stub（决定经 Engine `approval_decision` 命令）
- **SecretPort 未实现**；ModelPort 当前无凭证注入路径
- Engine 调用 ModelPort 时未传 modelPolicy（runtime M1d）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-28 | M1：ModelPort modelPolicy + SecretPort lease 接线备注；见 0018 |
| 2026-08-27 | P6：`PersistencePort.getStateSnapshot` |
| 2026-08-27 | P5：CommitPlan 审批/检查点类型；Persistence getApproval/Checkpoint/Continuation |
| 2026-08-27 | P4：getToolCall / listToolCalls；CommitPlan.toolCalls |
| 2026-08-27 | P3：`PersistencePort.getState`；CommitPlan.state → RunState |
| 2026-08-27 | P1：CommitPlan/HarnessCommand/Persistence/Outbox + stub ports |
| 2026-08-27 | 创建进展页 |
