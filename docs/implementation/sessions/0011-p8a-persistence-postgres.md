# 0011 — P8a persistence-postgres

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P8a → 第一刀完成（L2 子集） |
| HANDOFF 已更新 | 是 |

## 目标

落地 `@monai/persistence-postgres`：drizzle schema、`FOR UPDATE` UoW、L2 CreateRun 原子性与相关冲突场景。

## 改动

- `packages/adapters/persistence-postgres`：schema / apply-schema / PostgresPersistence / Docker 测具
- L2：优先 `DATABASE_URL`，否则 `docker run --rm postgres:16`
- 去掉误加的 `embedded-postgres` 与相关 pnpm 构建例外
- 进展文档：persistence / HANDOFF / STATUS / PHASES

## 验证

- [x] `pnpm --filter @monai/persistence-postgres check-types`
- [x] `pnpm --filter @monai/persistence-postgres build`
- [x] `pnpm --filter @monai/persistence-postgres test`（8/8，Docker PG）

## 未完成

- L2：recovery State hash；prepared-before-dispatch
- L1 全套在 PG 上重跑
- P8b harness bootstrap
