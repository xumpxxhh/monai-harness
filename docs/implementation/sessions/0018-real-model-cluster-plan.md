# Session 0018 — 真实模型簇计划（对齐 design，非最小接入）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-28 |
| 类型 | 规划（计划归档；代码待 M1 开工） |
| HANDOFF 已更新 | 是 |

## 背景

P0–P9 已完成。当前 `@monai/model-stub` 可驱动 Run/Policy/Tool/Eval 闭环，但相对 [design/02](../../design/02-core-architecture.md)、[03](../../design/03-run-lifecycle.md)、[05](../../design/05-context-and-data.md)、[06](../../design/06-safety-and-control.md)、[07](../../design/07-observability-and-evaluation.md)、[08](../../design/08-mvp-and-evolution.md) 仍缺：

- 完整 Context Builder + `ContextBuildRecord`
- 调用前 BudgetGuard（step/token/cost/wall）
- Manifest 冻结 Model Policy 与 Engine fallback/解析重试（同 Step、新 `modelCallId`）
- `SecretPort` 凭证 lease（密钥不进 Context/Event）
- `model.called`/`model.responded` usage + 冻结价表 → Token/cost 指标

**已确认范围**：模型相邻完整簇；**KnowledgePort 检索本轮不实装**（Builder 仍写记录，`knowledgeSelections`/`knowledgeFragments` 可为空）。

**禁止**：用「env 直读 API Key + goal 塞进 prompt」替代上述契约。

## 设计依据（链接，不复述）

| 设计 | 约束摘要 |
| --- | --- |
| 02 §7 | `ModelPort.completeStructured(context, schema, modelPolicy)` |
| 02 §8 | 冻结 Model Policy 内重试/fallback；耗尽 → Step failed |
| 03 §4.3 / §5.1 | 预算检查在模型前；fallback/解析重试同 Step、新 `modelCallId` |
| 05 §3–§4.2 | Context Builder 唯一入口；硬预算不足不调模型；持久 `ContextBuildRecord` |
| 06 | Secret 只经 `SecretPort` 短时 lease |
| 07 §4.2 | Token/cost：usage + 冻结价表；Context overflow 指标 |
| 08 §2.1 / §2.8 | Agent budgets + Model Policy；MVP 指标含 Token/cost |

## 现状缺口（代码对照）

| 项 | 现状 |
| --- | --- |
| Context | `buildContext` 薄封装；无 section/预算/截断/记录 |
| Engine | 未传 `modelPolicy`；无 BudgetGuard；无 modelCallId 重试 |
| Manifest | 未冻结 `modelPolicy` / `contextBuilder` digest |
| Event | `model.*` 无 usage；`MVP_METRIC_GAPS` 仍列 Token/cost |
| 装配 | `bootstrap` 写死 `StubModelPort`；无 `SecretPort` |
| Eval | 114 用例继续 stub（07：Golden 固定桩） |

## 建议实现顺序（M1a–M1h）

```text
M1a  contracts：ContextBuildRecord；Manifest.modelPolicy / contextBuilder；
     model.called|responded 载荷（modelCallId、usage、priceTableVersion）
M1b  runtime：BudgetGuard（maxSteps / maxTokens / maxCost / maxWallTime）
M1c  runtime：Context Builder（05 优先级 + ContextBudget；Knowledge 不调用）
M1d  Engine：Manifest Model Policy → ModelPort；fallback/解析重试（03 §4.3）
M1e  SecretPort 最小实现（模型凭证 lease）
M1f  ModelPort 真实 adapter（resolvedTarget → 供应商；结构化 Action）
M1g  observability：Token/cost 重算；Context overflow
M1h  harness 装配 Secret + Model；Eval 仍 StubModelPort
```

**M1 第一刀**：M1a 类型 + M1b 预算检查接入 `execute_turn` 循环头部（03 第 2 步），**不是**先写 HTTP 客户端。

## 改动路径（本 session — 仅文档）

| 文件 | 说明 |
| --- | --- |
| `docs/implementation/sessions/0018-real-model-cluster-plan.md` | 本日志 |
| `docs/implementation/sessions/README.md` | 索引 0018 |
| `docs/implementation/HANDOFF.md` | 焦点 M1 |
| `docs/implementation/STATUS.md` | M1 计划已归档 |
| `docs/implementation/PHASES.md` | 可选 M1 短节 |
| `docs/implementation/adapters/model.md` | M1 退出草稿 |
| `docs/implementation/adapters/secret.md` | M1e 范围 |
| `docs/implementation/packages/runtime.md` | BudgetGuard + Builder |
| `docs/implementation/packages/contracts.md` | ContextBuildRecord / usage |
| `docs/implementation/packages/observability.md` | Token/cost / overflow |
| `docs/implementation/packages/apps-harness.md` | 装配计划 |
| `docs/implementation/packages/ports.md` | Model/Secret 接线 |

## 明确不做（M1）

- KnowledgePort 实装、向量检索、Knowledge miss 门禁（另切）
- Memory 进 Context（08 非目标）
- 用真实模型重跑 Eval / Golden
- 改 Policy 偏序、Tool prepared-before-dispatch、Run 状态机
- ConfirmationGrant、DAG、spawn_child、sandbox.exec
- 宣称 design 08 阶段 A 仅因接供应商而关闭（Knowledge 未做仍缺口）

## 验证

- 文档互链可解析（HANDOFF → 0018 → 包页 → design）
- 无 `apps/`、`packages/` 代码改动

## 未完成

- M1a–M1h 代码实装
- Knowledge 切片（08 §2.6）
