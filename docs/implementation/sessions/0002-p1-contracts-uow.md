# 0002 — P1 contracts + ports + memory UoW

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P1 → `done` |
| HANDOFF 已更新 | 是 |

## 目标

落地 P1：核心契约、Persistence/Outbox 端口、内存 UoW、runtime commit/排序骨架与 L0 测试。

## 改动

- `@monai/contracts`：Run/Event/Error/Records + Zod `strictObject`
- `@monai/ports`：CommitPlan/HarnessCommand/Persistence/Outbox + stub ports（CommitPlan 锁定本包）
- `@monai/persistence-memory`：同 UoW Event+Run+Outbox；revision/lease 冲突映射
- `@monai/runtime`：`orderEventCandidates`、`applyCommit`
- workspace：`packages/adapters/*`；catalog：zod、vitest
- 进展文档 / HANDOFF / STATUS / PHASES

## 验证

- [x] `pnpm build` / `pnpm check-types`
- [x] `pnpm --filter @monai/runtime test`（排序）
- [x] `pnpm --filter @monai/persistence-memory test`（revision/sequence）

## 未完成

- P2 CreateRun→running 闭环
- 真实 PG + drizzle（L2）
- Engine.handle 全命令集
