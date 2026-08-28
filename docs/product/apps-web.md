# Web 操作台进展

| 项 | 值 |
| --- | --- |
| 路径 | `apps/web/` |
| 状态 | `in_progress`（首版控制台已接线） |
| 计划 | [web-console.md](./web-console.md) |
| 最后更新 | 2026-08-27 |

## 范围

- Vite + React 三栏控制台（Session/Run 列表、SSE 时间线、Inspector）
- `EventViewRegistry` / 等待态操作面板
- 依赖 harness `HARNESS_MODE=serve` + Vite proxy `/v1`
- **Turn**：`apps/harness` 的 `TurnDriver`（非内核 Scheduler）— serve 下 `HARNESS_AUTO_EXECUTE_TURN=true` 时自动 `execute_turn`；手动 `POST /v1/runs/:id/turn`（harness 专用路由）

## 联调

```powershell
# 终端 1：配置 apps/harness/.env（见 apps/harness/.env.example），然后
pnpm --filter harness start

# 终端 2：前端
pnpm --filter web dev
```

打开 http://localhost:5173

## API 依赖（harness 侧已补）

- `GET /v1/runs`（listRuns）
- `GET /v1/runs/:id/continuation`、`/approvals`（Inspector）
- CORS（`CORS_ORIGIN`）
