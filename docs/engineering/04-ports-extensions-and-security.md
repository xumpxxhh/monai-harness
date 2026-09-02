# 04 · 端口、扩展与安全装配

> 上游：[03-persistence-and-transactions](./03-persistence-and-transactions.md)  
> 设计依据：[02](../design/02-core-architecture.md) §7、[04](../design/04-extension-model.md)、[06](../design/06-safety-and-control.md)、[08](../design/08-mvp-and-evolution.md)  
> 相关 EDR：EDR-007、EDR-008、EDR-010、EDR-013、EDR-014

## 1. 目标

将设计层端口与扩展协议映射为 TypeScript 包中的 **接口族、装配规则、ExecutionContext、MVP 禁用能力**，保证 Core 可测、Pack/Adapter 可替换、安全边界可 enforce。

## 2. Ports 包映射

`packages/ports` 只含接口与 DTO，无 IO 实现。与设计 02 §7 对齐：

| 端口 | 工程职责摘要 |
| --- | --- |
| `PersistencePort` | `beginUnitOfWork`、加载聚合、按 sequence 读 Event；commit 见 [03](./03-persistence-and-transactions.md) |
| `OutboxPort` | 事务内 append；事务外 claim/publish/mark；按 dedupeKey 去重 |
| `QueuePort` | enqueue / lease / ack / nack；载荷至少 `runId + revision` |
| `LeasePort` | acquire / heartbeat / validate / release；acquire 返回新 epoch |
| `ExecutionManifestStorePort` | 不可变 put/get；hash 校验 |
| `IdempotencyPort` | 条件创建/查询；可并入 Persistence UoW |
| `ModelPort` | `completeStructured(context, controlFunctions, domainTools, modelPolicy)` → 厂商中立 `ModelDecision`；adapter 翻译 tool-call 线格式 |
| `KnowledgePort` | 按 sourceId/version/权限/预算返回带 provenance 片段 |
| `WorkspacePort` | list/read/write/search；写仅受控 Tool |
| `ObjectStorePort` | put/get/signedRef；内容哈希与租户隔离 |
| `SandboxPort` | 接口保留；**MVP 不挂载可执行实现** |
| `SecretPort` | 短时凭证注入；值不进 Context/Event/State |
| `EventStreamPort` | 从已提交 sequence 游标读取/推送 |
| `EvaluationPort` | 样本提交与评测任务；不改生产门禁 |
| `ApprovalPort` / `ToolCallPort` | 查询与候选辅助；**状态仍由 Engine 提交** |

可选细粒度只读仓储（EventStore、RunRepository 等）可作为 `PersistencePort` 的内部拆分，不改变唯一提交者。

### 2.1 选型状态

| EDR | 议题 | 状态 / 约束 |
| --- | --- | --- |
| EDR-007 | HTTP/SSE 框架 | Accepted：Hono（REST + SSE）；api 包不得获得 Persistence 写权 |
| EDR-008 | Schema：Zod | Accepted；须支持 schemaVersion、未知字段拒绝、与 Manifest digest |
| EDR-009 | SQL：drizzle-orm | Accepted；不得把事务边界泄漏给 Engine 调用方 |
| EDR-010 | isolated_extension 载体 | Deferred；MVP 可仅 `trusted_builtin` in-process |

## 3. Pack SDK 与 Registry

### 3.1 `pack-sdk`

向 Pack 作者暴露：

- 贡献对象的类型（对齐设计 04 Manifest）
- Tool/Hook handler 签名
- 构造/消费 capability-scoped `ExecutionContext` 的辅助类型
- Schema 校验钩子（具体库 Deferred）

**禁止** 向 Pack 暴露：Persistence 客户端、Event append、Approval Store、任意 Secret 客户端、Engine 句柄。

### 3.2 Extension Registry（位于 `runtime`）

```text
register(pack) → validate → PackRegistrationResult
resolve(agentDefinition) → ExecutionManifest (immutable)
```

校验至少包括：命名空间、摘要、依赖锁、`coreContractRange`、权限子集、Policy 偏序、HookResult 边界、ToolEffectContract 完整性。  
权限超限 → 拒绝注册，禁止静默删权降级（设计 04/06）。

Run 创建后只使用冻结 Manifest；禁止热切换实现摘要。

## 4. ExecutionContext

每次 Tool/Hook 调用获得独立、短时上下文（设计 04 §4.2 / 06 §3.3）：

```text
ExecutionContext {
  tenantId, sessionId, runId, stepId?
  executionManifestRef
  principalRef
  effectivePermissions[]
  resourceScope
  deadline
  leaseEpoch?
  ports {
    workspace?
    objectStore?
    knowledge?
    secretLease?
    sandbox?          # MVP：不注入可执行 sandbox
    telemetry?
  }
}
```

规则：

