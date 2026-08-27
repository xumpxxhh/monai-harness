# 进展：adapters/synthetic-sink

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/synthetic-sink/` |
| 实现端口 | 支撑 `synthetic.write_high` / reconcile（经 Tool Runtime） |
| 状态 | `in_progress` |
| 首触阶段 | P4–P5 |
| 上游 | [design/08 §2.5](../../design/08-mvp-and-evolution.md) |
| 最后更新 | 2026-08-27 |

## 1. 范围

- 隔离合成外部写：稳定资源键、副作用计数
- 可注入超时 → outcome_unknown
- reconcile 查询权威结果
- 与真实业务系统、外网、生产资源隔离

## 2. 非目标

- 真实 write_high 外部系统

## 3. 验收清单

- [ ] 审批链可完整走通（require_approval → consume → prepared → dispatch）— P5
- [x] 超时与对账用例稳定可重复（L1）
- [x] 副作用计数可断言「无重复」
- [x] `synthetic://` 资源前缀强制隔离

## 4. 依赖

runtime ToolInvoker。

## 5. 缺口与风险

- 必须防止被误接到真实 HTTP sink

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | P4：`IsolatedSyntheticSink` + timeout/reconcile |
| 2026-08-27 | 创建进展页 |
