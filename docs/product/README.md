# 产品 / UI 档案

本目录跟踪 **面向人的操作台与产品体验计划**，与内核实现主链隔离。

## 规范性优先级

```text
docs/design/*            领域契约（权威）
docs/engineering/*       工程边界与 EDR
docs/implementation/*    内核实现进度（P0–P8 等）← 本目录不得改写其 HANDOFF/STATUS 焦点
docs/product/*           产品 UI / 操作台计划与进展（本目录）
```

## 隔离铁律

1. **不混入** [`docs/implementation`](../implementation/) 的阶段路线、HANDOFF「当前焦点」、STATUS 阶段表。
2. 前端若需内核补 API（如 `listRuns`、CORS），在本目录计划中记录依赖；**开工实现时再**改代码与对应包进展页，且勿把「当前内核下一刀」改写成 UI。
3. UI 不得发明第二套 Run/Event 状态机；展示与操作只消费公开 `/v1` 与 `@monai/contracts`。

## 文档

| 文档 | 状态 | 说明 |
| --- | --- | --- |
| [web-console.md](./web-console.md) | `archived` | 可扩展 Web 操作台计划 |
| [apps-web.md](./apps-web.md) | `in_progress` | `apps/web` 实现进展 |

上游：设计明确「不讨论 UI」见 [design/00-overview §2.2](../design/00-overview.md)；HTTP/SSE 能力见 [implementation/packages/api.md](../implementation/packages/api.md)（只读引用）。
