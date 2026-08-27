# 03 · 持久化与事务

> 上游：[02-runtime-composition](./02-runtime-composition.md)  
> 设计依据：[01](../design/01-domain-model.md)、[02](../design/02-core-architecture.md)、[03](../design/03-run-lifecycle.md)、[05](../design/05-context-and-data.md)  
> 相关 EDR：EDR-003、EDR-004、EDR-005、EDR-006、EDR-009、EDR-013

## 1. 目标

固定首版 **存储拓扑、提交算法、原子事务清单、Outbox/Queue/Lease、恢复** 的实现语义。产品级 SQL 方言以 EDR-005（PostgreSQL Accepted）为默认叙述；若更换存储，须保持同等 CAS / 事务能力。

SQL 访问层为 **EDR-009 Accepted：drizzle-orm**；事务边界只留在 persistence adapter。本文仍以端口行为与表族职责为主，不展开 schema 迁移细节。

## 2. 存储拓扑

### 2.1 单库表族（Accepted：PostgreSQL）

```text
┌──────────────────────────────────────────────────────────────┐
│                     Single authoritative store                │
├─────────────┬─────────────┬──────────────┬───────────────────┤
│ run_kernel  │ event_log   │ side_records │ delivery          │
│ runs        │ events      │ tool_calls   │ outbox            │
│ steps       │ (append)    │ approvals    │ idempotency       │
│ state       │             │ artifacts_meta│ leases           │
│ checkpoints │             │ sessions     │ queue_messages*   │
│ continuations│            │ manifests*   │                   │
└─────────────┴─────────────┴──────────────┴───────────────────┘
* manifests 可用 JSONB 或 ObjectStore 不可变 blob + hash
* queue_messages 为内联 Queue 投影；换外部队列后可缩小职责
```

### 2.2 不进入 Run 真相库（或独立表族）的对象

| 对象 | 位置 | 说明 |
| --- | --- | --- |
| Artifact / 大载荷正文 | ObjectStore | DB 仅元数据 + hash + ref |
| Secret 值 | SecretPort 后端 | 永不进 Event 明文 / State |
| GovernanceEvent | 独立治理流/表 | append CAS；与 Run Event 非跨流原子（EDR-013） |
| Evaluation 结果 | Evaluation Store | 不回写生产 State（EDR-013） |
| Memory 正文 | MVP 关闭 | 表可预留但不接入 Context |

## 3. 提交算法

每次可变提交由 Engine 组装 `CommitPlan`，适配器执行：

```text
1. BEGIN
2. 获取 Run 级互斥（`runs` 行 SELECT … FOR UPDATE）  # EDR-006 Accepted
3. 读取当前 revision、leaseEpoch、max(sequence)
4. 校验 expectedRevision、expectedLeaseEpoch（及命令前置状态）
5. 按 eventOrderingVersion 已排好的候选分配连续 sequence
6. INSERT events；UPSERT 投影（run/step/state/tool_call/approval/...）
7. 同事务 INSERT outbox / idempotency（若计划包含）
8. revision := revision + 1（整次事务只一次）
9. COMMIT 成功才对外可见；否则全部回滚
```

冲突映射：

| 条件 | 错误 category |
| --- | --- |
| revision 不匹配 | `conflict` |
| leaseEpoch 不匹配 / 租约失效 | `lease_lost` |
| 幂等键同键不同 requestHash | `conflict` |
| Event 完整性 / 必需依赖不可用 | `fatal` 或提交 failed 转换 |

**硬规则**：Model、Hook、Tool、外部 HTTP **不得** 在步骤 1–9 的打开事务内执行。

## 4. CommitPlan 概念形状

