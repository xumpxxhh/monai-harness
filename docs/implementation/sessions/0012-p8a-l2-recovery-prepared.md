# 0012 — P8a L2 recovery + prepared

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P8a → 完成（L2 §2.3 全绿） |
| HANDOFF 已更新 | 是 |

## 目标

补齐 engineering/05 §2.3 剩余两项：recovery State hash、prepared-before-dispatch。

## 改动

- `packages/adapters/persistence-postgres/src/postgres-l2-scenarios.test.ts`：4 个 L2 场景
- `package.json`：devDependencies 增加 runtime / lease-memory / model-stub / synthetic-sink
- 进展文档：persistence / HANDOFF / STATUS / PHASES

## 验证

- [x] `pnpm --filter @monai/persistence-postgres test`（12/12，Compose PG）

## 未完成

- L1 全套在 PG 上重跑（可选）
- P8b harness bootstrap
