# 0003 — P2 CreateRun → running 闭环

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P2 → `done` |
| HANDOFF 已更新 | 是 |

## 目标

打通 create_run → outbox → queue → queue_run → acquire_lease → running，含双投递去重与补偿扫描。

## 改动

- ports：`QueueMessage` / `LeaseRecord`；LeasePort.bind
- `@monai/queue-memory`、`@monai/lease-memory`
- runtime：`Engine`（create_run / queue_run / acquire_lease）
- delivery：OutboxDispatcher / Scheduler / CompensationScanner
- api：`buildCreateRunCommand`
- persistence-memory：listRunsByStatus / requeueOutbox
- L1：`delivery` 闭环三测

## 验证

- [x] `pnpm build` / `check-types`
- [x] `pnpm --filter @monai/delivery test`（3）
- [x] runtime / persistence-memory 既有测试仍通过

## 未完成

- P3 light / execute_turn
- HTTP（EDR-007）
- 真实 PG L2
