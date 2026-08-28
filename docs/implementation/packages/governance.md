# 进展：packages/governance

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/governance/` |
| 状态 | `done`（P9c 最小面） |
| 首触阶段 | P9c |
| 上游 | [design/01 §5.2](../../design/01-domain-model.md)、[engineering/01](../../engineering/01-repository-and-modules.md)、EDR-013 |
| 最后更新 | 2026-08-28 |

## 1. 范围

- Pack 注册 GovernanceEvent（`pack.registered` / `pack.registration_rejected`）
- `InMemoryGovernanceEventStore`（append CAS + 按 stream sequence）
- `PackRegistrationService` 包装 `ExtensionRegistry.register`
- **不** 推进 Run 状态机、**不** 写 Run Persistence

## 2. 非目标

- 替代 Engine 提交 Run Event
- ConfirmationGrant / Retention 完整产品化（后续阶段）

## 3. 验收清单

- [x] GovernanceEvent append 与 Run Event 分离（独立 store / sequence）
- [x] Pack 注册失败不静默降权（Registry 拒绝 + governance 审计）
- [x] 无 Persistence 直写 Run 路径
- [ ] 与 Run 关联用 correlationId + 受控 Outbox（后续；P9c 仅 Pack 注册）

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| contracts、ports | GovernanceEvent 类型与 Store 端口 |
| runtime | ExtensionRegistry 协作（governance 不反向依赖 Engine） |

## 5. 缺口与风险

- 持久化 GovernanceEvent（PG 表族）未做；仅内存 Store
- harness 已接 `governanceStore`；Eval 仍用内存 Registry 直连

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-28 | P9c：`@monai/governance` 包、Store、PackRegistrationService、L0 测试 |
| 2026-08-27 | 创建进展页 |
