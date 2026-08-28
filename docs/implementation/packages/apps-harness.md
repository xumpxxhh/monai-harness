# 进展：apps/harness

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `apps/harness/` |
| 状态 | `done`（P8–P9d）；**M1h 装配待做** |
| 首触阶段 | P0（空壳）起贯穿；M1h Secret + Model 装配 |
| 上游 | [engineering/00 §4](../../engineering/00-implementation-baseline.md)、[engineering/02](../../engineering/02-runtime-composition.md)、EDR-002/014 |
| 最后更新 | 2026-08-28（M1 计划归档） |

## 1. 范围

- 唯一 MVP deployable
- bootstrap / DI：装配 adapters → runtime → delivery → api → governance → observability
- 同进程角色：api / dispatcher / scheduler / worker / observability / governance
- graceful shutdown：停接流量 → drain → 释放 lease
- Feature flags 默认关闭 DAG、spawn_child、Memory、sandbox.exec、真实 write_high

**P8b — bootstrap**（对齐 [engineering/02 §2](../../engineering/02-runtime-composition.md#2-bootstrap-与依赖注入)）：

```text
load config (.env)
→ build adapters (persistence-postgres | memory)
→ build Engine + delivery (dispatcher / scheduler / compensation scanner)
→ build api handlers
→ start loops + optional HTTP server (P8c)
→ graceful shutdown
```

- 环境变量（`.env.example`）：`DATABASE_URL`、`PERSISTENCE_DRIVER`（`memory`|`postgres`）、`PORT`、`HARNESS_ROLES` / `HARNESS_ROLE_*`、EDR-014 feature flags
- delivery 循环：Outbox claim → Queue → `queue_run` → `acquire_lease` → `execute_turn`；补偿扫描（`CompensationScanner`）

## 2. 非目标

- 在 app 内写领域算法或绕过 Engine 写库
- 首日拆多进程（接缝保留即可）

## 3. 验收清单

- [x] `private: true`；turbo `dev`/`start` 可跑
- [x] P7：启动时跑 EvalHarness（Golden 6×5 + 审批/幂等子集）+ EventStream 演示
- [x] bootstrap DI（adapters → runtime → delivery）— P8b（`config` / `bootstrap` / `loops` / `demo`）
- [x] `PERSISTENCE_DRIVER=postgres|memory` — P8b
- [x] delivery 循环（Outbox → queue → execute_turn）— P8b（`DeliveryLoops`；demo 内 tick；`HARNESS_MODE=serve` 常驻）
- [x] `.env.example`（`DATABASE_URL`、`PORT`、flags）— P8b
- [x] HTTP server 启动 — P8c（`http-server.ts` + `createHttpApp`；`HARNESS_MODE=serve`）
- [x] 角色可独立开关（便于测试）
- [x] 仅通过构造注入 ports，runtime 无 infra import
- [x] EDR-014 禁用项在装配层可验证（启动日志 + 非默认 warn）
- [x] shutdown 不丢「已 commit 未 dispatch」的可恢复状态（demo/serve 先 stop loops 再 `persistence.close`）

### M1（完成 — [0018](../sessions/0018-real-model-cluster-plan.md)）

- [x] bootstrap 装配 `SecretPort` + 真实 `ModelPort`（`MODEL_DRIVER=openai|stub` 可配置切换）
- [x] Eval / Golden 114 **仍** `StubModelPort`（07 门禁）
- [x] 密钥经 SecretPort lease；不进 bootstrap 日志 / Event

**P8b 退出**：PG 上 CreateRun → running → 至少一轮 `execute_turn` 端到端 — **已验证**。

## 4. 依赖

几乎所有 packages/adapters（运行期）。已链接 contracts/ports/runtime/api/delivery/observability/pack-sdk/model-stub/model-openai/secret-env/persistence-memory/**persistence-postgres**/queue-memory/synthetic-sink。

## 5. 缺口与风险

- 共享 Compose PG 上 compensation 可能扫到历史 pending outbox（dedupe 安全）
- 不得用真实模型跑 Eval 洗绿

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-28 | M1h 实装完成：SecretPort + OpenAiModelPort DI 装配；Eval 仍 stub |
| 2026-08-28 | M1h 计划：Secret + Model 装配；Eval 仍 stub；见 0018 |
| 2026-08-28 | P9d：`HARNESS_ROLES` / `HARNESS_ROLE_*` 独立开关；loops 按角色 tick |
| 2026-08-27 | P8d：标记 harness P8 范围 `done` |
| 2026-08-27 | P8c：serve 模式挂载 Hono HTTP/SSE |
| 2026-08-27 | P8b：bootstrap DI、`PERSISTENCE_DRIVER`、delivery loops、PG CreateRun→execute_turn |
| 2026-08-27 | P8b：bootstrap 计划写入本页（自 P8-HTTP-PG 归并） |
| 2026-08-27 | Golden 6×5：启动 eval 打印 30/30 |
| 2026-08-27 | P7：EvalHarness + subscribeRunEvents 演示 |
| 2026-08-27 | P3：依赖 pack-sdk + model-stub |
| 2026-08-27 | P0：占位 start |
| 2026-08-27 | 创建进展页 |
