# 进展：packages/pack-sdk

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/pack-sdk/` |
| 状态 | `done`（P9a） |
| 首触阶段 | P3–P4 |
| 上游 | [engineering/04](../../engineering/04-ports-extensions-and-security.md)、[design/04](../../design/04-extension-model.md) |
| 最后更新 | 2026-09-08 |

## 1. 范围

- Pack 贡献类型、Tool/Hook handler 签名
- ExecutionContext 构造辅助类型
- Schema 校验钩子约定
- allowlist / requireApproval 辅助（`packDefaultAllowlist` 等）
- **禁止** 暴露 Persistence / Engine / Event append / 任意 Secret 客户端

## 2. 非目标

- 具体 Pack 实现（属 `packs/workspace-generic`）
- isolated_extension 运行时（EDR-010 Deferred）

## 3. 验收清单

- [x] 仅依赖 contracts（+ 可选类型-only）
- [x] Handler 返回值约束为 HookResult（observations / contributions / veto）
- [x] Tool handler / ExecutionContext 形状可供 Pack 与 delivery 使用
- [x] 文档明确禁止获取的能力列表（本页 + 源码注释）
- [x] 被 `workspace-generic` 与 runtime Registry / delivery pack-wiring 共同引用

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| contracts | 类型 |

## 5. 缺口与风险

- EDR-010 isolated_extension 载体仍 Deferred（与本包类型面无关）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-09-08 | 进展页纠错：状态改为 `done`；勾选 Registry/Pack 引用项 |
| 2026-08-27 | P3：落地 `@monai/pack-sdk` HookPoint / HookResult / HookHandler |
| 2026-08-27 | 创建进展页 |
