# 通用 Agent Harness 设计文档

本目录是**架构评审用设计文档集**，定义通用服务端 Agent Harness 的对象、控制流、扩展、安全、数据、观测、评测与演进契约。文档不包含代码、工程骨架、SDK 实现或基础设施产品选型。

实现选型、包边界与 MVP-0 落地映射见 [docs/engineering](../engineering/README.md)。

## 文档导航

| 序号 | 文档 | 摘要 |
| --- | --- | --- |
| 00 | [设计总览与决策索引](./00-overview.md) | 目标与非目标、质量属性、系统上下文、核心不变量、模型/Harness 决策边界与 ADR 唯一索引 |
| 01 | [统一术语与核心对象](./01-domain-model.md) | 全集术语唯一来源；定义 EventEnvelope、Observation、FactEnvelope、State、Execution Manifest、ToolEffectContract、ApprovalRecord、Child Run 与所有权 |
| 02 | [Harness 总体架构](./02-core-architecture.md) | Engine 唯一编排与提交协调、候选返回边界、Outbox/Queue/Scheduler 投递链、端口、依赖和部署映射 |
| 03 | [执行循环、状态机与恢复](./03-run-lifecycle.md) | Run/Step 状态机、五个 Hook 点、副作用与对账、revision/leaseEpoch、Checkpoint 恢复、DAG 并发与 Child Run 总体契约 |
| 04 | [业务扩展协议](./04-extension-model.md) | Capability Pack Manifest、组件契约、权限交集、Policy 偏序、隔离与注册生命周期，以及文档研究/工单 Pack 样例 |
| 05 | [上下文、状态、知识与记忆](./05-context-and-data.md) | Observation/Fact/State 接受链、Context Builder、Knowledge、Memory、Artifact、Session、敏感级、保留与删除 |
| 06 | [安全、权限与控制面](./06-safety-and-control.md) | 信任边界、权限/Policy/Approval、Tool 出口、租约 fencing、Prompt Injection、Secret、Sandbox、数据保护与威胁模型 |
| 07 | [可观测性与评测闭环](./07-observability-and-evaluation.md) | EventEnvelope 单一关联、Trace/Metrics 派生、回放等级、指标规范、Eval Suite、样本策展与统一回归门禁 |
| 08 | [MVP 能力边界与演进路线](./08-mvp-and-evolution.md) | 通用工作区 MVP 垂直切片、完整验收矩阵、禁用能力及阶段 A–G 的量化进入、退出与回滚条件 |

章节页脚形成连续导航：[00](./00-overview.md) → [01](./01-domain-model.md) → [02](./02-core-architecture.md) → [03](./03-run-lifecycle.md) → [04](./04-extension-model.md) → [05](./05-context-and-data.md) → [06](./06-safety-and-control.md) → [07](./07-observability-and-evaluation.md) → [08](./08-mvp-and-evolution.md) → 本 README。

## 参考阅读

以下资料用于理解领域实践，不属于本设计的规范性契约：

- [淘宝主播 Agent 的 Harness 工程实战](../references/淘宝主播Agent的Harness工程实战.md)
- [百亿补贴 C 端 AI Coding 实战](../references/百亿补贴%20C%20端%20AI%20Coding%20实战：端到端%20CodingAgent%20设计与实践.md)

## 已确认前提

- 运行形态：服务端 API、统一异步 Run；同步等待只是客户端订阅封装
- 首个场景：中性通用工作区任务
- 扩展方式：业务不进入 Core，经版本化 Capability Pack 与 Adapter 接入
- 技术中立：不绑定语言、框架、Monorepo、数据库、中间件或部署产品
- MVP 边界：只启用 light Strategy 与通用工作区垂直切片；DAG、Memory、Child Run、多 Agent、语义路由、`sandbox.exec` 和真实 `write_high` 均不启用

## 跨文档稳定约束

