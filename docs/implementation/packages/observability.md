# 进展：packages/observability

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/observability/` |
| 状态 | `in_progress`（P7–P9c done；**M1g Token/cost 待做**） |
| 首触阶段 | P7；M1g usage/价表指标 |
| 上游 | [design/07 §4.2 Token/cost](../../design/07-observability-and-evaluation.md)、[engineering/05](../../engineering/05-testing-and-evolution.md)、EDR-013/015 |
| 最后更新 | 2026-08-28 |

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
- [x] Golden/审批/幂等/恢复 Eval 接线
- [x] 安全 8×1 Eval（P9b-sec）
- [x] Event 可重算时间指标（P9c：`computeRunTiming`）
- [x] 无 runtime commit 依赖

### M1（完成 — [0018](../sessions/0018-real-model-cluster-plan.md)）

- [x] Token/cost：从 `model.called` / `model.responded` + usage + **冻结价表版本**重算
- [x] 失败调用也计入；价格未知则费用 `unknown` 单列（design 07 §4.2）
- [x] Context overflow：从 Context 构建失败 / truncation 统计
- [x] `MVP_METRIC_GAPS` 移除 Token/cost 与 Context overflow 项

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| contracts、ports、runtime、delivery、api、workspace-memory | Eval 场景复用 Engine 闭环 + 工作区夹具 |

## 5. 缺口与风险

- 无独立 observability 消费循环（SSE 在 api；Eval 在 harness 启动）
- Eval 114 不得改用真实模型洗绿（07：Golden 用固定 Tool 桩）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-28 | M1g 实装完成：Token/cost + Context overflow 指标；MVP_METRIC_GAPS 收口 |
| 2026-08-28 | M1g 计划：Token/cost + Context overflow；见 0018 |
| 2026-08-28 | P9c：`computeRunTiming`；`MVP_METRIC_GAPS` 收口时间指标 |
| 2026-08-28 | P9b-sec：安全 8×1 Eval；`FULL_MVP_EVAL_SUITES` 114 用例 |
| 2026-08-27 | Golden 6×5 主路径；EvalContext 接入 workspace；finish 跑 required checks |
| 2026-08-27 | P7：observability 包、PersistenceEventStream、computeRunMetrics、EvalHarness |
| 2026-08-27 | 创建进展页 |
