# 进展：packages/api

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/api/` |
| 状态 | `done`（P8c HTTP/SSE） |
| 首触阶段 | P2（CreateRun/查询最小集）；P5（审批/输入）；P7（EventStream）；**P8c（HTTP/SSE）** |
| 上游 | [engineering/02](../../engineering/02-runtime-composition.md)、EDR-007/012 |
| 最后更新 | 2026-08-27（P8d：P8 收尾） |

## 1. 范围

- 鉴权后构造 `HarnessCommand`
- CreateRun、查询 Run/State/Event、审批决定、输入、pause/resume/cancel
- Event 订阅视图（P8c 先 SSE；WS/轮询后置）
- 只读路径；无 Tool 调用、无 sequence 分配

**P8c — HTTP + SSE**（EDR-007 **Accepted：Hono**）：

- 所有写经 `Engine.handle(command)`；api **不得** Persistence 直写
- 模块：`http/create-app.ts`、`http-error-map.ts`、`event-stream.ts`（`Last-Event-ID` ↔ `fromSequence`）
- REST 最小路由：见验收清单勾选

## 2. 非目标

- 同步专用状态机
- 直接 Persistence 写 Run
- 客户端超时自动 cancel（须显式 cancel 命令）

## 3. 验收清单

- [x] CreateRun 命令构造（`buildCreateRunCommand`）
- [x] `buildApprovalDecisionCommand` / `buildSubmitInputCommand`（P5）
- [x] 所有写操作经 Engine.handle（P8c HTTP handler）
- [x] CreateRun 幂等键透传（`Idempotency-Key` → `commandId`）
- [x] 错误 category → HTTP 映射表（`http-error-map.ts`）
- [x] EventStream 仅读已提交 Event（`subscribeRunEvents` / `liveSubscribeRunEvents`）
- [x] 无 persistence 写依赖
- [x] REST 最小路由（§1 表）
- [x] SSE `/v1/runs/:runId/events/stream`
- [x] EDR-007 Accepted（Hono；engineering/00 + STATUS）

**P8c 退出**：集成测试 CreateRun + SSE 收到 `run.created → run.queued → …` — **已验证**（`http-sse.test.ts` 2/2）。

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| runtime、ports、contracts、**hono** | EDR-007 |
| `@hono/node-server` | 仅 apps/harness 装配 |

## 5. 缺口与风险

- 鉴权仅为头透传（`X-Tenant-Id` / `X-Principal-Id`），无真实 AuthN
- HTTP 集成测依赖 delivery（单向；delivery 不得再依赖 api，以免 turbo 环）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | 拆除 delivery→api 依赖，消除 turbo `@monai/api`↔`@monai/delivery` 环 |
| 2026-08-27 | P8d：标记 api P8 范围 `done` |
| 2026-08-27 | P8c：Hono REST/SSE、`http-error-map`、pause/resume/cancel 命令接线 |
| 2026-08-27 | P8c：HTTP/SSE 计划写入本页（自 P8-HTTP-PG 归并） |
| 2026-08-27 | P7：`subscribeRunEvents` 只读 sequence 订阅 |
| 2026-08-27 | P5：approval_decision / submit_input 命令构造 |
| 2026-08-27 | P2：`buildCreateRunCommand` |
| 2026-08-27 | P0：空包 stub |
| 2026-08-27 | 创建进展页 |
