# 0013 — P8b harness bootstrap

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P8b → 完成 |
| HANDOFF 已更新 | 是 |

## 目标

Harness bootstrap：`PERSISTENCE_DRIVER`、delivery 循环、`.env.example`、PG CreateRun→`execute_turn`。

## 改动

- `apps/harness/src/`：`config` / `bootstrap` / `loops` / `demo` / `index`
- `packages/delivery`：`CompensationScanner` 支持 async store（Postgres）
- 根 `.env.example`、`turbo.json` `globalPassThroughEnv`
- 进展文档：apps-harness / HANDOFF / STATUS / PHASES

## 验证

- [x] `pnpm --filter harness build`
- [x] `pnpm --filter @monai/delivery test`（10/10）
- [x] memory demo：CreateRun→running→execute_turn
- [x] postgres demo：同上（Compose PG）

## 未完成

- P8c HTTP + SSE（EDR-007）
- 角色独立开关
