# 0009 — Golden 6×5 + acceptanceChecks

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P7 之后（Eval 扩展） |
| HANDOFF 已更新 | 是 |

## 目标

补齐 design 08 §5.1 Golden 主路径 6×5=30，并使 required `acceptanceChecks` 在 `finish` 前真正执行。

## 改动

- `packages/contracts`：`AcceptanceCheck` 类型
- `packages/runtime`：`evaluateAcceptanceChecks`；`finish` 失败则 `action.rejected`
- `packages/adapters/model-stub`：`workspace-search`；`acceptance` 有 Fact 后 finish
- `packages/observability`：EvalHarness Golden 6 路径 × 5 次；workspace 夹具
- `apps/harness`：启动跑 30/30

## 验证

```powershell
pnpm --filter @monai/runtime test
pnpm --filter @monai/observability test
pnpm --filter harness build
node apps/harness/dist/index.js
```

Harness：`golden-main-paths: 30/30 (100%) PASS`

## 未完成

- 安全 8、恢复 8×5、审批 6、幂等 6×5
- Agent Definition 持久对象（checks 仍经 EngineDeps）
- HTTP/SSE、L2 PG、design 07 全量指标