```text
CommitPlan {
  expectedRevision
  expectedLeaseEpoch
  events[]                  # EventCandidate；无自分配 sequence
  runPatch?
  steps[]?
  state?
  stateHash?
  toolCalls[]?
  approvals[]?
  confirmationGrants[]?
  idempotency[]?
  outbox[]?
  checkpoint?
  continuation?
  artifactsMeta[]?
  childRunLinks[]?          # MVP 不启用写入路径
}

CommitResult =
  | { ok: true, revision, sequences[] }
  | { ok: false, code: conflict | lease_lost | integrity | ... }
```

Event 候选在进入 UoW 前由 Engine 按设计 03 的生命周期阶段顺序排列；适配器 **只** 分配序号并持久化。

## 5. 原子事务清单（UoW）

### 5.1 创建与调度

| ID | 触发 | 同事务必须包含 |
| --- | --- | --- |
| `UoW-CreateRun` | `create_run` | Run(`created`) + `run.created`(seq 起点) + Idempotency(`create_run`) + Outbox(QueueRun) |
| `UoW-QueueRun` | `queue_run` | `run.queued` + status→queued + revision++ |
| `UoW-AcquireLease` | `acquire_lease` | leaseEpoch++ + lease 行 + `run.lease_acquired` + status→running |
| `UoW-ReleaseLease` | 等待/暂停/失效 | `run.lease_lost` 或等价原因 + status→queued + 清 owner |

禁止：`created → running`、等待态直接 `→ running`。

### 5.2 Step 推进

| ID | 阶段 | Event 顺序要点 |
| --- | --- | --- |
| `UoW-StepStart` | 开始 Step | `step.started` |
| `UoW-ModelCycle` | 推理记录 | `context.built` → `model.called` → `model.responded` → `action.proposed` |
| `UoW-ActionGate` | 门禁 | `policy.evaluated`〔→ `policy.denied`〕→ `action.accepted`/`rejected` |
| `UoW-WaitApproval` | 等待审批 | ApprovalRecord + `approval.requested` + Checkpoint + Continuation + 释放 lease |
| `UoW-WaitInput` | 等待输入 | 输入要求 + Checkpoint + Continuation + 释放 lease |
| `UoW-FactReduce` | 归约 | **`observation.recorded` → `fact.accepted`/`rejected` →〔`state.reduced`〕** |
| `UoW-Checkpoint` | 检查点 | `checkpoint.saved` + checkpoint 行（可与上一 UoW 合并） |

`observation.recorded` 必须在对应 `fact.*` 之前，可同事务但 sequence 不可颠倒。

### 5.3 Tool 副作用

| ID | 时机 | 同事务内容 |
| --- | --- | --- |
| `UoW-ToolPrepared` | PreToolCall 通过后 | 〔`approval.consumed`〕+ ToolCallRecord(`prepared`) + Idempotency(`tool_call`) + `tool.call_prepared` + Outbox(DispatchTool) |
| `UoW-ToolDispatched` | Adapter 接受派发 | `tool.dispatched` + status→dispatched |
| `UoW-ToolTerminal` | 权威结果 | `tool.succeeded`/`failed` + 随后 Observation/Fact UoW |
| `UoW-ToolUnknown` | 无权威结果 | `tool.outcome_unknown` + Step→reconciling |
| `UoW-ToolReconciled` | 对账完成 | `tool.reconciled` + 终态 + Observation 链 |

PreToolCall veto：**不** 进入 `UoW-ToolPrepared`，**不** 消费 ApprovalRecord。

### 5.4 唤醒与终态

| ID | 内容 |
| --- | --- |
| `UoW-Wake` | 审批通过 / 有效输入 / resume → 领域 Event + status→queued + Outbox |
| `UoW-Finish` | acceptanceChecks 通过 + `run.completed` + 最终 Checkpoint；无未解决 `outcome_unknown` |
| `UoW-Fail` / `UoW-Cancel` | 设计 03 §2.4 唯一原因映射 + 最终 Checkpoint |

终态后允许追加遗留对账 / retention 审计 Event，但 **不得** 改 Run status 或恢复 Step。

## 6. Outbox、内联 Queue、补偿（EDR-004）

