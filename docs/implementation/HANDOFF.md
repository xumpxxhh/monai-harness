# HANDOFF — 实现交接

> 最后更新：2026-09-08（**0026** session resume + context 增量压缩；implementation 文档结构/事实纠错）

## 当前状态（一句话）

主链 P0–P9 / M1–M3 / 可替换 infra 已 `done`；Session 支持 `--resume`（postgres）与 dialogue **增量压缩**；默认仍 RejectingSandbox，`sandbox.exec` 仅 opt-in。KnowledgePort / confirm_once / EDR-010 仍 deferred。

## 下一步

1. 收口工作区未提交的 `project-dialogue.ts` / `.test.ts`（提交或丢弃），跑 `pnpm --filter @monai/runtime test`
2. 联调 opt-in sandbox：`FEATURE_ENABLE_SANDBOX_EXEC` + `SANDBOX_ALLOWED_BINARIES` + Session Demo
3. 勿默认开 KnowledgePort / confirm_once / 拆进程 / EDR-010；勿开 DAG / Child Run（无 design 进入信号）

## 显式延后

| 项 | 原因 |
| --- | --- |
| KnowledgePort / Context `knowledge` section | 产品路径先用 `knowledge.search` Tool |
| ConfirmationGrant / `confirm_once` | 单次审批主路径已够用 |
| Redis/SQS；EDR-010 `isolated_extension` | 产品选型后置 |
| API + Worker 进程拆分 | 等 engineering/05 §4.1 信号 |
| DAG / Child Run / Memory | design 08 阶段 F/G/E；需运营进入信号 |

## 禁区

- Eval / Golden 114 不得改用真实模型
- Eval 默认不得挂载 RAG（无 `KNOWLEDGE_BASE_URL`）
- Eval / 默认 MVP **不得**开 `FEATURE_ENABLE_SANDBOX_EXEC`
- 密钥只经 SecretPort；不得进 Context / Event 明文
- 不得在 Reducer / Hook 绕过安全边界
- 不宣称 design 08 阶段 A 已关闭（缺的是 KnowledgePort/Memory/运营信号，**不是** Token/cost——M1g 已收口）
- 不得在 runtime 为新 Pack Tool 硬编码 catalog/prompt/hints
- 换 Queue/Lease 后端不得改 delivery 业务语义
- **不得**在未开 flag 时把可执行 Sandbox 挂进默认装配
- **不得**再引入未规划的 objectstore-memory 包

## 回归基线

```text
pnpm --filter @monai/runtime test
pnpm --filter @monai/delivery test
pnpm --filter @monai/observability test
pnpm --filter harness test
pnpm --filter @monai/sandbox-subprocess test
pnpm --filter @monai/sandbox-stub test
```

## 关键路径

| 用途 | 路径 |
| --- | --- |
| Session CLI / resume | `apps/harness/src/cli/demo-session.ts` |
| Dialogue 投影 / 压缩 | `packages/runtime/src/context/` |
| Pack Tool Manifest | `packages/packs/workspace-generic/src/manifest.ts` |
| Pack wiring | `packages/delivery/src/pack-wiring.ts` |
| harness 装配 | `apps/harness/src/bootstrap/container.ts` |
| subprocess sandbox | `packages/adapters/sandbox-subprocess/` |

## 会话历史摘要

| 日期 | 做了什么 | 留下什么 |
| --- | --- | --- |
| 2026-09-08 | implementation 文档 SSOT/纠错；STATUS/HANDOFF 同步到 0026 | `project-dialogue` 未提交改动待收口 |
| 2026-09-08 | session `--resume` + context 增量压缩（0026） | sandbox Session 联调仍可选 |
| 2026-09-07 | 0025 sandbox.exec opt-in；0024 infra 收口 | EDR-010 Deferred |
