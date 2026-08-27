# 进展：packages/api

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/api/` |
| 状态 | `in_progress`（P8c：HTTP/SSE） |
| 首触阶段 | P2（CreateRun/查询最小集）；P5（审批/输入）；P7（EventStream）；**P8c（HTTP/SSE）** |
| 上游 | [engineering/02](../../engineering/02-runtime-composition.md)、EDR-007/012 |
| 最后更新 | 2026-08-27（P8c 计划） |

## 1. 范围

- 鉴权后构造 `HarnessCommand`
- CreateRun、查询 Run/State/Event、审批决定、输入、pause/resume/cancel
- Event 订阅视图（P8c 先 SSE；WS/轮询后置）
- 只读路径；无 Tool 调用、无 sequence 分配

**P8c — HTTP + SSE**（实装前关闭 EDR-007；推荐 **Hono**）：

- 所有写经 `Engine.handle(command)`；api **不得** Persistence 直写
- 计划模块：`packages/api/src/http/`（路由 handler）、`http-error-map.ts`（category → HTTP status）、`sse/`（`Last-Event-ID` ↔ `fromSequence`）
- REST 最小路由：

| Method | Path | 映射 |
| --- | --- | --- |
| `POST` | `/v1/runs` | `create_run`（`Idempotency-Key` → `commandId`） |
| `GET` | `/v1/runs/:runId` | 只读 `getRun` |
| `GET` | `/v1/runs/:runId/state` | 只读 `getState` |
| `GET` | `/v1/runs/:runId/events` | 轮询；`?fromSequence=` |
| `GET` | `/v1/runs/:runId/events/stream` | SSE；包装 `subscribeRunEvents` |
| `POST` | `/v1/runs/:runId/approvals/:id/decision` | `approval_decision` |
| `POST` | `/v1/runs/:runId/input` | `submit_input` |
| `POST` | `/v1/runs/:runId/pause` | `pause_run` |
| `POST` | `/v1/runs/:runId/resume` | `resume_run` |
| `POST` | `/v1/runs/:runId/cancel` | `cancel_run` |

- SSE：只推送已 commit Event；推送失败不回滚 Run；断连凭 `Last-Event-ID` 续订

## 2. 非目标

- 同步专用状态机
- 直接 Persistence 写 Run
- 客户端超时自动 cancel（须显式 cancel 命令）

## 3. 验收清单

- [x] CreateRun 命令构造（`buildCreateRunCommand`，无 HTTP）
- [x] `buildApprovalDecisionCommand` / `buildSubmitInputCommand`（P5）
- [ ] 所有写操作经 Engine.handle（P8c HTTP handler）
- [ ] CreateRun 幂等键透传（`Idempotency-Key` → `commandId`）
- [ ] 错误 category → HTTP 映射表（`http-error-map.ts`）
- [x] EventStream 仅读已提交 Event（`subscribeRunEvents`）
- [x] 无 persistence 写依赖
- [ ] REST 最小路由（§1 表）
- [ ] SSE `/v1/runs/:runId/events/stream`
- [ ] EDR-007 Accepted（P8c 第一步；更新 engineering/00 + STATUS）

**P8c 退出**：集成测试 CreateRun + SSE 收到 `run.created → run.queued → …` 事件链。

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| runtime、ports、contracts | |
| EDR-007 | P8c 实装前 Accept（推荐 Hono） |

## 5. 缺口与风险

- 框架未定：P8c 计划 Hono；仍仅命令层
- HTTP server 装配在 [apps-harness.md](./apps-harness.md)（P8b/P8c）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | P8c：HTTP/SSE 计划写入本页（自 P8-HTTP-PG 归并） |
| 2026-08-27 | P7：`subscribeRunEvents` 只读 sequence 订阅 |
| 2026-08-27 | P5：approval_decision / submit_input 命令构造 |
| 2026-08-27 | P2：`buildCreateRunCommand` |
| 2026-08-27 | P0：空包 stub |
| 2026-08-27 | 创建进展页 |
