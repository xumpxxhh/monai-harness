# 实现进展档案

本目录跟踪 **代码实现进度与跨会话交接**，不替代领域设计或工程架构契约。

## 规范性优先级

```text
docs/design/*            领域契约（权威）
        ↓
docs/engineering/*       工程边界与 EDR
        ↓
docs/implementation/*    实现进度、阶段、handoff（本目录）
        ↓
apps/ + packages/        代码与配置
```

冲突时：设计 > 工程档案 > 本目录进度描述。本目录不得发明新的领域语义。

## 何时读什么

| 场景 | 先读 |
| --- | --- |
| 新会话 / 换人接着干 | [HANDOFF.md](./HANDOFF.md) → [STATUS.md](./STATUS.md) |
| 看全局做到哪 | [STATUS.md](./STATUS.md) + [PHASES.md](./PHASES.md) |
| 改某个包 | [packages/](./packages/) 或 [adapters/](./adapters/) 对应进展页 |
| 结束一轮实现 | 更新包进展 → STATUS → **重写 HANDOFF** → 可选追加 [sessions/](./sessions/) |

## 文档导航

| 文档 | 职责 |
| --- | --- |
| [HANDOFF.md](./HANDOFF.md) | **唯一当前交接入口**：下一会话从哪开始、禁区、未决问题 |
| [STATUS.md](./STATUS.md) | 全局看板：阶段、包状态、阻塞 |
| [PHASES.md](./PHASES.md) | 实现阶段 P0–P9、依赖、退出条件 |
| [CONVENTIONS.md](./CONVENTIONS.md) | 状态枚举、更新规则、会话日志约定 |
| [packages/](./packages/) | 各 workspace 包进展 |
| [adapters/](./adapters/) | 各基础设施适配器进展 |
| [sessions/](./sessions/) | 按会话追加的简短工作日志（可选但推荐） |

上游：

- 设计：[docs/design/README.md](../design/README.md)
- 工程：[docs/engineering/README.md](../engineering/README.md)
- Turborepo：[docs/turborepo.md](../turborepo.md)

## 包进展一览（入口）

| 包 / 单元 | 进展页 | 首触阶段 |
| --- | --- | --- |
| 仓库根 / tooling | [packages/tooling.md](./packages/tooling.md) | P0 |
| `packages/contracts` | [packages/contracts.md](./packages/contracts.md) | P0–P1 |
| `packages/ports` | [packages/ports.md](./packages/ports.md) | P0–P1 |
| `packages/runtime` | [packages/runtime.md](./packages/runtime.md) | P1–P6 |
| `packages/delivery` | [packages/delivery.md](./packages/delivery.md) | P2 |
| `packages/api` | [packages/api.md](./packages/api.md) | P2 / P7 |
| `packages/pack-sdk` | [packages/pack-sdk.md](./packages/pack-sdk.md) | P3–P4 |
| `packages/packs/workspace-generic` | [packages/workspace-generic.md](./packages/workspace-generic.md) | P3–P5 |
| `packages/governance` | [packages/governance.md](./packages/governance.md) | P5+ |
| `packages/observability` | [packages/observability.md](./packages/observability.md) | P7 |
| `apps/harness` | [packages/apps-harness.md](./packages/apps-harness.md) | P0 / 贯穿 |
| Adapters | [adapters/](./adapters/) | 见各页 |

## 维护铁律

1. **每轮实现结束必须更新 HANDOFF.md**（覆盖写「当前状态」，不要只追加聊天式废话）。
2. 改了代码的包，同步改对应 `packages/*.md` 或 `adapters/*.md` 的勾选与状态。
3. STATUS.md 的汇总表与包页状态保持一致；不一致时以包页为准并立刻修汇总。
4. 发现工程/设计缺口：记入 HANDOFF「未决」，必要时回修 `docs/engineering` 或提设计修订，不要只在代码里默默偏离。

---

当前交接：[HANDOFF.md](./HANDOFF.md)
