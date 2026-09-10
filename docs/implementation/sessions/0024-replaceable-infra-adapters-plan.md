# Session 0024 — 可替换 infra 适配器计划

> **状态：已归档 / 已落地**（Queue/Lease/ObjectStore/Sandbox stub done；artifact 已接；subprocess 见 0025）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-07 |
| 类型 | 实现（Queue/Lease/Sandbox/ObjectStore；Artifact 其后已接入） |
| HANDOFF 已更新 | 是 |

## 背景

P0–P9、M1–M3 已完成。对照 [engineering/05 §4.2](../../engineering/05-testing-and-evolution.md#42-迁移检查点) 与 [engineering/04](../../engineering/04-ports-extensions-and-security.md)：`PersistencePort` 已可切 memory/postgres，但 harness 仍将 `QueuePort` / `LeasePort` **写死**为 memory；`ObjectStorePort` / `SandboxPort` 仅有 ports 类型、无 adapter。

本轮目标：在 **不拆 API+Worker 进程** 的前提下，把 Queue / Lease / ObjectStore / Sandbox 做成可替换装配，为日后拆分检查点铺垫。

上游约束：

- EDR-004：Queue 可内联；换后端不改 Command / Event 语义
- EDR-006：Lease fencing；PG 行锁路径已有
- EDR-014：MVP 不挂可执行 sandbox；stub 须拒绝 `exec`
- design 08：不因本计划开启阶段 B，不宣称阶段 A Knowledge 关闭

## 现状缺口（代码对照）

| 项 | 现状 |
| --- | --- |
| Queue | `@monai/queue-memory`；`apps/harness` bootstrap 固定 `InMemoryQueue` |
| Lease | `@monai/lease-memory`；bootstrap 固定 `InMemoryLease` |
| Persistence | memory / postgres 可切；Outbox claim 已有 `SKIP LOCKED` |
| ObjectStore | ports 有 `put`/`get`/`signedRef`；无 adapter；Artifact 正文未迁出 DB |
| Sandbox | ports 保留；无 stub 包；装配未注入「无能力」实现 |
| delivery | 只依赖 `QueuePort` 接口；换 adapter 不应改业务代码 |

## 建议实现顺序

```text
1. harness 装配开关
   QUEUE_DRIVER / LEASE_DRIVER（默认 memory）；仅改 bootstrap / env
2. @monai/queue-postgres
   同库 queue_messages 投影；至少一次 enqueue/lease/ack/nack
3. @monai/lease-postgres
   同库 lease 行；bind / heartbeat / validate / release 与 fencing 一致
4. @monai/sandbox-stub
   exec 恒拒绝；Registry / allowlist 断言无 sandbox_exec；可选注入 DI
5. @monai/objectstore-fs
   租户路径 + 内容 hash；signedRef 可先本地 path；hash 失败拒绝
```

**第一刀**：装配开关（切片 1），证明 delivery 零业务改动即可切换驱动；**不要**先上 Redis/SQS。

推荐验证组合：`PERSISTENCE_DRIVER=postgres` + `QUEUE_DRIVER=postgres` + `LEASE_DRIVER=postgres` 跑既有 L1 CreateRun→running / 双投递 / L2 fencing。

## 各切片验收（摘要）

| 顺序 | 交付 | 验收要点 |
| --- | --- | --- |
| 1 | driver 开关 | env 可切；默认 memory；delivery 无改 |
| 2 | queue-postgres | L1 双投递 + 补偿在 PG 队列上绿；载荷含 `runId+revision+dedupeKey` |
| 3 | lease-postgres | stale owner 无法 heartbeat/validate；多 owner 模拟无双持有执行权 |
| 4 | sandbox-stub | 任意 `exec` 明确拒绝；不得注册 `sandbox_exec` Tool |
| 5 | objectstore-fs | 租户隔离；hash 校验失败拒绝；与 Artifact 元数据联调可后置 |

## 明确不做

- 拆 `apps_api` / `apps_worker` 进程
- Redis / SQS 等外置队列产品选型（第二后端先用同库 PG 投影）
- 真实可执行 sandbox / `isolated_extension`（EDR-010 仍 Deferred）
- KnowledgePort / Context `knowledge` section
- ConfirmationGrant / `confirm_once`
- 改 Eval 114 使用真实模型或挂载 RAG

## 与拆分检查点的关系

| engineering/05 §4.2 | 本计划结束后 |
| --- | --- |
| QueuePort / LeasePort / PersistencePort 可替换 | 目标达成（第二实现为 PG 投影 / fs / stub） |
| Outbox 多 dispatcher `SKIP LOCKED` | 已有（PG persistence） |
| Core 零 infra import；推进经 `HarnessCommand` | 维持 |
| 「API 与 Worker 分离配置」下重跑 08 套件 | **不在本计划范围** |

## 改动路径（本 session — 仅文档）

| 文件 | 说明 |
| --- | --- |
| `docs/implementation/sessions/0024-replaceable-infra-adapters-plan.md` | 本日志 |
| `docs/implementation/sessions/README.md` | 索引 0024 |
| `docs/implementation/HANDOFF.md` | 焦点切至本计划；下一步第一刀 |
| `docs/implementation/STATUS.md` | 同步日期；计划已归档备注 |
| `docs/implementation/PHASES.md` | 可选短节：可替换 infra 适配器 |
| `docs/implementation/adapters/queue.md` | 计划指针 |
| `docs/implementation/adapters/lease.md` | 计划指针 |
| `docs/implementation/adapters/objectstore.md` | 计划指针 |
| `docs/implementation/adapters/sandbox-stub.md` | 计划指针 |

## 验证

```text
pnpm --filter @monai/queue-postgres test
pnpm --filter @monai/lease-postgres test
pnpm --filter harness test
```

## 已知故障（无）

## 未完成 / 后续可选

- KnowledgePort、confirm_once（显式延后）

## 验证记录（2026-09-07）

全 postgres L1（同库 persistence + queue + lease）：

```text
pnpm --filter @monai/persistence-postgres test -- src/postgres-l1-loop.test.ts
# 3/3 绿：主路径 / 双投递 dedupe / 补偿重建 queue
```

L2 scenarios（lease-postgres）：

```text
pnpm --filter @monai/persistence-postgres test -- src/postgres-l2-scenarios.test.ts
# 4/4 绿：recovery ×2 + prepared-before-dispatch ×2
```

Artifact → ObjectStorePort：

```text
pnpm --filter @monai/observability test   # Eval 114 绿
pnpm --filter @monai/delivery test
```
