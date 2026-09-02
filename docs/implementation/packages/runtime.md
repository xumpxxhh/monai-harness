# 进展：packages/runtime

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/runtime/`（**单包**，EDR-011） |
| 状态 | `done`（M2） |
| 首触阶段 | P1–P6（贯穿）；M1 Budget/Builder/Policy；M2 决策/并行/Context |
| 上游 | [engineering/01–03](../../engineering/01-repository-and-modules.md)、[design/03 §6.1](../../design/03-run-lifecycle.md#61-toolcall)、[design/05 §3.1.1](../../design/05-context-and-data.md#311-dialogue-投影与-modelview实现) |
| 最后更新 | 2026-09-02 |

## 1. 范围（内部模块）

```text
engine/ commit/ strategy/ hooks/ context/
control/ execution/ state/ manifest/ extension/ commands/
model/ preview/ recovery/
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

### M2（完成 — [0019](../sessions/0019-post-m1-agent-loop.md)）

**M2b — 模型决策环**（function calling）：

```text
function-catalog（控制函数 vs 领域 tools）
→ ModelPort.completeStructured → ModelDecision
→ map-decision / hydrate-action / normalize-action → Action
（控制 XOR 领域批次；无 call 且已有 fact 才 implicit finish）
```

- [x] `function-catalog`：canonical 控制/领域函数定义
- [x] `map-decision` / `hydrate-action`：`ModelDecision` → Action
- [x] `normalize-action`：`calls[]` 规范化与 legacy `toolId` 兼容

**M2c — 并行工具**（对齐 design 03 §6.1）：

- [x] `evaluate-policy`：按条判定，聚合 `all_allow` / `partial` / `all_deny` / `require_approval`
- [x] `prepare-tool-calls`：单 Action 扇出 N 条 ToolCallRecord `prepared`
- [x] `project-approval`：审批绑定整批 `toolCallIds`
- [x] `execute-turn`：兄弟 ToolCall 全终态才 `step.completed`；存在 `prepared`/`dispatched` 时不调模型

**M2d — Context 分层投影**（对齐 design 05 §3.1.1）：

```text
Event Log → projectDialogue → DialogueTurn[]
  → ensureDialogueCompression（recent 完整 / history 摘要）
  → projectModelMessages → ModelMessage[]
```

- [x] `projectDialogueFromEvents`：从 Event 重建 user/assistant/tool turns
- [x] `projectSessionDialogue`：Session 跨 Run 合并对话（goal 仅当前句）
- [x] `projectModelMessages`：recent 窗口完整 messages + history 摘要
- [x] `ensureDialogueCompression`：超阈值 LLM/确定性摘要 + `context.summary_created` Event
- [x] `build-model-context`：组装 `ModelCompleteInput.messages`
- [x] `publish-model-context` / `preview-hub`：模型上下文预览
- [x] `DisabledMemoryPort` 占位（MVP 不检索）

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
| 2026-09-02 | M2d：Dialogue 投影 + 压缩 + `build-model-context`；`publish-model-context` |
| 2026-09-01 | M2c：并行 `prepare-tool-calls`；Policy 按条；`project-approval`；Step 闭合 |
| 2026-09-01 | M2b：function calling 决策环（`map-decision` / `hydrate-action` / `function-catalog`） |
| 2026-08-31 | harness demo 集成驱动 `execute-turn` 重构（session / preview） |
| 2026-08-28 | M1b–M1d 实装完成：BudgetGuard + Context Builder + Model Policy 循环与 fallback |
| 2026-08-28 | M1b–M1d 计划：BudgetGuard + Context Builder + Model Policy 循环；见 0018 |
| 2026-08-27 | finish `acceptanceChecks` 门禁（`evaluateAcceptanceChecks`） |
| 2026-08-27 | P6：recovery/（replay-events、RecoveryService、state-hash）；Engine acquire_lease 接线 |
| 2026-08-27 | P5：approval wait/decide/resume；ask_user/submit_input；actionDigest |
| 2026-08-27 | P4：ToolCall prepare、tool_dispatch_result、reconcile、ToolInvoker/catalog |
| 2026-08-27 | P3：execute_turn / Hook / Policy / Reducer |
| 2026-08-27 | P2：Engine create/queue/lease |
| 2026-08-27 | P1：applyCommit + ordering |
