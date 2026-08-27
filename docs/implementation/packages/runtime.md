# 进展：packages/runtime

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/runtime/`（**单包**，EDR-011） |
| 状态 | `in_progress`（P6 Recovery；P7+ finish `acceptanceChecks`） |
| 首触阶段 | P1–P6（贯穿） |
| 上游 | [engineering/01–03](../../engineering/01-repository-and-modules.md)、[design/03](../../design/03-run-lifecycle.md) |
| 最后更新 | 2026-08-27 |

## 1. 范围（内部模块）

```text
engine/ commit/ strategy/ hooks/ context/
control/ execution/ state/ manifest/ extension/ commands/
recovery/
```

## 2. 非目标

- 静态 import adapters/packs（ToolInvoker 依赖 synthetic-sink 为编译期；Workspace 运行期注入）
- MVP 启用 Child Run / Memory / DAG

## 3. 验收清单（分阶段勾选）

### P1–P3

- [x] 见既有勾选（commit / CreateRun→running / execute_turn light）

### P4

- [x] Tool prepared → dispatch 意图 → terminal/unknown → reconcile
- [x] PreToolCall veto 不 prepared（veto → step.failed）
- [x] 只读旁路移除：echo/workspace 亦走 prepared 路径
- [x] 禁止 outcome_unknown 新幂等键盲重试

### P5

- [x] Approval / ask_user / Checkpoint / Continuation
- [x] 等待只唤醒到 queued
- [x] approve 后 re-lease → Policy + PreToolCall + consume+prepared 同 UoW

### P6

- [x] RecoveryService（Checkpoint 选择 + Event replay + hash 校验）
- [x] acquire_lease 后自动 recover
- [x] yieldStaleRunningRun（running + 过期 lease → queued）
- [x] L1：全量 vs Checkpoint 加速 hash；stale leaseEpoch 派发

### P7

- [x] 不拥有 EventStream（属 observability）；提供 Golden 可调用的 Engine 闭环
- [x] `finish` 前评估 required `acceptanceChecks`（最小 Validator：`core.finish_gate` / `core.state_last_fact`）

## 4. 依赖

contracts、ports、pack-sdk、synthetic-sink（invoker）；workspace 运行期注入。

## 5. 缺口与风险

- ConfirmationGrant / confirm_once 未实现
- design 08 完整故障注入矩阵仍为 L1 子集
- ToolInvoker 编译依赖 synthetic-sink（隔离测试适配器）
- Agent Definition 尚未作为持久对象；`acceptanceChecks` 经 `EngineDeps` 注入

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | finish `acceptanceChecks` 门禁（`evaluateAcceptanceChecks`） |
| 2026-08-27 | P6：recovery/（replay-events、RecoveryService、state-hash）；Engine acquire_lease 接线 |
| 2026-08-27 | P5：approval wait/decide/resume；ask_user/submit_input；actionDigest |
| 2026-08-27 | P4：ToolCall prepare、tool_dispatch_result、reconcile、ToolInvoker/catalog |
| 2026-08-27 | P3：execute_turn / Hook / Policy / Reducer |
| 2026-08-27 | P2：Engine create/queue/lease |
| 2026-08-27 | P1：applyCommit + ordering |
