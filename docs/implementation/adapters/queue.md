# 进展：adapters/queue

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/queue-*/`（MVP 可 DB/内存） |
| 实现端口 | QueuePort |
| 状态 | `done`（`queue-memory` + `queue-postgres`） |
| 首触阶段 | P2 |
| 上游 | [engineering/03 §6](../../engineering/03-persistence-and-transactions.md)、EDR-004 |
| 最后更新 | 2026-09-07 |

## 1. 范围

- enqueue / lease / ack / nack / 延迟可见
- 至少一次；载荷含 `runId + revision + dedupeKey`
- 可与 persistence 同库投影表实现

## 2. 非目标

- 充当 Run 真相
- 首日绑定 Redis（可后换，语义不变）

## 3. 验收清单

- [x] 双投递不导致双执行（配合 Engine；dedupeKey + expectedRevision）
- [x] nack/延迟重试可用（内存 nack→ready；PG nack→ready）
- [x] 换后端不改 delivery 业务代码（仅换 adapter）— `QUEUE_DRIVER` + `@monai/queue-postgres`

## 4. 依赖

ports；delivery。包：`@monai/queue-memory`、`@monai/queue-postgres`。

## 5. 缺口与风险

- PG 版尚未实现 delayed visibility / TTL 租约过期扫描（nack 立即可见）
- Redis/SQS 仍后置

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-09-07 | `@monai/queue-postgres`：同库投影 + SKIP LOCKED；harness `QUEUE_DRIVER` |
| 2026-09-07 | L1 CreateRun 套件改用 postgres queue（与 persistence/lease 同库） |
| 2026-09-07 | 计划归档：queue-postgres + 装配开关（0024） |
| 2026-08-27 | P2：`@monai/queue-memory` |
| 2026-08-27 | 创建进展页 |