```text
领域事务 COMMIT
  → Dispatcher claim outbox (SKIP LOCKED 或等价)
  → QueuePort.enqueue({ runId, revision, messageType, dedupeKey })
  → mark outbox published
  → Scheduler lease queue message
  → Engine.handle(queue_run | ...)
  → ack / nack
```

规则：

1. Outbox 投递状态 **不是** Run 真相。  
2. Queue 至少一次；重复消息：revision 落后则 ack；同 revision 由 Engine `expectedRevision` 消除。  
3. **补偿扫描**：查找 `created` 过久未 `queued`、或 outbox 未 published 的 Run，重建同一 `{runId, revision}` 信号，不创建新 Run。  
4. MVP 可用 DB 表模拟 Queue；换成 Redis/SQS 时不改 Command 与 Event 语义。

## 7. Lease 与 fencing

```text
lease {
  runId, ownerId, leaseEpoch, acquiredAt, expiresAt, lastHeartbeatAt
}
```

| 规则 | 说明 |
| --- | --- |
| 取得/接管 | 与 `leaseEpoch++`、`run.lease_acquired` 同 UoW |
| heartbeat | TTL 的 1/3 以内；不递增 epoch；owner+epoch 必须匹配 |
| 失效 | 扫描经 Engine 提交 running→queued；新 worker 再 acquire |
| 派发 | 携带 `dispatchLeaseEpoch`；派发前复核；不匹配则 `lease_lost` |
| 迟到结果 | 旧 epoch 不得权威成功；对账 Observation |

`revision` 与 `leaseEpoch` 缺一不可。

## 8. 恢复实现要点

```text
on acquire_lease success:
  verify Manifest hash
  select latest Checkpoint where sequence <= event_tail
    and revision consistent
  replay events (checkpoint.sequence+1 .. tail) through Reducer
  rebuild strategy cursor / Continuation
  inventory ToolCallRecords needing dispatch or reconcile
  if status in waiting|paused: do not execute_turn
  else: continue light loop under current lease
```

校验失败（Manifest 不可解析、Event 缺口、Checkpoint 越界）→ 按设计提交 `failed`，禁止静默换版本继续。

无 Checkpoint 时必须能从 `run.created` 全量重建（性能可差，语义必须正确）。

## 9. 索引与并发（建议）

| 表族 | 关键约束/索引 |
| --- | --- |
| events | `UNIQUE(tenant_id, run_id, sequence)` |
| runs | `(tenant_id, status, updated_at)`；主键/唯一 `run_id` |
| outbox | 部分索引 `(status, available_at)` where pending |
| leases | `UNIQUE(run_id)` |
| idempotency | `UNIQUE(namespace, tenant_id, dedupe_key)` |
| tool_calls | `(run_id, status)` |

所有查询带 `tenant_id` 过滤（安全设计 06）。

## 10. Governance 与 Run Event 关联

Retention 等可能同时需要：

1. GovernanceEventEnvelope（治理流 append CAS）  
2. 同源 Run Event（由 Engine 追加到该 Run）

两者 **不宣称跨流原子**；用稳定 `correlationId` + 受控 Outbox/重试关联。失败时允许治理流已写而 Run Event 延迟补齐，查询层须容忍短暂不对称并提供重试。

## 11. 一致性检查

- [ ] Persistence 与 Outbox 同 UoW（EDR-003）
- [ ] 外部 IO 不跨事务
- [ ] UoW 清单覆盖 CreateRun、Tool prepared、Approval consume、Fact 顺序、Wake、Terminal
- [ ] 内联 Queue 具备至少一次与补偿扫描
- [ ] PostgreSQL / 锁 / ORM 状态与 EDR 一致（Proposed/Deferred 未伪装 Accepted）
- [ ] 未把 Checkpoint 定义为真相源

---

上一篇：[02-runtime-composition.md](./02-runtime-composition.md) · 下一篇：[04-ports-extensions-and-security.md](./04-ports-extensions-and-security.md)
