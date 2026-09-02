# 进展：packages/contracts

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/contracts/` |
| 状态 | `done`（M2a） |
| 首触阶段 | P0–P1；M1a 模型 Event 载荷；M2a Dialogue / Action.calls[] |
| 上游 | [design/01](../../design/01-domain-model.md)、[design/05 §3.1.1 Dialogue 投影](../../design/05-context-and-data.md#311-dialogue-投影与-modelview实现)、[engineering/01](../../engineering/01-repository-and-modules.md) |
| 最后更新 | 2026-09-02 |

## 1. 范围

- 01 核心对象的 TypeScript 类型 / Zod 镜像
- eventType 常量、错误 category、Action canonicalization 契约类型
- GovernanceEvent 相关类型（可与 Run Event 分模块）
- **零** runtime/ports/infra 依赖

**CommitPlan / CommitResult / HarnessCommand** 在 [`ports`](./ports.md)，不在本包。

## 2. 非目标

- 持久化实现
- Reducer / Policy 算法（属 runtime）

## 3. 验收清单

- [x] 包可独立 `build` / `check-types`
- [x] Run / EventEnvelope / EventCandidate / IdempotencyRecord / OutboxRecord 等 P1 核心类型落地
- [x] `schemaVersion` 与未知字段拒绝：`strictObject` + Zod（EDR-008）
- [x] Action / Observation / FactEnvelope / RunState + TURN_EVENT_TYPES（P3）
- [x] ToolCallRecord + TOOL_EVENT_TYPES（P4）
- [x] ApprovalRecord / Checkpoint / Continuation + APPROVAL_EVENT_TYPES（P5）
- [x] `AcceptanceCheck` 类型（finish 门禁；无独立 Event type，结果写入 `action.accepted` / `action.rejected` payload）
- [ ] Action digest 向量测试可挂此包或 runtime（runtime 已有 MVP digest）
- [ ] ConfirmationGrant 类型（后置）

### M1（完成 — [0018](../sessions/0018-real-model-cluster-plan.md)）

- [x] `ContextBuildRecord` 类型（modelPolicy digest、contextHash、truncations）
- [x] 冻结 Manifest：`modelPolicy { version, resolvedTarget, fallbackTarget }` / `contextBuilder` digest
- [x] `model.called` / `model.responded` 载荷：`modelCallId`、usage、priceTableVersion
- [x] 价表版本引用（`STATIC_PRICE_TABLE` 冻结；费用 unknown 可单列）

### M2（完成 — [0019](../sessions/0019-post-m1-agent-loop.md)）

- [x] `Action.calls[]` 批次形状（`tool.call` N≥1；顶层 `toolId` 仅 N=1 兼容）
- [x] `DialogueTurn` / `ModelMessage` / `ModelMessageToolCall`（`dialogue.ts`）
- [x] `ContextCompressionRecord` / `contextProjectionPolicy`（摘要与 recent/history 窗口策略）
- [x] `context.summary_created` Event type 常量

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| EDR-008 | Accepted：Zod |
| zod | catalog |

## 5. 缺口与风险

- ConfirmationGrant 尚未建模
- Action digest 算法为 MVP stable-json，非完整 01 §8.1 规范向量

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-09-02 | M2a：`Action.calls[]`、`dialogue.ts`（DialogueTurn / ModelMessage / ContextCompressionRecord） |
| 2026-08-28 | M1a 实装完成：ContextBuildRecord、Manifest modelPolicy、Event usage / priceTable |
| 2026-08-28 | M1a 计划：ContextBuildRecord、Manifest modelPolicy、Event usage；见 0018 |
| 2026-08-27 | `AcceptanceCheck` / selector 类型 |
| 2026-08-27 | P5：ApprovalRecord / Checkpoint / Continuation + approval.* events |
| 2026-08-27 | P4：ToolCallRecord / effect contract；tool.* events |
| 2026-08-27 | P3：Action/Observation/Fact/State + turn event types |
| 2026-08-27 | P1：Run/Event/Error/Records + Zod strict |
| 2026-08-27 | 创建进展页 |
