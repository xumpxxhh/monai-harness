# 进展：packages/runtime

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/runtime/`（**单包**，EDR-011） |
| 状态 | `in_progress`（P6 Recovery；P7+ finish；**M1b–M1d 计划**） |
| 首触阶段 | P1–P6（贯穿）；M1 Budget/Builder/Policy |
| 上游 | [engineering/01–03](../../engineering/01-repository-and-modules.md)、[design/03](../../design/03-run-lifecycle.md)、[design/05 Context](../../design/05-context-and-data.md) |
| 最后更新 | 2026-08-28 |

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

### M1（完成 — [0018](../sessions/0018-real-model-cluster-plan.md)）

**循环顺序**（对齐 design 03 §5.1）：

```text
BudgetGuard → Context Builder → context.built + ContextBuildRecord
→ Model Policy 解析 → completeStructured(modelPolicy, controlFunctions, domainTools)
→ ModelDecision 映射为 Action（领域 calls 批次；控制 XOR 领域；无 call 且已有 fact 才 implicit finish）
→ 失败/fallback/解析重试（同 Step、新 modelCallId）
```

- [x] M1b：`BudgetGuard`（maxSteps / maxTokens / maxCost / maxWallTime）；不足 → failed、不调模型
- [x] M1c：Context Builder（05 section 优先级 + `ContextBudget` 裁剪）；Knowledge 检索不调用
- [x] M1c：`context.built` 提交 `ContextBuildRecord`（含 modelPolicy digest、contextHash、truncations）
- [x] M1d：从冻结 Manifest 解析 Model Policy → 传入 `ModelPort`
- [x] M1d：网络失败 / fallback / Action 解析重试：同 Step、新 `modelCallId`

## 4. 依赖

contracts、ports、pack-sdk、synthetic-sink（invoker）；workspace 运行期注入。

## 5. 缺口与风险

- ConfirmationGrant / confirm_once 未实现
- design 08 完整故障注入矩阵仍为 L1 子集
- ToolInvoker 编译依赖 synthetic-sink（隔离测试适配器）
- Agent Definition 尚未作为持久对象；`acceptanceChecks` 经 `EngineDeps` 注入
- Knowledge 真实检索后置切片

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-28 | M1b–M1d 实装完成：BudgetGuard + Context Builder + Model Policy 循环与 fallback |
| 2026-08-28 | M1b–M1d 计划：BudgetGuard + Context Builder + Model Policy 循环；见 0018 |
| 2026-08-27 | finish `acceptanceChecks` 门禁（`evaluateAcceptanceChecks`） |
| 2026-08-27 | P6：recovery/（replay-events、RecoveryService、state-hash）；Engine acquire_lease 接线 |
| 2026-08-27 | P5：approval wait/decide/resume；ask_user/submit_input；actionDigest |
| 2026-08-27 | P4：ToolCall prepare、tool_dispatch_result、reconcile、ToolInvoker/catalog |
| 2026-08-27 | P3：execute_turn / Hook / Policy / Reducer |
| 2026-08-27 | P2：Engine create/queue/lease |
| 2026-08-27 | P1：applyCommit + ordering |
