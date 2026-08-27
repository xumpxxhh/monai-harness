# 工程实现文档

本目录是**工程实现架构与落地映射**文档集。它把 [docs/design](../design/README.md) 中的契约映射到可执行的仓库形态、技术选型、端口 Adapter、部署切片与实现顺序。

## 与设计文档的边界

| 层 | 目录 | 职责 | 不负责 |
| --- | --- | --- | --- |
| 设计契约 | [docs/design](../design/README.md) | 对象、状态机、Event、权限、安全、评测与 MVP 能力边界 | 语言、框架、目录、中间件产品 |
| 工程映射 | 本目录 | 技术选型、包边界、Adapter 映射、事务落地、API 面、实现路线 | 改写 01–08 的字段语义或状态枚举 |

发生冲突时：**设计契约优先**；工程文档只能补充「如何落地」，不能发明第二套领域语义。

仓库搭建约定见 [docs/turborepo.md](../turborepo.md)（pnpm workspace + Turborepo）。

## 文档导航

| 序号 | 文档 | 摘要 |
| --- | --- | --- |
| 00 | [工程实现架构](./00-implementation-architecture.md) | TypeScript 选型与风险、Monorepo 包图、模块映射、MVP-0 单进程、事务边界、API 面、Pack/Eval 落位与实现顺序 |

## 建议阅读顺序

1. [docs/design/00-overview.md](../design/00-overview.md) → [01](../design/01-domain-model.md) → [02](../design/02-core-architecture.md) → [08](../design/08-mvp-and-evolution.md)：掌握契约与 MVP 边界
2. 本目录 [00-implementation-architecture.md](./00-implementation-architecture.md)：掌握工程落地映射
3. [docs/turborepo.md](../turborepo.md)：掌握仓库工具约定（编码阶段再搭建）

## 当前阶段

本目录当前只产出架构映射文档，**不包含**可运行代码、OpenAPI 全集或基础设施即代码。编码按 00 文档第 9 节实现顺序推进。

---

开始阅读：[00-implementation-architecture.md](./00-implementation-architecture.md)
