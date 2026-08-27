# 进展：packages/governance

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/governance/` |
| 状态 | `not_started` |
| 首触阶段 | P5+（可较早建空包） |
| 上游 | [design/01 §5.2](../../design/01-domain-model.md)、[engineering/01](../../engineering/01-repository-and-modules.md)、EDR-013 |
| 最后更新 | 2026-08-27 |

## 1. 范围

- Pack 注册与 `PackRegistrationResult`
- AgentDefinition 配置面 / Manifest 物化协作
- Retention / Tombstone / legal hold（可分期）
- 无 Run 时 ConfirmationGrant 过期/撤销 → GovernanceEvent
- **不** 推进 Run 状态机

## 2. 非目标

- 替代 Engine 提交 Run Event
- MVP 完整合规产品化（可先最小注册面）

## 3. 验收清单

- [ ] GovernanceEvent append CAS 与 Run Event 分离
- [ ] 与 Run 关联用 correlationId + 受控重试，不宣称跨流原子
- [ ] Pack 注册失败不静默降权
- [ ] 无 Persistence 直写 Run 路径

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| ports、contracts | |
| runtime Registry（协作） | 注意依赖方向：governance 不应反向依赖 Engine 写 API |

## 5. 缺口与风险

- 与 runtime/extension 的注册所有权需在首次实现时钉死，避免双写注册表

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | 创建进展页 |
