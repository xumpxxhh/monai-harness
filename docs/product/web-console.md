# Web 操作台计划（归档）

| 项 | 值 |
| --- | --- |
| 状态 | `archived`（计划已定稿）→ 实现见 [apps-web.md](./apps-web.md) |
| 归档日期 | 2026-08-27 |
| 隔离 | 属 [`docs/product`](./README.md)；**不**写入 `docs/implementation` 的 PHASES / HANDOFF 焦点 / STATUS 阶段表 |
| 实现 | 本轮及归档时点 **不写代码** |

> 恢复开工时：只读本页 + product README；与用户确认后再动 `apps/web` 与 API 缺口；内核交接仍以 [implementation/HANDOFF.md](../implementation/HANDOFF.md) 为准。

---

## 1. 决策（已拍板）

| 项 | 选择 |
| --- | --- |
| 产品形态 | **C：操作台** — 多 Run、Session 分组、主时间线 + 上下文面板；面向后续内核迭代可扩展 |
| 前端 | 新建 `apps/web`：Vite + React + TypeScript SPA |
| 后台 | **不新建 backend app**；`HARNESS_MODE=serve` 的 `apps/harness` 继续作为唯一 HTTP/SSE 入口 |
| 类型源 | 前端依赖 `@monai/contracts`；HTTP 与现有 `/v1` 对齐 |

```text
apps/web  --(/v1 proxy 或 CORS)-->  apps/harness (serve)
                                       |
                                  @monai/api (Hono)
                                       |
                              persistence memory | postgres
apps/web  -------- types -------->  @monai/contracts
```

---

## 2. 架构原则（可扩展）

1. **Event 驱动 UI**：`EventViewRegistry` 按 `eventType` 注册渲染器；未知类型走通用 JSON/信封视图。
2. **Status 驱动操作面**：`StatusActionRegistry` 挂载 `awaiting_approval` / `awaiting_input` / `paused` 等面板。
3. **按 feature 分目录**：`features/runs|sessions|timeline|actions|inspector`；壳只负责路由与三栏布局。
4. **薄 API 客户端**：`src/api/client.ts` 集中 REST/SSE；禁止散落 `fetch`、禁止直连 Persistence。
5. **首版不做真实 Auth**：继续透传 `X-Tenant-Id` / `X-Principal-Id`。

---

## 3. 后台缺口（实现时再做；非内核 P0–P8 范围）

当前无 Run 列表；`PersistencePort` 无 `listRuns`。Session 可由 Run.`sessionId` 聚合，不必先建 Session 资源。

| # | 项 | 说明 |
| --- | --- | --- |
| 1 | Ports | `listRuns({ tenantId, sessionId?, limit?, status? })` |
| 2 | Adapters | `persistence-memory` + `persistence-postgres` |
| 3 | HTTP | `GET /v1/runs?...` → `{ ok, runs }`（只读） |
| 4 | CORS | `createHttpApp` + 可选 `CORS_ORIGIN` |
| 5 | 联调 | Vite proxy `/v1` → `127.0.0.1:3000`；CORS 作分离部署兜底 |

---

## 4. 前端信息架构（首版）

- **左**：Session（按 `sessionId` 分组）→ Run 列表（status 色标）
- **中**：Create Run + 选中 Run 的 SSE 时间线（`EventSource` / `Last-Event-ID`）
- **右**：Inspector — Run 摘要、State、审批/input、pause·resume·cancel

闭环对齐现有路由：`POST /v1/runs`、events stream、approvals decision、input、pause/resume/cancel。

---

## 5. 建议落地步骤（将来开工用）

1. Monorepo 接入 `apps/web`（Vite、proxy、turbo scripts）
2. `listRuns` + CORS（ports → adapters → api）
3. 三栏壳 + 注册表 + 主路径交互
4. 进展只记在 **本目录**（例如后续可加 `docs/product/apps-web.md`）；**不要**把 HANDOFF「当前焦点」改成 UI，除非用户明确把产品轨设为当前会话主题

**首版非目标**：真实登录、多租户切换 UI、Eval 面板、DAG/Child Run 可视化、harness 同域托管静态资源。

---

## 6. 扩展点（内核往后长时）

| 内核新增 | 前端接法 |
| --- | --- |
| 新 `eventType` | `EventViewRegistry`；Generic 已可见 |
| 新 status / 等待态 | `StatusActionRegistry` + 对应 POST |
| 新只读资源 | `api/client` + Inspector tab |
| 新写命令 | 只调 `/v1/...` |

---

## 7. 风险

- 列表 API 是形态 C 的前置。
- 联调必须 `HARNESS_MODE=serve`（默认 `demo` 会退出）。
- SSE + Vite proxy 若卡顿再查缓冲/头；前端不发明第二套状态机。

---

## 8. 与 Cursor 计划文件

对应会话计划稿：`web_console_scaffold`（Cursor plans）。以**本页**为仓库内权威归档；实现前勿在内核 STATUS 中标记本主题为 `in_progress`。
