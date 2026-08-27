# Session 0010 — P8 HTTP/PG 计划写入

**日期**：2026-08-27  
**类型**：规划（无代码改动）

## 目标

将 HTTP API + PostgreSQL Persistence 实装计划写入 implementation 档案，供下一会话按 P8a→P8d 连续小步开工。

## 改动路径

| 文件 | 说明 |
| --- | --- |
| `docs/implementation/PHASES.md` | P8 阶段、顺序、退出条件 |
| `docs/implementation/adapters/persistence.md` | P8a：schema、UoW、L2 |
| `docs/implementation/packages/api.md` | P8c：REST/SSE 路由 |
| `docs/implementation/packages/apps-harness.md` | P8b：bootstrap、env、delivery |
| `docs/implementation/HANDOFF.md` | 焦点切至 P8；链至 PHASES + 包页 |
| `docs/implementation/STATUS.md` | P8 行；L2 / EDR-007 备注 |

## 验证

- 文档内部链接可解析
- 无根目录 `P8-HTTP-PG.md`；计划分布在 PHASES + 包页

## 未完成

- EDR-007 尚未 Accept（实装 P8c 第一步关闭）
- `@monai/persistence-postgres` 包尚未创建
- HTTP 路由 / harness bootstrap 尚未实装