1. **术语唯一来源**：01 是术语、对象、标识符、字段、状态与核心契约的唯一定义来源；其他章节只引用和展开，不建立同名语义。
2. **Engine 所有权**：Engine 是 Run 生命周期和 Step 的唯一编排者，也是 Event 顺序、Run、State、Checkpoint、ToolCallRecord、ApprovalRecord 等可变记录的唯一提交协调者；其他组件只返回命令、候选、判定、贡献或 Observation。
3. **Event 与 Checkpoint**：EventEnvelope 是 Run 审计、回放和可观测关联根，单 Run `sequence` 严格递增；未绑定 Run 的控制面操作使用 GovernanceEventEnvelope。所有 Run 可变提交校验 `expectedRevision + leaseEpoch`。Checkpoint 绑定 revision、sequence、State hash、strategy cursor 与不可变 Continuation，只加速恢复。
4. **Observation、Fact 与 State**：Tool、Hook 和用户输入先成为 Observation，经 Schema、权限和业务验证形成 FactEnvelope；State 只由纯函数 Reducer 消费 FactEnvelope 计算。模型输出、Hook contribution、Event payload 和裸 Tool 结果不能直接写 State。
5. **Hook 边界**：五个 Hook 点的时序与失败语义以 03 为准；Hook 只返回 Context contribution、veto 或 Observation，不改 Action、不调用 Tool、不写 State、不分配 Event `sequence`。
6. **Tool 与副作用**：Tool 统一使用 `toolId` 和 ToolEffectContract；有副作用调用必须将 ToolCallRecord、IdempotencyRecord 与 OutboxRecord prepared-before-dispatch，恢复和重派复用相同逻辑调用与幂等键，`outcome_unknown` 必须对账，补偿不能替代幂等或对账。
7. **权限与审批**：有效权限逐层取交集，Policy 按 `allow < require_approval < deny` 只增严；ApprovalRecord 绑定 `actionDigest`、资源、主体、TTL 与冻结版本，最多消费一次，并与 ToolCallRecord `prepared` 原子提交。`confirm_once` 只使用受限、版本化的 ConfirmationGrant，不能替代 Policy 要求的审批。等待态只唤醒到 `queued`。
8. **冻结依赖与数据保护**：Execution Manifest 固定 Run 使用的 Agent、Pack、Skill、Workflow、Hook、Tool、Prompt、Action Schema、Policy、Model、Strategy、Context Builder、Reducer、Validator、Evaluator 与 Knowledge 版本和摘要；敏感及大载荷外置，Secret 只经 SecretPort 注入执行边界，删除后以 Tombstone 与治理审计链保留证据。
9. **Trace 与 Evaluation**：Trace、日志视图、Metrics 与 Evaluation 样本由已提交 Event 和只读领域记录派生；Evaluator 不替代 Validator、Policy、Approval 或 required `acceptanceChecks`，观测下游不拥有生产推进权。
10. **MVP 与复杂能力**：MVP 仅实现 08 定义的通用工作区垂直切片。DAG、Memory、Child Run 等能力保留统一契约，但只能满足 07 指标和 08 量化门禁后按独立 Manifest、Eval Suite 与 canary 边界启用。
11. **ADR 唯一索引**：ADR 的标识、决策文本与状态只在 [00 第 8 节](./00-overview.md#8-关键架构决策adr-索引) 维护；其他章节只引用该索引，不重复声明决策表。

## Capability Pack 场景验证（协议样例）

详见 [04-extension-model.md 第 8 节](./04-extension-model.md#8-两个-capability-pack-的协议验证)。下列内容只验证扩展协议的表达能力，不表示 Pack 或 Adapter 已实现。

| Pack 样例 | 契约构成 |
| --- | --- |
| 文档研究 | Workspace 搜索/读取、Markdown Artifact 写入、固定规则 Workflow、引用与 Artifact Validator、受 allowlist 限制的 Web 读取、Knowledge Source、Evaluator 与 Eval Suite |
| 工单处理 | 工单读取/字段更新/状态迁移 Tool、PreToolCall 状态迁移 Hook、`write_high` 至少 `require_approval` 的 Policy、SLA Knowledge、状态迁移 Validator、隔离 Adapter、SecretPort 与结果对账 |

两个样例均复用标准 Skill、Tool、Workflow、Hook、Policy、ApprovalRecord、ToolCallRecord、Observation、FactEnvelope、Reducer、Event Log、Validator 与 Evaluator 契约，不引入业务专用 Core 状态或 Action 类型。

## 架构评审条件

评审结论成立需同时满足：

1. 每个核心对象具有明确职责、所有者、生命周期、并发语义、关联和禁止项（01）。
2. 每个核心模块具有输入、输出、依赖、失败方式和扩展边界，且没有绕过 Engine 的推进路径（02）。
3. 创建、排队、执行、等待、失败、审批、取消、恢复、迟到结果与对账路径闭合（03）。
4. 模型与 Harness 的决策边界明确，模型输出不充当授权、执行结果或 State 事实（00）。
5. 新业务域只增加 Capability Pack、受限实现与 Adapter，不改变 Core 对象、状态机和 Event 语义（04、08）。
6. State、Context、Knowledge、Memory、Event、Checkpoint 与 Artifact 的职责和形成路径互不替代（01、05）。
7. 安全覆盖副作用、权限、租户、审批、密钥、Sandbox、幂等、租约、外发、审计与删除（06）。
8. Trace、Metrics 和 Evaluation 可从 Event 重建；回归门禁能够判定安全、控制、质量、恢复、成本和延迟退步（07）。
9. MVP 启用项、禁用项、验收矩阵与阶段演进条件可执行，并与 07 的指标和阈值一致（08）。
10. ADR 仅在 00 建立索引，假设与能力引入不覆盖 07/08 的量化门禁。
11. 全集不包含未经论证的技术栈、目录结构或部署产品结论。

## 建议阅读顺序

1. 00 → 01：明确边界、决策与唯一术语
2. 02 → 03：理解架构所有权、控制流、状态机与恢复
3. 04：理解 Capability Pack 和业务接入协议
4. 05 → 06 → 07：理解数据、安全、观测与评测横切契约
5. 08：确认 MVP 边界、验收门禁与演进条件
6. 回到本 README 核对跨文档稳定约束和架构评审条件

---

开始阅读：[00-overview.md](./00-overview.md)
