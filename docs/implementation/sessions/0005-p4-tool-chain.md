# 0005 — P4 副作用 Tool 链

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P4 → `done` |
| HANDOFF 已更新 | 是 |

## 目标

ToolCallRecord prepared → 事务外 dispatch → succeeded/failed/outcome_unknown → reconcile；workspace/artifact/synthetic MVP。

## 改动

- contracts：ToolCallRecord / effect contract；tool.* events
- ports：getToolCall / listToolCalls；CommitPlan.toolCalls 类型
- adapters：workspace-memory、synthetic-sink
- runtime：tool catalog/invoker、prepare 路径、tool_dispatch_result / reconcile_tool
- delivery：ToolDispatcher；OutboxDispatcher 跳过非 queue_run
- L1：echo / workspace.read / synthetic unknown+reconcile / 同键幂等

## 验证

- [x] `pnpm build` / `check-types`
- [x] runtime 13 + delivery 7 + persistence 3

## 未完成

- P5 审批等待完整链（synthetic 默认 require_approval）
- L2 PG
- HTTP（EDR-007）
