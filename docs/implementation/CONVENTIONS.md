# 实现约定（进展文档）

## 1. 状态枚举

包 / 适配器 / 阶段任务统一使用：

| 状态 | 含义 |
| --- | --- |
| `not_started` | 尚未开始 |
| `in_progress` | 本阶段正在做 |
| `blocked` | 被依赖或未决问题挡住 |
| `done` | 当前阶段验收项已勾完（后续阶段仍可能再改此包） |
| `deferred` | 有意延后（须注明对应 EDR / 阶段） |

阶段（PHASES）另用：`not_started` | `in_progress` | `done` | `blocked`。

## 2. 包进展页必含章节

1. 元信息（路径、上游工程文档、首触阶段、状态）
2. 范围 / 非目标
3. 验收清单（可勾选）
4. 依赖（上游包 / EDR）
5. 当前缺口与风险
6. 最近变更（日期 + 一句话；保留最近约 10 条）

模板：[`packages/_TEMPLATE.md`](./packages/_TEMPLATE.md)、[`adapters/_TEMPLATE.md`](./adapters/_TEMPLATE.md)。

## 3. HANDOFF 更新规则

文件：[HANDOFF.md](./HANDOFF.md)

- **覆盖**「当前焦点 / 下一步 / 禁区 / 未决」四节，保证下一会话只读这一页就能开工。
- 「会话历史摘要」可追加短条目（日期、做了什么、留下什么）。
- 不要把大段设计原文贴进 HANDOFF；用链接指向 design / engineering / 包进展页。

## 4. 会话日志

目录：[sessions/](./sessions/)

- 文件名：`NNNN-short-slug.md`（四位序号递增）。
- 每轮实质性实现结束建议追加一条；纯阅读/规划可合并进 HANDOFF 历史摘要。
- 单条保持短：目标、改动路径、验证、未完成。

## 5. 与代码的关系

| 本目录 | 代码树 |
| --- | --- |
| 先有进展页 | 允许包目录尚未创建 |
| `done` | 应对应该包约定验收；不是「文件存在」 |
| 禁止 | 在本目录写第二套 API/状态机规范 |

## 6. 关闭 Proposed EDR

实现触及存储/锁等 Proposed 项时：

1. 在 HANDOFF「未决」列出
2. 关闭后更新 `docs/engineering/00-implementation-baseline.md` 的 EDR 状态
3. 在 STATUS「决策关闭」表记一笔

已关闭：EDR-005/006/008/009。仍 Deferred：EDR-007（HTTP/SSE）、EDR-010（isolated_extension）。
