# HANDOFF — 实现交接

> 下一会话 **只读本页 + [STATUS.md](./STATUS.md)** 即可开工。  
> 阶段总览：[PHASES.md](./PHASES.md)（**P0–P8 均已 `done`**）。  
> 维护规则见 [CONVENTIONS.md](./CONVENTIONS.md)。  
> 最后更新：2026-08-27（**P8 收尾完成**）

## 当前状态（一句话）

**P0–P8 全部完成。** MVP 闭环：contracts → Engine → delivery → PG Persistence → Hono HTTP/SSE → harness serve/demo。下一刀由产品/工程择优（Eval 完整矩阵、Pack、治理等），无 P8 阻塞。

## 当前焦点

| 项 | 说明 |
| --- | --- |
| 阶段 | P8 `done`；主链阶段规划已走完 |
| 建议下一主题 | Eval 完整矩阵 / `workspace-generic` Pack / governance 最小面 / L1-on-PG（均可选） |
| 阻塞 | 无；EDR-010 仍 Deferred |

## 下一步（建议，非强制顺序）

1. **Eval 扩展**：安全 8×1、恢复 8×5、审批·幂等完整矩阵；可选 PG 上重跑 Golden 6×5  
2. **Pack**：`packs/workspace-generic` 按设计 08 落地  
3. **治理 / 观测缺口**：governance 最小；`MVP_METRIC_GAPS`  
4. **运维体验**：角色独立开关；api↔delivery 测试环依赖清理  

## 禁区（仍适用）

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

| ID | 问题 | 影响 | 建议 |
| --- | --- | --- | --- |
| EDR-010 | isolated_extension 载体 | 后 MVP | 保持 Deferred |

## 关键路径速查

| 用途 | 路径 |
| --- | --- |
| Harness | `apps/harness/src/`（`config` / `bootstrap` / `loops` / `http-server` / `demo`） |
| HTTP/SSE | `packages/api/src/http/create-app.ts` |
| PG Persistence | `packages/adapters/persistence-postgres/` |
| Compose PG | `pnpm db:up`（`:54329`） |
| 环境变量 | 根目录 `.env.example` |

## 会话历史摘要

| 日期 | 摘要 |
| --- | --- |
| 2026-08-27 | P0–P7 完成。 |
| 2026-08-27 | P8a–P8c：postgres L2、harness bootstrap、Hono HTTP/SSE。 |
| 2026-08-27 | **P8d**：文档收尾 + 回归；P8 → `done`。 |

## 给下一任 Agent 的指令模板

```text
1. 读 docs/implementation/HANDOFF.md、STATUS.md
2. 与用户确认下一主题（Eval / Pack / governance / …），再开工
3. 结束时更新对应包页、STATUS、HANDOFF
4. PG：pnpm db:up；serve：$env:HARNESS_MODE='serve'; pnpm --filter harness start
```
