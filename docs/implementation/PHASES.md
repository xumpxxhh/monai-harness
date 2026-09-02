# 实现阶段路线（P0–P9 + M1 + M2）

对齐 [engineering/05 §6](../engineering/05-testing-and-evolution.md#6-建议实现顺序仅规划)，并增加 **P0 建仓**。每阶段退出必须带上对应测试层，禁止「假闭环」。P9 主链完成后，**M1** 为可选切片（不新开 P10）。

## 总览

| 阶段 | 名称 | 状态 | 主要包 |
| --- | --- | --- | --- |
| P0 | Monorepo 骨架与工具链 | `done` | tooling、apps/harness 空壳 |
| P1 | contracts + ports + Persistence UoW + Event append | `done` | contracts、ports、persistence-memory、runtime(commit) |
| P2 | Outbox + 内联 Queue + Scheduler + CreateRun→running | `done` | delivery、queue-memory、lease-memory、api(命令)、runtime(Engine) |
| P3 | light 循环 + Model stub + Policy + Fact/Reducer | `done` | runtime、model adapter、pack-sdk |
| P4 | Tool prepared/dispatch/unknown/reconcile + synthetic | `done` | runtime/execution、synthetic-sink、workspace-generic |
| P5 | Approval + ask_user + Checkpoint/Continuation | `done` | runtime、api、governance(最小) |
| P6 | Recovery + L1/L2 故障注入 | `done` | runtime、persistence、test fixtures |
| P7 | EventStream + 指标 + Golden/Eval 接线 | `done` | api、observability、apps/harness、eval fixtures |
| P8 | HTTP API + PostgreSQL Persistence | `done` | persistence-postgres、api(http/sse)、apps/harness(bootstrap) |
| P9 | 阶段 A 收口（Pack / Eval / 治理·指标） | `done` | packs/workspace-generic、runtime/extension、observability/eval、governance |
| M1 | 真实模型簇（可选） | `done` | contracts、runtime、model/secret adapters、observability、harness |
| M2 | Agent Loop 增强 | `done` | contracts、runtime、delivery、model adapters、harness demo |

阶段依赖：`P0 → … → P9` 主链已完成。P9 收口 [design/08 阶段 A](../design/08-mvp-and-evolution.md#阶段-a--mvp-契约闭环) 的 Pack/Eval/治理面，**不**自动关闭阶段 A（Token/cost 基线可能仍缺）。治理/观测不得提前获得 Run 写权。**M1** 计划见 [sessions/0018](sessions/0018-real-model-cluster-plan.md)；**M2** 见 [sessions/0019](sessions/0019-post-m1-agent-loop.md)；Knowledge 检索后置。

## P0 — Monorepo 骨架

**目标**：pnpm + Turborepo + TS 根配置；空包可 `build`/`check-types`。

**退出条件**：

- [x] 根 `package.json` / `pnpm-workspace.yaml` / `turbo.json` 符合 [turborepo.md](../turborepo.md)
- [x] `packages/contracts|ports|runtime` 等空包或最小 stub 可被 turbo 调度
- [x] `apps/harness` 可启动占位进程（不必有业务）
- [x] 架构依赖约束方式已选定（eslint boundaries / dependency-cruiser 等，可先文档化后启用）

**非目标**：业务逻辑、真实 DB。

## P1 — 契约、端口、UoW、Event

**目标**：CommitPlan / Event append / revision+leaseEpoch 校验骨架。

**退出条件**：

- [x] contracts 覆盖 01 核心对象的 TS 类型（可迭代；P1 已含 Run/Event/Records/Error）
- [x] ports 暴露 Persistence/Outbox/… 接口
- [x] persistence 适配器能同 UoW 写 Event + Run + Outbox（`persistence-memory`）
- [x] L0：Event 排序与 revision 冲突单测
- [x] EDR-005/006 至少变为 Accepted 或显式记录偏差

## P2 — 投递闭环 CreateRun→running

**退出条件**：

- [x] `create_run` → outbox → queue → `queue_run` → `acquire_lease` → `running`
- [x] 严格 `created → queued → running` Event
- [x] 补偿扫描可重建 `{runId,revision}` 信号
- [x] L1：双投递去重；L2：CreateRun 原子性（若已接真实库）— L2 延后，L1 已覆盖

## P3 — light 决策环

**退出条件**：

- [x] Pre/PostReasoning Hook 点可调用
- [x] ContextBuilder + ModelPort stub → Action
- [x] Policy allow/deny/require_approval + `policy.evaluated`
- [x] Observation → Fact → Reducer → State（只读工具路径可先通）
- [x] L0：Reducer / Policy 确定性单测

## P4 — 副作用 Tool 链

**退出条件**：

- [x] prepared-before-dispatch + 同键幂等
- [x] outcome_unknown + reconcile
- [x] workspace.* 与 artifact.* MVP 工具
- [x] synthetic.write_high + reconcile（隔离 sink）
- [x] L1/L2：超时未知、禁止新幂等键盲重试 — L1 已覆盖；L2 延后

## P5 — 等待态

**退出条件**：

- [x] ApprovalRecord 单次消费与 prepared 同 UoW
- [x] 等待只唤醒到 `queued`
- [x] ask_user 输入 Schema + Continuation
- [x] Checkpoint 绑定 revision/sequence/state hash/cursor
- [x] 审批生命周期套件可跑通主路径

## P6 — 恢复

**退出条件**：

- [x] 无 Checkpoint 全量 replay 与有 Checkpoint 加速 hash 一致
- [x] stale lease 迟到结果走对账（`lease_lost` + `yieldStaleRunningRun`）
- [x] 08 恢复故障注入套件达到可统计次数（L1 子集；完整矩阵可 P7 前扩展）

## P7 — 观测与评测门禁

**退出条件**：

- [x] EventStream 按 sequence 订阅
- [x] 07 核心指标可从 Event 重算（MVP 子集；缺口见 `MVP_METRIC_GAPS`）
- [x] Golden / 审批 / 幂等套件接线（Golden 主路径 6×5=30 @ 90%；审批/幂等仍为子集）

## P8 — HTTP + PostgreSQL

**目标**：L2 真实单库 + 可部署 Harness + HTTP/SSE 接入（关闭 EDR-007）。

**上游**：[engineering/02](../engineering/02-runtime-composition.md)、[engineering/03](../engineering/03-persistence-and-transactions.md)、[engineering/05 §2.3](../engineering/05-testing-and-evolution.md#23-l2-真实单库集成)。

**建议顺序**（PG 优先；P8 退出以 PG L2 通过为准）：

```text
P8a  persistence-postgres  →  [adapters/persistence.md](./adapters/persistence.md)
  ↓
P8b  harness bootstrap     →  [packages/apps-harness.md](./packages/apps-harness.md)
  ↓
P8c  HTTP + SSE            →  [packages/api.md](./packages/api.md)
  ↓
P8d  文档 / STATUS 同步；可选 PG 上 Golden 6×5 回归
```

**子阶段**：

| 子阶段 | 焦点 | 进展页 |
| --- | --- | --- |
| P8a | `@monai/persistence-postgres`：drizzle schema、UoW、L2 单测 | [adapters/persistence.md](./adapters/persistence.md) |
| P8b | bootstrap DI、`PERSISTENCE_DRIVER`、delivery 循环 | [packages/apps-harness.md](./packages/apps-harness.md) |
| P8c | REST 路由、错误映射、SSE EventStream | [packages/api.md](./packages/api.md) |
| P8d | HANDOFF/STATUS/包页勾选；EDR-007 关闭 | 本页 + [HANDOFF.md](./HANDOFF.md) |

**第一刀**：建 `packages/adapters/persistence-postgres` → drizzle schema（`runs`/`events`/`outbox`/`idempotency`）→ `UoW-CreateRun` → L2 CreateRun 原子性 + sequence。

**退出条件**：

- [x] `@monai/persistence-postgres` 实现 Persistence/Outbox/Idempotency，行为等价 memory（L2 主路径子集）
- [x] L2：[engineering/05 §2.3](../engineering/05-testing-and-evolution.md#23-l2-真实单库集成) 场景全绿（含 recovery / prepared-before-dispatch）
- [x] harness：PG 上 CreateRun → running → `execute_turn` 端到端
- [x] HTTP：REST 写经 `Engine.handle`；读经 PersistencePort 只读
- [x] SSE：`/v1/runs/:runId/events/stream` 推送已 commit Event
- [x] EDR-007 Accepted；category → HTTP 映射表落地
- [x] `.env.example` 含 `DATABASE_URL`、`PERSISTENCE_DRIVER`、`PORT`

**非目标**：Eval 完整矩阵、ConfirmationGrant、拆多进程、真实 ObjectStore。

**与 Eval 矩阵**：P8 与「安全 8×1 / 恢复 8×5 / 审批·幂等完整矩阵」并列可选；Eval 完整矩阵与 **PG 上 Golden 6×5** 延后为 P8 之后可选工作（P8d 未强制）。

**P8d（2026-08-27）**：文档/STATUS 同步完成；回归：postgres L2 12/12、api HTTP/SSE 2/2、delivery 10/10、harness memory（含 Golden 30/30）+ postgres demo。

## P9 — 阶段 A 收口

**目标**：补齐 design 08 阶段 A 仍缺的 Pack/Registry、Eval 完整矩阵、governance 最小面；**不**开阶段 B / 拆多进程。

**上游**：[engineering/04 §9](../engineering/04-ports-extensions-and-security.md)、[design/08 §5](../design/08-mvp-and-evolution.md#5-可执行-mvp-验收矩阵)。

**修订原则**（2026-08-28）：P9a 只做薄 Pack；Manifest 冻结单独 P9a2；控制面 Eval 可与 Pack 并行；安全 8 后置。详见 [sessions/0016-p9-stage-a-plan.md](./sessions/0016-p9-stage-a-plan.md)。

**建议顺序**：

```text
P9a   薄 Pack 装配     →  workspace-generic + ExtensionRegistry + ToolInvoker 注入
P9a2  Manifest 冻结   →  CreateRun hash；Engine 读 Manifest（替换 EngineDeps allowlist）
P9b   控制面 Eval      →  恢复 8×5、审批 6×1、幂等 6×5（可与 P9a 并行）
P9b-sec  安全 Eval     →  越权 8×1（依赖 Pack / 路径规范化）
P9c   治理 + 指标      →  governance 最小；Event 可重算时间指标
P9d   运维（可选）     →  角色开关、L1-on-PG、engineering README EDR-007 一致
```

**子阶段**：

| 子阶段 | 焦点 | 进展页 |
| --- | --- | --- |
| P9a | contracts 类型、pack-sdk Tool、内存 Registry、`@monai/pack-workspace-generic`、路径防逃逸 | [workspace-generic.md](./packages/workspace-generic.md)、[pack-sdk.md](./packages/pack-sdk.md)、[runtime.md](./packages/runtime.md) |
| P9a2 | ExecutionManifest 冻结；Recovery hash 校验 | [runtime.md](./packages/runtime.md)、[contracts.md](./packages/contracts.md) |
| P9b | EvalHarness 完整控制面矩阵 | [observability.md](./packages/observability.md) |
| P9b-sec | 安全 8×1 Eval | [observability.md](./packages/observability.md) |
| P9c | governance 包 + 指标缺口收口 | [governance.md](./packages/governance.md)、[observability.md](./packages/observability.md) |
| P9d | harness 角色开关、L1-on-PG、文档 | [apps-harness.md](./packages/apps-harness.md) |

**P9a 第一刀**：`contracts` Manifest 类型 → `pack-sdk` Tool handler → `runtime/extension` Registry → `packs/workspace-generic` → harness/Eval 注册。

**P9a 退出条件**：

- [x] ExtensionRegistry：权限超限 / 缺 ToolEffectContract / EDR-014 能力 → 拒绝
- [x] `@monai/pack-workspace-generic`：MVP Tool 集 + 5 Hook 可注册；`artifact.validate` 可 dispatch
- [x] workspace-memory 路径防逃逸（`.` / `..` / 越权根）
- [x] ToolInvoker handlers 注入；runtime 不再编译依赖 `synthetic-sink`
- [x] Golden 6×5 仍 ≥90%（30/30）
- [x] CreateRun 冻结 `executionManifestHash`（P9a2；ref 仍为字符串 `executionManifestRef`）

**P9b 退出条件**：

- [x] EvalHarness：恢复 8×5=40 @ ≥95%
- [x] EvalHarness：审批 6×1=6 @ 100%
- [x] EvalHarness：幂等 6×5=30 @ 100%
- [x] Golden 6×5 仍绿（与 P9a 回归一并跑）

**P9a2 退出条件**：

- [x] CreateRun 冻结 ExecutionManifest（`executionManifestHash` + 不可变 store）
- [x] Engine `execute_turn` 从 Manifest 读 allowlist / requireApproval / acceptanceChecks
- [x] Recovery 校验 manifest ref + hash
- [x] 同 ref 异 hash → `conflict`；冻结后 widening EngineDeps 不生效
- [x] L0/L1：`manifest-freeze.test.ts`；Eval 106 用例仍绿

**P9b-sec 退出条件**：

- [x] EvalHarness：越权与安全 8×1=8 @ 100%（零容忍）
- [x] 跨租户命令拒绝；路径逃逸；Manifest 冻结 allowlist；Secret/外发 sink 拒绝
- [x] Golden 6×5 与控制面矩阵仍绿

**P9c 退出条件**：

- [x] `@monai/governance`：GovernanceEvent store + PackRegistrationService（无 Run 写权）
- [x] `computeRunTiming`：queue / active / awaiting / total wall time 从 Event 重算
- [x] `MVP_METRIC_GAPS` 移除 4 项时间指标；Token/cost 仍列缺口
- [x] harness Pack 装配接 `governanceStore` 审计

**P9d 退出条件**：

- [x] harness 角色可独立开关（`HARNESS_ROLES` allowlist / `HARNESS_ROLE_*`）
- [x] L1 CreateRun→running（含双投递、补偿）在 PG 上全绿
- [x] engineering README / 02 / 04 与 EDR-007 Accepted 一致

**P9 非目标（整阶段）**：拆 API+Worker；真实 Queue/AuthN；ConfirmationGrant；阶段 B–G；用 Eval 重跑洗绿安全用例。

**阶段 A 退出说明**：即使 P9 完成，Token/cost 20% 回归带仍可能缺 usage + 价表（`MVP_METRIC_GAPS`）；不自动宣称 design 08 阶段 A 已关闭。

## M1 — 真实模型簇（可选）

**目标**：对齐 design 02/03/05/06/07/08，接通真实 ModelPort 相邻完整簇；**非**「换 Stub + env Key」最小接入。

**计划**：[sessions/0018-real-model-cluster-plan.md](sessions/0018-real-model-cluster-plan.md)

**实现顺序**（M1a–M1h）：

```text
M1a  contracts：ContextBuildRecord；Manifest.modelPolicy / contextBuilder；
     model.called|responded 载荷（modelCallId、usage、priceTableVersion）
M1b  runtime：BudgetGuard（maxSteps / maxTokens / maxCost / maxWallTime）
M1c  runtime：Context Builder（05 优先级 + ContextBudget；Knowledge 空）
M1d  Engine：Model Policy + 同 Step 重试/fallback（新 modelCallId）
M1e  SecretPort 最小实现（模型凭证 lease）
M1f  ModelPort 真实 adapter
M1g  observability：Token/cost + Context overflow 指标
M1h  harness 装配；Eval / Golden 仍 StubModelPort
```

**第一刀**：M1a contracts 类型 + M1b BudgetGuard 接入 `execute_turn` 循环头部。

**退出条件**：

- [x] BudgetGuard 在调用模型前检查 step/token/cost/wall；不足则 Step 失败、不调模型
- [x] Context Builder 按 05 装配/裁剪；每次 `context.built` 持久 `ContextBuildRecord`
- [x] 冻结 Manifest 含 `modelPolicy { version, resolvedTargets[] }` / `contextBuilder` digest
- [x] `model.called` / `model.responded` 含 usage + 价表版本；失败调用也计入
- [x] SecretPort lease 注入 adapter；密钥不进 Context / Event 明文
- [x] 真实 ModelPort 可按 resolvedTarget 调供应商并返回结构化候选
- [x] Token/cost 可从 Event+usage+价表重算；Context overflow 可统计
- [x] harness 可切换真实 ModelPort + SecretPort；Eval 114 仍 stub 绿

**非目标**：KnowledgePort 实装；Memory 进 Context；用真实模型跑 Eval；ConfirmationGrant；DAG/spawn_child/sandbox.exec；宣称阶段 A 仅因接供应商而关闭。

## M2 — Agent Loop 增强

**目标**：对齐已修订的 design 01/03/05 与 engineering 04，完成模型决策 → 批次工具 → 对话 Context → 可演示的 Session 闭环。

**计划**：[sessions/0019-post-m1-agent-loop.md](sessions/0019-post-m1-agent-loop.md)

**实现切片**（M2a–M2e）：

```text
M2a  contracts：Action.calls[]；DialogueTurn / ModelMessage / ContextCompressionRecord
M2b  runtime：function-catalog → ModelDecision → map-decision / hydrate-action
M2c  runtime：evaluate-policy 按条；prepare-tool-calls 扇出；project-approval；Step 闭合
M2d  runtime：build-model-context（projectDialogue → compress → projectModelMessages）
M2e  harness：demo-session / SessionDemoObserver / FsWorkspace；pnpm demo:session
```

**退出条件**：

- [x] ModelPort 返回 `ModelDecision`，Engine 映射为 Action（控制 XOR 领域批次）
- [x] 单 Action 可 prepared N 条 ToolCall；Policy 按条判定；Step 等兄弟终态
- [x] Context Builder 产出 `ModelMessage[]`；超阈值写 `context.summary_created`
- [x] Session CLI 多轮（同 sessionId，每消息新 Run）归档到 `temp/demo-sessions/<sessionId>/`
- [x] Eval 114 仍 stub 绿；密钥仍只经 SecretPort

**非目标**：KnowledgePort 实装；Memory 进 Context；ConfirmationGrant；`atomic` / `dependencies` 依赖图执行。

## 阶段与测试层映射

| 阶段 | 最低测试层 |
| --- | --- |
| P0 | `check-types` / 空 build |
| P1 | L0 + 部分 L1 |
| P2 | L1 双投递；争取 L2 |
| P3–P5 | L0 + L1 |
| P6 | L1 + L2 故障注入 |
| P7 | L3 Eval 接线 |
| P8 | L2 真实单库 + HTTP 集成 |
| P9a | L0 Registry + L1 路径防逃逸 + Golden 6×5 |
| P9b | L3 Eval 完整控制面矩阵 |
| P9b-sec | L3 安全 8×1 零容忍 |
| P9d | L0 角色解析 + L1-on-PG CreateRun 循环 |
| M1 | L0 BudgetGuard/Builder + L1 真实模型端到端（Eval 仍 stub） |
| M2 | L0 投影/决策/并行 prepared 单测 + L1 工具链 + harness session demo |

详见 [engineering/05](../engineering/05-testing-and-evolution.md)。
