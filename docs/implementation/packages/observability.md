# 进展：packages/observability

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/observability/` |
| 状态 | `in_progress`（P7：EventStream + MVP 指标 + Golden 6×5） |
| 首触阶段 | P7 |
| 上游 | [design/07](../../design/07-observability-and-evaluation.md)、[engineering/05](../../engineering/05-testing-and-evolution.md)、EDR-013/015 |
| 最后更新 | 2026-08-27 |

## 1. 范围

- 已提交 Event → Trace / Metrics / 审计视图
- `PersistenceEventStream`（`EventStreamPort`）
- MVP 指标重算 + 缺口清单
- `EvalHarness` + Golden 6×5 + 审批/幂等 L3 子集
- 异步消费；失败不回滚 Run、不重放副作用
- 低基数标签 enforce（聚合层待扩展）

## 2. 非目标

- 第二套领域 Trace ID 真相
- Evaluator 替代 Validator/Policy/Approval
- Run 写权 / runtime commit

## 3. 验收清单

- [x] 只读 Event / 领域投影
- [x] 投影失败可重试且不影响生产提交（纯函数 / 独立进程）
- [x] MVP 核心指标可重算；缺口见 `MVP_METRIC_GAPS`
- [x] Golden/审批/幂等 Eval 接线（Golden 6×5=30 @ 90%；审批/幂等仍为子集）
- [x] 无 runtime commit 依赖

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| contracts、ports、runtime、delivery、api、workspace-memory | Eval 场景复用 Engine 闭环 + 工作区夹具 |

## 5. 缺口与风险

- design 07 全量指标（queue/active/awaiting/total 时间、Token/cost 等）未实现
- 安全 8 / 恢复 8×5 / 审批 6 / 幂等 6×5 未接线
- HTTP/SSE EventStream（EDR-007 Deferred）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | Golden 6×5 主路径；EvalContext 接入 workspace；finish 跑 required checks |
| 2026-08-27 | P7：observability 包、PersistenceEventStream、computeRunMetrics、EvalHarness |
| 2026-08-27 | 创建进展页 |
