# HANDOFF — 实现交接

> 最后更新：2026-08-28（**P9d 运维完成；P9 done**）

## 当前状态（一句话）

**P0–P9 已完成。** 不自动宣称 design 08 阶段 A 已关闭：Token/cost 20% 回归带仍可能缺 usage + 价表。

## P9d 已交付

- harness 角色开关：`HARNESS_ROLES` allowlist / `HARNESS_ROLE_*`（api / dispatcher / scheduler / worker / observability / governance）
- L1-on-PG：CreateRun→running（双投递 + 补偿）在 `persistence-postgres` 上全绿
- engineering README / 02 / 04 与 EDR-007 Accepted（Hono）一致

## 下一步

1. 阶段 A 文档收口（对照 design 08；标明 Token/cost 缺口）
2. Token/cost 基线：usage Event + 价表（见 `MVP_METRIC_GAPS`）
3. 非本阶段：ConfirmationGrant、真实 Queue、拆 API+Worker

## 回归

```text
pnpm --filter harness test
pnpm --filter @monai/persistence-postgres test
pnpm --filter @monai/observability test     # 114 Eval
```

## 关键路径

| 用途 | 路径 |
| --- | --- |
| 角色开关 | `apps/harness/src/config.ts` / `loops.ts` |
| L1-on-PG | `packages/adapters/persistence-postgres/src/postgres-l1-loop.test.ts` |
| Governance 注册 | `packages/governance/src/pack-registration-service.ts` |
| 时间指标 | `packages/observability/src/metrics/compute-run-timing.ts` |
| Manifest 冻结 | `packages/runtime/src/manifest/freeze-manifest.ts` |
