# 进展：packages/pack-sdk

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/pack-sdk/` |
| 状态 | `in_progress`（P3：HookResult 类型） |
| 首触阶段 | P3–P4 |
| 上游 | [engineering/04](../../engineering/04-ports-extensions-and-security.md)、[design/04](../../design/04-extension-model.md) |
| 最后更新 | 2026-08-27 |

## 1. 范围

- Pack 贡献类型、Tool/Hook handler 签名
- ExecutionContext 构造辅助类型
- Schema 校验钩子约定
- **禁止** 暴露 Persistence / Engine / Approval append / 任意 Secret 客户端

## 2. 非目标

- 具体 Pack 实现
- isolated_extension 运行时（EDR-010 Deferred）

## 3. 验收清单

- [x] 仅依赖 contracts（+ 可选类型-only）— 当前零 contracts 运行时依赖亦可（仅类型约定）
- [x] Handler 返回值约束为 HookResult（observations / contributions / veto）
- [x] 文档明确禁止获取的能力列表（本页 + 源码注释）
- [ ] 被 workspace-generic 与 runtime Registry 共同引用（Registry 后置）

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| contracts | 可选；P3 仅自包含 Hook 类型 |

## 5. 缺口与风险

- Tool handler / ExecutionContext 完整形状待 P4
- 与 runtime/extension 的边界需随 Registry 落地再校验无环依赖

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | P3：落地 `@monai/pack-sdk` HookPoint / HookResult / HookHandler |
| 2026-08-27 | 创建进展页 |
