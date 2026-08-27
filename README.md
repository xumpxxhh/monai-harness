# monai-harness

通用 Agent Harness 设计与后续实现的工作区。

## 文档

| 目录 | 说明 |
| --- | --- |
| [docs/design/](./docs/design/README.md) | 架构评审用**领域设计契约**（对象、状态机、安全、MVP 门禁）；技术中立 |
| [docs/engineering/](./docs/engineering/README.md) | **工程实现架构档案**（TypeScript 模块化单体、事务、端口、测试与演进接缝） |
| [docs/implementation/](./docs/implementation/README.md) | **实现进展与交接**（阶段 P0–P7、各包进展、HANDOFF） |
| [docs/turborepo.md](./docs/turborepo.md) | pnpm + Turborepo 通用搭建指南（建仓时参照） |

规范性优先级：`docs/design` → `docs/engineering` → `docs/implementation` → 代码。

**接着实现**：先读 [docs/implementation/HANDOFF.md](./docs/implementation/HANDOFF.md)。
