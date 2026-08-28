# 会话日志

按实现会话追加短日志，便于回溯「哪一次会话改了什么」。

## 约定

- 文件名：`NNNN-short-slug.md`（四位序号，从 `0000` 起）
- 每条包含：日期、目标、改动、验证、未完成、HANDOFF 是否已更新
- 不写长篇设计讨论；细节进包进展页或 engineering

## 索引

| 序号 | 文件 | 日期 | 摘要 |
| --- | --- | --- | --- |
| 0000 | [0000-progress-system.md](./0000-progress-system.md) | 2026-08-27 | 建立实现进展 / HANDOFF 体系 |
| 0001 | [0001-p0-monorepo.md](./0001-p0-monorepo.md) | 2026-08-27 | P0：EDR 关闭 + monorepo 骨架 |
| 0002 | [0002-p1-contracts-uow.md](./0002-p1-contracts-uow.md) | 2026-08-27 | P1：contracts/ports/memory UoW |
| 0003 | [0003-p2-create-run-loop.md](./0003-p2-create-run-loop.md) | 2026-08-27 | P2：CreateRun→running 闭环 |
| 0004 | [0004-p3-light-loop.md](./0004-p3-light-loop.md) | 2026-08-27 | P3：execute_turn light 决策环 |
| 0005 | [0005-p4-tool-chain.md](./0005-p4-tool-chain.md) | 2026-08-27 | P4：Tool prepared/dispatch/reconcile |
| 0006 | [0006-p5-waiting-states.md](./0006-p5-waiting-states.md) | 2026-08-27 | P5：Approval / ask_user / Checkpoint |
| 0007 | [0007-p6-recovery.md](./0007-p6-recovery.md) | 2026-08-27 | P6：RecoveryService + replay + stale lease |
| 0008 | [0008-p7-observability-eval.md](./0008-p7-observability-eval.md) | 2026-08-27 | P7：EventStream + MVP 指标 + Eval 子集 |
| 0009 | [0009-golden-eval-matrix.md](./0009-golden-eval-matrix.md) | 2026-08-27 | Golden 6×5 + finish acceptanceChecks |
| 0010 | [0010-p8-http-pg-plan.md](./0010-p8-http-pg-plan.md) | 2026-08-27 | P8 HTTP/PG 计划写入 |
| 0011 | [0011-p8a-persistence-postgres.md](./0011-p8a-persistence-postgres.md) | 2026-08-27 | P8a：persistence-postgres + Docker L2 |
| 0012 | [0012-p8a-l2-recovery-prepared.md](./0012-p8a-l2-recovery-prepared.md) | 2026-08-27 | P8a 收尾：L2 recovery + prepared |
| 0013 | [0013-p8b-harness-bootstrap.md](./0013-p8b-harness-bootstrap.md) | 2026-08-27 | P8b：harness bootstrap + PG demo |
| 0014 | [0014-p8c-http-sse.md](./0014-p8c-http-sse.md) | 2026-08-27 | P8c：Hono REST/SSE + EDR-007 |
| 0015 | [0015-p8d-wrapup.md](./0015-p8d-wrapup.md) | 2026-08-27 | P8d：收尾回归；P8 done |
| 0016 | [0016-p9-stage-a-plan.md](./0016-p9-stage-a-plan.md) | 2026-08-28 | P9 阶段 A 收口计划归档（修订版） |
| 0017 | [0017-p9d-ops.md](./0017-p9d-ops.md) | 2026-08-28 | P9d：角色开关、L1-on-PG、EDR-007 文档 |
