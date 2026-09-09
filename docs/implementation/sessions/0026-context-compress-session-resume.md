# Session 0026 — Session resume + context 增量压缩 + implementation 文档纠错

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-08 |
| 类型 | 实现（已合入 resume/压缩）+ 文档（本轮 SSOT/事实纠错） |
| HANDOFF 已更新 | 是 |

## 目标

1. 历史会话恢复：`demo-session --resume=<sessionId>`（postgres）
2. Dialogue context 增量压缩（前缀缓存命中后只摘要 delta；切窗按完整执行回合）
3. 清理 `docs/implementation` 结构与幻觉/过期描述

## 改动路径（代码，已合入主分支会话）

| 切片 | 路径 |
| --- | --- |
| Session resume | `apps/harness/src/cli/demo-session.ts` |
| 压缩 / 投影 | `packages/runtime/src/context/compress-dialogue.ts` 等 |
| 相关 commit | `f59168a`、`02b0bad` |

## 改动路径（文档，本轮）

| 切片 | 路径 |
| --- | --- |
| 约定 / 入口 | `docs/implementation/CONVENTIONS.md`、`README.md` |
| 看板 / 交接 | `STATUS.md`、`HANDOFF.md`、`PHASES.md` |
| 包/adapter 纠错 | `packages/*`、`adapters/*`（pack-sdk、workspace-generic、runtime、knowledge 拆分等） |

## 验证

```text
pnpm --filter @monai/runtime test
# Session resume：PERSISTENCE_DRIVER=postgres 下
#   pnpm harness:session -- --resume=<sessionId>
```

## 未完成

- **Context 压缩长任务问题**（粒度 / 非截断输入 / 摘要判坏兜底）→ 见 [HANDOFF 下一步 #1–#3](../HANDOFF.md)
- 工作区仍有未提交的 `project-dialogue.ts` / `project-dialogue.test.ts` 微调 → 见 HANDOFF 其它 #4
- opt-in sandbox Session 联调仍可选（HANDOFF 其它 #5）

## 明确不做

- 不开启 KnowledgePort / DAG / Child Run / EDR-010
- 不改 design / engineering 领域语义
