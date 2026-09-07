# HANDOFF — 实现交接

> 最后更新：2026-09-07（**撤回 objectstore-memory**；artifact 仅用 `FsObjectStore`）

## 当前状态（一句话）

**`artifact.write_markdown` / `artifact.validate` 经 `ObjectStorePort`；实现仅为 `@monai/objectstore-fs`（harness 配置根；Eval/L1 wiring 默认 os.tmpdir）。**
- 0024 infra + 全 postgres L1/L2 已绿
- 知识面 / 审批面仍显式延后

## 下一步

1. 新焦点待定（勿默认开 KnowledgePort / confirm_once / 拆进程）

## 显式延后

| 项 | 原因 |
| --- | --- |
| KnowledgePort / Context `knowledge` section | 产品路径先用 Tool 检索 |
| ConfirmationGrant / `confirm_once` | 单次审批主路径已够用 |
| Redis/SQS；真 sandbox / EDR-010 | 产品选型后置 |
| API + Worker 进程拆分 | 等 engineering/05 §4.1 信号 |

## 禁区

- Eval / Golden 114 不得改用真实模型
- Eval 默认不得挂载 RAG（无 `KNOWLEDGE_BASE_URL`）
- 密钥只经 SecretPort；不得进 Context / Event 明文
- 不得在 Reducer / Hook 绕过安全边界
- 不宣称 design 08 阶段 A Knowledge 关闭
- 不得在 runtime 为新 Pack Tool 硬编码 catalog/prompt/hints
- 换 Queue/Lease 后端不得改 delivery 业务语义
- **不得**把可执行 Sandbox 挂进 MVP 装配（仅 `RejectingSandbox`）
- **不得**再引入未规划的 objectstore-memory 包

## 回归基线

```text
pnpm --filter @monai/objectstore-fs test
pnpm --filter @monai/delivery test
pnpm --filter @monai/runtime test
pnpm --filter @monai/observability test
pnpm --filter harness test
```

## 关键路径

| 用途 | 路径 |
| --- | --- |
| artifact handlers | `packages/packs/workspace-generic/src/manifest.ts` |
| Pack wiring | `packages/delivery/src/pack-wiring.ts` |
| fs store | `packages/adapters/objectstore-fs/` |
| harness 装配 | `apps/harness/src/bootstrap/container.ts` |
