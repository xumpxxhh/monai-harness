# 0014 — P8c HTTP + SSE (Hono)

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P8c → 完成 |
| HANDOFF 已更新 | 是 |

## 目标

Accept EDR-007（Hono）；落地 REST + SSE；harness serve 挂载 HTTP。

## 改动

- EDR-007 → Accepted（engineering/00、STATUS、CONVENTIONS）
- `packages/api`：`createHttpApp`、`http-error-map`、live SSE、`control-commands`
- `packages/runtime`：`pause_run` / `resume_run` / `cancel_run`
- `apps/harness`：`http-server.ts`；serve 模式起 HTTP
- 测试：`http-sse.test.ts` 2/2

## 验证

- [x] `pnpm --filter @monai/runtime build`
- [x] `pnpm --filter @monai/api build` + `test`（2/2）
- [x] `pnpm --filter harness build`

## 未完成

- P8d 文档收尾 / 可选 PG Golden
- 角色独立开关
