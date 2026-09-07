# HANDOFF — 实现交接

> 最后更新：2026-09-07（**0025**：`sandbox.exec` opt-in / `@monai/sandbox-subprocess`）

## 当前状态（一句话）

**默认**仍为 `RejectingSandbox` + allowlist 无 `sandbox.exec`；`FEATURE_ENABLE_SANDBOX_EXEC=true` 时可挂 `@monai/sandbox-subprocess` 并注册 Tool（需二进制白名单）。EDR-010 仍 Deferred。

- artifact → `FsObjectStore`；0024 infra + 全 postgres L1/L2 已绿
- 知识面 / 审批面仍显式延后

## 下一步

1. 联调 opt-in sandbox（白名单命令 + Session Demo）；或新焦点待定
2. 勿默认开 KnowledgePort / confirm_once / 拆进程 / EDR-010

## 显式延后

| 项 | 原因 |
| --- | --- |
| KnowledgePort / Context `knowledge` section | 产品路径先用 Tool 检索 |
| ConfirmationGrant / `confirm_once` | 单次审批主路径已够用 |
| Redis/SQS；EDR-010 `isolated_extension` | 产品选型后置 |
| API + Worker 进程拆分 | 等 engineering/05 §4.1 信号 |

## 禁区

- Eval / Golden 114 不得改用真实模型
- Eval 默认不得挂载 RAG（无 `KNOWLEDGE_BASE_URL`）
- Eval / 默认 MVP **不得**开 `FEATURE_ENABLE_SANDBOX_EXEC`
- 密钥只经 SecretPort；不得进 Context / Event 明文
- 不得在 Reducer / Hook 绕过安全边界
- 不宣称 design 08 阶段 A Knowledge 关闭
- 不得在 runtime 为新 Pack Tool 硬编码 catalog/prompt/hints
- 换 Queue/Lease 后端不得改 delivery 业务语义
- **不得**在未开 flag 时把可执行 Sandbox 挂进默认装配
- **不得**再引入未规划的 objectstore-memory 包

## 回归基线

```text
pnpm --filter @monai/sandbox-subprocess test
pnpm --filter @monai/sandbox-stub test
pnpm --filter @monai/delivery test
pnpm --filter @monai/runtime test
pnpm --filter @monai/observability test
pnpm --filter harness test
```

## 关键路径

| 用途 | 路径 |
| --- | --- |
| subprocess sandbox | `packages/adapters/sandbox-subprocess/` |
| stub | `packages/adapters/sandbox-stub/` |
| Pack Tool | `packages/packs/workspace-generic/src/manifest.ts` |
| Pack wiring | `packages/delivery/src/pack-wiring.ts` |
| harness 装配 | `apps/harness/src/bootstrap/container.ts` |
