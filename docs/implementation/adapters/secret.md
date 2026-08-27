# 进展：adapters/secret

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/secret-*/` |
| 实现端口 | SecretPort |
| 状态 | `not_started` |
| 首触阶段 | P4（可先 stub） |
| 上游 | [design/06](../../design/06-safety-and-control.md)、[engineering/04](../../engineering/04-ports-extensions-and-security.md) |
| 最后更新 | 2026-08-27 |

## 1. 范围

- 按主体/Tool/资源注入短时凭证
- MVP：环境变量 / 测试 stub
- 值不进入 Context、Event 明文、State、扩展日志

## 2. 非目标

- 首日上 Vault/云 KMS（可后换）

## 3. 验收清单

- [ ] 安全套件：Secret 不出现在 Event/日志断言
- [ ] lease 过期后不可再用
- [ ] 不把完整 env 暴露给 Pack

## 4. 依赖

ports；ExecutionContext.secretLease。

## 5. 缺口与风险

- 与 model adapter 的密钥注入路径勿分叉两套

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | 创建进展页 |