1. 端口句柄不可持久化或转交其他扩展。  
2. Hook 只返回 Context contribution / veto / Observation。  
3. `trusted_builtin` 仍受声明权限与审计约束；`isolated_extension` 必须独立隔离边界（载体 EDR-010 Deferred）。

## 5. Adapter 装配

`apps/harness` bootstrap 将 adapters 绑到 ports：

| MVP 建议适配器 | 说明 |
| --- | --- |
| `persistence-*`（PG Proposed） | 含 Outbox + Idempotency 同 UoW |
| `queue-*` / 内联 | 满足 QueuePort；可与 DB 投影一体 |
| `lease-*` | 与 Run.leaseEpoch 协作 |
| `model-*` | 结构化输出；密钥经配置/Secret，不进 Context |
| `workspace-*` | 授权根路径防逃逸 |
| `objectstore-*` | Artifact 正文 |
| `knowledge-http` | RAG `POST /api/v1/search` 客户端（Tool 后端；非 KnowledgePort） |
| `secret-*` | 可 stub；禁止明文落 Event |
| `sandbox-stub` | 仅占位，拒绝 exec |
| `synthetic-sink` | `synthetic.write_high` + reconcile |

Adapter 不得实现领域状态机，不得在回调里直接 `revision++`。

## 6. Schema、Canonicalization、Manifest

| 主题 | 工程要求 |
| --- | --- |
| schemaVersion | 所有对外契约字段存在；未知字段默认拒绝 |
| Action digest | 实现设计 01 §8.1（JCS、NFC、路径/资源/ref 规范化、sha-256）；审批与派发共用版本集 |
| Execution Manifest | 创建 Run 时解析冻结；存储不可变 blob + hash；恢复必须校验 |
| ContextBuildRecord | 记录实际选入子集与版本证据；敏感正文外置 |
| 错误 | `code/category/retryable/...`；映射到 HTTP 状态的表可在 api 包维护，但不改 category 语义 |

具体 Schema 运行时库见 EDR-008 Accepted（Zod）。

## 7. 安全装配要点

装配层必须落实设计 06，而非仅文档声明：

1. **权限交集**：platform ∩ tenant ∩ agent allowlist ∩ pack ∩ tool/hook。  
2. **Policy 偏序**：`allow < require_approval < deny`；后层只增严。  
3. **Approval**：`actionDigest` + 版本 + TTL；consumed 与 prepared 同 UoW。  
4. **ConfirmationGrant**：不能替代 Policy `require_approval`。  
5. **Secret**：只经 SecretPort 在执行边界注入。  
6. **路径/资源规范化**：Workspace Tool 防 `..`、symlink、设备路径等（08 MVP）。  
7. **失败关闭**：安全判定或必需审计不可用时不得默认放行。  
8. **观测只读**：Metrics/Eval 下游不可用不影响已提交 Event。

## 8. MVP 禁用能力（EDR-014）

| 能力 | 装配要求 |
| --- | --- |
| DAG Strategy | `strategy/dag` 不注册；Agent 默认 `light` |
| Child Run / `spawn_child` | Action Schema 拒绝或 feature flag 关闭执行路径 |
| Memory 检索/晋升 | ContextBuilder 不读取 Memory；晋升流程不挂载 |
| 向量/语义 Knowledge | KnowledgePort MVP 实现仅精确/规则 |
| 自动 Knowledge 写回 | 无写回 Tool/Hook 注册 |
| `sandbox.exec` | SandboxPort stub；allowlist 不得引用 |
| 真实 `write_high` | 仅 `synthetic.write_high` 在测试租户；默认 deny 真实外部写 |
| 多 Agent 共享 State | 不提供旁路；阶段 G 前不启用 |

禁用能力不得通过 Tool 别名、Hook、Pack 后台任务、模型文本或 Adapter 旁路启用。架构测试应抽检 Registry 与 allowlist。

## 9. MVP Pack：`workspace-generic`

对应设计 08 Tool 集合：

```text
workspace.list
workspace.read
workspace.search
workspace.write
artifact.write_markdown
artifact.validate
synthetic.write_high
synthetic.write_high.reconcile
```

另含：固定规则 Knowledge、required acceptanceChecks 用 Validator、最小 Policy、五个 Hook 点的最小实现（可为 no-op 但可观测）。

文档研究 / 工单 Pack 仅作协议样例，**不** 作为 MVP 必装包。

## 10. 一致性检查

- [ ] ports 无 infra import
- [ ] Pack 拿不到 Persistence/Engine 写接口
- [ ] ExecutionContext 端口按调用裁剪
- [ ] Manifest 冻结与 digest 校验路径存在
- [ ] EDR-014 禁用项在 Registry/feature flag 可验证
- [ ] Deferred 选型未写成强制依赖

---

上一篇：[03-persistence-and-transactions.md](./03-persistence-and-transactions.md) · 下一篇：[05-testing-and-evolution.md](./05-testing-and-evolution.md)
