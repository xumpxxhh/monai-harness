# 进展：packages/delivery

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/delivery/` |
| 状态 | `in_progress`（P5：approval-chain L1） |
| 首触阶段 | P2 |
| 上游 | [engineering/02](../../engineering/02-runtime-composition.md)、[engineering/03](../../engineering/03-persistence-and-transactions.md)、EDR-004 |
| 最后更新 | 2026-08-27 |

## 1. 范围

- Outbox Dispatcher（claim / publish / mark）
- Scheduler（并发限额骨架、发 HarnessCommand）
- 补偿扫描（created 未 queued、outbox 未 published）
- ToolDispatcher（dispatch_tool → invoke → tool_dispatch_result / reconcile）
- 只依赖 runtime 的命令入口与 ports，不写 State

## 2. 非目标

- 实现 Reducer
- 跳过 QueuePort 语义的「直接回调 Engine」若未保留至少一次与去重测试

## 3. 验收清单

- [x] Dispatcher 不改变 Run 状态真相（queue 路径）
- [x] 发布载荷含 `runId + revision`（+ dedupeKey）
- [x] 双 publish / 双消费测试通过（L1）
- [x] 补偿扫描不创建新 Run
- [x] ToolDispatcher：prepared→dispatch→terminal / unknown+reconcile（L1）
- [x] 审批链 L1：awaiting_approval → queued → resume consume+prepared（P5）

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| ports（Outbox/Queue/Lease） | |
| runtime（Engine.handle / ToolInvoker） | |
| queue / lease / workspace / synthetic adapters | memory |

## 5. 缺口与风险

- 租户公平与并发限额仍为骨架
- 真实外部 Queue 未接

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | P5：approval-chain L1（synthetic 默认 require_approval + ask_user） |
| 2026-08-27 | P4：ToolDispatcher + tool-chain L1；Outbox 跳过非 queue_run |
| 2026-08-27 | P2：OutboxDispatcher / Scheduler / CompensationScanner + L1 闭环测试 |
| 2026-08-27 | P0：空包 stub |
| 2026-08-27 | 创建进展页 |
