# 工程实现架构档案

本目录是 **Harness 工程实现架构档案**：把 [`docs/design/`](../design/README.md) 中的领域契约映射为 TypeScript / Node.js 模块化单体的仓库边界、运行时组合、事务语义、端口装配、测试与演进接缝。

本目录 **不** 重定义 Run、Event、State、Policy、Approval、状态机或安全门禁语义；若与设计文档冲突，以设计文档为准。

本目录 **不** 包含可运行业务代码或数据库迁移正文；仓库骨架与实现进度见 [`docs/implementation/`](../implementation/README.md) 与根目录 `apps/`、`packages/`。

## 规范性优先级

```text
docs/design/*            （领域契约，权威）
        ↓ 实现映射
docs/engineering/*       （工程边界与 EDR，本目录）
        ↓ 进度与交接
docs/implementation/*    （阶段、包进展、HANDOFF）
        ↓ 兑现
apps/ + packages/        （代码与配置）
```

| 层级 | 职责 | 冲突处理 |
| --- | --- | --- |
| `docs/design` | 对象、状态机、Event、权限、MVP 门禁 | 权威；工程档案不得改写 |
| `docs/engineering` | 包边界、事务、端口映射、部署接缝、测试分层 | 只补充实现决策；冲突时回修本目录 |
| `docs/implementation` | 实现阶段、各包进展、跨会话 HANDOFF | 不得发明新领域语义；冲突时以上游为准 |
| 代码与配置 | 兑现上述层级（`apps/` + `packages/`） | 不得引入绕过 Engine 的写路径 |

实现开工入口：[docs/implementation/HANDOFF.md](../implementation/HANDOFF.md)。

## 已确认工程基线

- 语言与运行时：TypeScript + Node.js（`>= 20`）
- 仓库工具：pnpm workspace + Turborepo（通用规则见 [`docs/turborepo.md`](../turborepo.md)）
- MVP 部署：单一 deployable 模块化单体；API、Worker、Dispatcher、Scheduler 同进程角色化
- 存储：单事务存储；Persistence 与 Outbox 同一 Unit of Work
- 决策编号：工程决策使用 `EDR-*`，与设计层 `ADR-*` 分离

## 文档导航

| 序号 | 文档 | 摘要 |
| --- | --- | --- |
| 00 | [实现基线与 EDR 索引](./00-implementation-baseline.md) | 技术基线、单体部署图、EDR 治理与决策索引 |
| 01 | [仓库与模块边界](./01-repository-and-modules.md) | apps/packages 布局、依赖方向、暂不拆包项 |
| 02 | [运行时组合](./02-runtime-composition.md) | bootstrap、Command 信封、进程内角色、关键数据流、拆分接缝 |
| 03 | [持久化与事务](./03-persistence-and-transactions.md) | 存储模型、提交算法、UoW 清单、Outbox/Queue/Lease、恢复 |
| 04 | [端口、扩展与安全装配](./04-ports-extensions-and-security.md) | Ports 映射、Pack SDK、Adapter、ExecutionContext、MVP 禁用项 |
| 05 | [测试与演进](./05-testing-and-evolution.md) | 测试分层、故障注入、与 07/08 门禁对齐、API+Worker 迁移检查点 |

阅读顺序：00 → 01 → 02 → 03 → 04 → 05 → 回到本 README 核对评审清单。

上游领域设计：[`docs/design/README.md`](../design/README.md)。

## EDR 状态（摘要）

完整状态见 [00 §8](./00-implementation-baseline.md#8-edr-索引)。仍 Deferred、接 API / 隔离扩展时再关：

| ID | 议题 | 状态 |
| --- | --- | --- |
| EDR-001 | TypeScript + Node + pnpm/Turborepo 基线 | Accepted |
| EDR-002 | MVP 模块化单体、单 deployable | Accepted |
| EDR-003 | Persistence + Outbox 同 UoW；外部 IO 不跨事务 | Accepted |
| EDR-004 | 内联 Queue/Scheduler，保留 at-least-once 语义 | Accepted |
| EDR-005 | PostgreSQL 作为首版权威存储 | Accepted |
| EDR-006 | Run 级互斥：`runs` 行 `FOR UPDATE` | Accepted |
| EDR-007 | HTTP/SSE 框架选型 | Deferred |
| EDR-008 | Schema 校验：Zod | Accepted |
| EDR-009 | SQL 访问层：drizzle-orm | Accepted |
| EDR-010 | `isolated_extension` 运行载体 | Deferred |

## 架构评审清单

评审本目录时，需同时确认：

1. 工程档案未改写 `docs/design` 的对象、状态或 Event 语义。
2. `runtime` 是唯一可变提交入口；Policy / Tool Runtime / Reducer 不直接写库。
3. Persistence 与 Outbox 共享同一 Unit of Work；Model / Hook / Tool IO 在事务外。
4. 内联 Queue / Scheduler 仍满足至少一次投递、`{runId, revision}` 去重、补偿扫描与 `leaseEpoch` fencing。
5. 包依赖方向可被 lint / 架构测试 enforce；Core 不 import Pack 或具体 infra 客户端。
6. MVP 禁用项（DAG、Child Run、Memory、`sandbox.exec`、真实 `write_high`）在装配层显式关闭。
7. 测试分层覆盖纯函数、Engine 组件、真实单库事务与 08 验收矩阵对应关系。
8. 从单体到 API + Worker 的接缝已写明，且不依赖重写领域契约。
9. Proposed / Deferred 的产品选型未伪装为 Accepted。
10. 每个 Accepted EDR 均反向链接到设计依据。

---

开始阅读：[00-implementation-baseline.md](./00-implementation-baseline.md)
