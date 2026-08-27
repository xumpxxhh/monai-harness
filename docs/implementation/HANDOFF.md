# HANDOFF — 实现交接

> 下一会话 **只读本页 + [STATUS.md](./STATUS.md)** 即可开工。  
> P8 阶段与顺序：[PHASES.md §P8](./PHASES.md#p8--http--postgresql)；包页见 [persistence](./adapters/persistence.md) / [api](./packages/api.md) / [apps-harness](./packages/apps-harness.md)。  
> 维护规则见 [CONVENTIONS.md](./CONVENTIONS.md)。  
> 最后更新：2026-08-27（P8b 完成 → 下一刀 P8c HTTP/SSE）

## 当前状态（一句话）

P0–P7 与 **P8a/P8b 完成**。Harness 支持 `PERSISTENCE_DRIVER=memory|postgres`；PG 上 CreateRun → running → `execute_turn` 已通。下一刀：**P8c HTTP + SSE**（须先 Accept EDR-007，推荐 Hono）。

## 当前焦点

| 项 | 说明 |
| --- | --- |
| 阶段 | **P8**（`in_progress`）— [PHASES.md §P8](./PHASES.md#p8--http--postgresql) |
| 正在做的包 | [packages/api.md](./packages/api.md)（P8c） |
| 第一刀 | P8b 已完成；下一步 P8c |
| 阻塞 | **EDR-007** 须在 P8c 实装前 Accept（推荐 Hono） |

## 下一步（P8 顺序）

1. ~~**P8a**~~ → [adapters/persistence.md](./adapters/persistence.md) — **done**
2. ~~**P8b**~~ → [packages/apps-harness.md](./packages/apps-harness.md) — **done**
3. **P8c — HTTP + SSE** → [packages/api.md](./packages/api.md)  
   - 关闭 EDR-007；REST 路由 + `http-error-map` + SSE
4. **P8d — 文档与回归**  
   - 更新包页 / STATUS / PHASES；可选 Golden 6×5 在 PG 上重跑

**并列可选**（不挡 P8）：Eval 完整矩阵；L1 套件在 PG 上重跑。

## 禁区（本阶段不要做）

- 不要改写 `docs/design` 领域语义来迁就实现。
- 不要启用 DAG、Child Run、Memory、`sandbox.exec`、真实非隔离 `write_high`（EDR-014）。
- 不要让 Policy/ToolRuntime/API 获得 Persistence 直写。
- 不要在打开的 DB 事务内调用 Model/Tool/网络 IO（EDR-003）。
- 不要跳过 `created → queued` 直接 `running`；等待态不要直接回 `running`。
- 不要把 Checkpoint 当唯一真相；Event Log 仍是审计/回放源。
- observability 不得获得 Run 写权或触发副作用重放。
- Evaluator 不得替代 Validator / required `acceptanceChecks`。
- 服务端不得实现同步专用状态机；客户端超时不自动 cancel。

## 未决问题

| ID | 问题 | 影响阶段 | 建议 |
| --- | --- | --- | --- |
| EDR-007 | HTTP/SSE 框架 | P8c | **实装前问用户 Accept**；推荐 **Hono** |
| EDR-010 | isolated_extension 载体 | 后 MVP | 保持 Deferred |

## 关键路径速查

| 用途 | 路径 |
| --- | --- |
| P8 阶段 | [PHASES.md §P8](./PHASES.md#p8--http--postgresql) |
| P8a PG | [adapters/persistence.md](./adapters/persistence.md) |
| P8b bootstrap | [packages/apps-harness.md](./packages/apps-harness.md) |
| P8c HTTP/SSE | [packages/api.md](./packages/api.md) |
| Harness 入口 | `apps/harness/src/index.ts`（`config` / `bootstrap` / `loops` / `demo`） |
| 领域契约 | `docs/design/` |
| 持久化算法 | `docs/engineering/03-persistence-and-transactions.md` |

## 会话历史摘要

| 日期 | 摘要 |
| --- | --- |
| 2026-08-27 | 建立 implementation 进展体系。 |
| 2026-08-27 | P0–P7：monorepo → Eval/Golden。 |
| 2026-08-27 | P8 计划 + P8a postgres L2 子集。 |
| 2026-08-27 | P8a 收尾：L2 recovery + prepared；12/12。 |
| 2026-08-27 | P8b：harness bootstrap；PG CreateRun→execute_turn；下一刀 P8c。 |

## 给下一任 Agent 的指令模板

```text
1. 读 docs/implementation/HANDOFF.md、STATUS.md、PHASES.md §P8、packages/api.md
2. 先问用户 Accept EDR-007（推荐 Hono），再做 P8c REST + SSE
3. 结束时更新 api / apps-harness 包页、STATUS、HANDOFF、engineering EDR
4. 不要编辑 .cursor/plans 下的计划文件，除非用户明确要求
5. L2 PG：`pnpm db:up`；harness demo：$env:PERSISTENCE_DRIVER='postgres'; pnpm --filter harness start
```
