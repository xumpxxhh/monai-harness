# 进展：adapters/secret

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/secret-*/` |
| 实现端口 | SecretPort |
| 状态 | `done`（`@monai/secret-env`；M1e） |
| 首触阶段 | P4（可先 stub）；M1e 模型凭证 |
| 上游 | [design/06](../../design/06-safety-and-control.md)、[engineering/04](../../engineering/04-ports-extensions-and-security.md) |
| 最后更新 | 2026-08-28 |

## 1. 范围

- 按主体/Tool/资源注入短时凭证（lease）
- M1e MVP：`@monai/secret-env` 环境变量与内存 map 租约；模型 adapter 只在调用边界取 secret
- 值不进入 Context、Event 明文、State、扩展日志

## 2. 非目标

- 首日上 Vault/云 KMS（可后换）

## 3. 验收清单

- [x] 安全套件：Secret 不出现在 Event/日志断言
- [x] lease 过期后不可再用 / 带有效期时间戳
- [x] 不把完整 env 暴露给 Pack
- [x] ModelPort 调用经 SecretPort lease 取 API Key（M1e）

## M1 退出条件

见 [sessions/0018](../sessions/0018-real-model-cluster-plan.md) M1e；与 [model.md](./model.md) 共用注入路径，勿分叉两套。已全部达成。

## 4. 依赖

ports；ExecutionContext.secretLease。

## 5. 缺口与风险

- 云 KMS / HashiCorp Vault 真实外部服务可未来扩展

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-28 | M1e 实装完成：`@monai/secret-env` 实现 EnvSecretPort（resolve + lease） |
| 2026-08-28 | M1e 计划：模型凭证 lease；见 0018 / [HANDOFF](../HANDOFF.md) |
| 2026-08-27 | 创建进展页 |
