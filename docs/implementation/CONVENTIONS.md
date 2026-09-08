# 实现约定（进展文档）

## 1. 状态枚举

包 / 适配器 / 阶段任务统一使用：

| 状态 | 含义 |
| --- | --- |
| `not_started` | 尚未开始 |
| `in_progress` | 本阶段正在做 |
| `blocked` | 被依赖或未决问题挡住 |
| `done` | 当前阶段验收项已勾完（后续阶段仍可能再改此包） |
| `deferred` | 有意延后（须注明对应 EDR / 阶段 / 设计禁用项） |

阶段（PHASES）另用：`not_started` | `in_progress` | `done` | `blocked`。

**拆分规则**：同一进展页若含多条独立能力（例如 RAG Tool vs KnowledgePort），不得用单一 `in_progress` 混装「子能力已 done + 另一能力未做」。应：

- 主状态写已交付主路径（通常 `done`），未做能力进「缺口」并标 `deferred` / `not_started`；或
- 在 STATUS / 包页用两行拆开（推荐 Knowledge 类）。

`deferred` 典型用法：`KnowledgePort`、Context `knowledge` section、ConfirmationGrant、EDR-010。

## 2. 文档职责与 SSOT

| 文档 | 真相源角色 |
| --- | --- |
| `packages/*.md` / `adapters/*.md` | 该单元**细粒度真相**：状态字段、验收勾选、缺口、最近变更 |
| [STATUS.md](./STATUS.md) | **汇总看板**：必须与包页状态一致；不写「下一步怎么干」 |
| [PHASES.md](./PHASES.md) | **路线与退出条件**；已完成阶段的勾选视为**历史快照** |
| [HANDOFF.md](./HANDOFF.md) | **当前唯一交接入口**（覆盖写） |
| `sessions/` | **追加历史**；计划文须标注「已归档 / 已落地」 |

发现 STATUS 与包页不一致时：

1. **先对照代码**把包页状态与清单修到正确；
2. **再改 STATUS** 汇总与之对齐。

禁止在包页过期的情况下仍声称「以包页为准」而不回修。

## 3. 包进展页必含章节

1. 元信息（路径、上游工程文档、首触阶段、状态、最后更新）
2. 范围 / 非目标
3. 验收清单（可勾选；已落地须勾上）
4. 依赖（上游包 / EDR）
5. 当前缺口与风险
6. 最近变更（日期 + 一句话；保留最近约 10 条）

模板：[`packages/_TEMPLATE.md`](./packages/_TEMPLATE.md)、[`adapters/_TEMPLATE.md`](./adapters/_TEMPLATE.md)。

## 4. HANDOFF 更新规则

文件：[HANDOFF.md](./HANDOFF.md)

覆盖写以下节（下一会话只读这一页就能开工）：

1. 当前状态（一句话）
2. 下一步（1–3 条）
3. 显式延后
4. 禁区
5. 回归基线 / 关键路径（按需）

可选：「会话历史摘要」短条目（日期、做了什么、留下什么）。

不要把大段设计原文或阶段全表贴进 HANDOFF；用链接指向 design / engineering / STATUS / 包进展页。

## 5. PHASES 规则

- 总览表与 [STATUS.md](./STATUS.md) 阶段行对齐。
- **已完成**阶段正文中的勾选与退出条件视为快照；若后续 session 已关闭某缺口，须改写现状句或加「已由 M1g / 002x 关闭」注，禁止把过时「仍缺」当成当前阻塞。
- 新增能力默认只改：包页 → STATUS → HANDOFF；**除非**开新阶段节（如 M4），否则不把 PHASES 当 changelog。

## 6. 会话日志

目录：[sessions/](./sessions/)

- 文件名：`NNNN-short-slug.md`（四位序号递增）。
- 每轮实质性实现结束建议追加一条；纯阅读/规划可合并进 HANDOFF 历史摘要。
- 单条保持短：目标、改动路径、验证、未完成。
- **计划类** session（如 0018、0024）落地后文首加一行：`状态：已归档 / 已落地`，避免与 HANDOFF「下一步」抢焦点。

## 7. 与代码的关系

| 本目录 | 代码树 |
| --- | --- |
| 先有进展页 | 允许包目录尚未创建 |
| `done` | 应对应该包约定验收；不是「文件存在」 |
| 禁止 | 在本目录写第二套 API/状态机规范 |

**结束一轮更新顺序**：对照代码 → 包/adapter 进展页 → STATUS → **重写 HANDOFF** → 可选追加 sessions/。

## 8. 关闭 Proposed EDR

实现触及存储/锁等 Proposed 项时：

1. 在 HANDOFF「显式延后 / 未决」列出
2. 关闭后更新 `docs/engineering/00-implementation-baseline.md` 的 EDR 状态
3. 在 STATUS「决策关闭」表记一笔

已关闭：EDR-005/006/007/008/009。EDR-014 Accepted（默认禁用；`sandbox.exec` 可 opt-in，见 0025）。EDR-016 Accepted（RAG Tool）。仍 Deferred：EDR-010（isolated_extension）。
