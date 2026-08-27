# 0008 — P7 Observability & Eval

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P7 |
| HANDOFF 已更新 | 是 |

## 目标

EventStream 只读订阅、MVP 指标重算、Eval L3 子集接线。

## 改动

- 新建 `packages/observability`：`PersistenceEventStream`、`computeRunMetrics`、`MVP_METRIC_GAPS`、`EvalHarness`
- `packages/api`：`subscribeRunEvents`
- `packages/ports`：`EventStreamPort` 类型化为 `EventEnvelope`
- `apps/harness`：启动跑 eval 子集 + event-stream 演示

## 验证

```powershell
pnpm --filter @monai/observability test
pnpm --filter harness build
node apps/harness/dist/index.js
```

## 未完成

- design 08 完整 Golden 6×5、安全 8 用例
- design 07 全量指标（见 `MVP_METRIC_GAPS`）
- HTTP/SSE（EDR-007）
