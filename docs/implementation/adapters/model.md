# 进展：adapters/model

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/model-*/` |
| 实现端口 | ModelPort |
| 状态 | `done`（stub + openai；M1f + M2b function calling） |
| 首触阶段 | P3（先 stub）；M1f 真实供应商 |
| 上游 | [engineering/04](../../engineering/04-ports-extensions-and-security.md)、[design/02 §7 ModelPort](../../design/02-core-architecture.md#7-端口清单) |
| 最后更新 | 2026-09-02 |

## 1. 范围

- `completeStructured(context, controlFunctions, domainTools, modelPolicy)` — 返回厂商中立 `ModelDecision`（`content` + `calls[]`）；**modelPolicy 必传**（M1d）
- Runtime 生成 canonical function catalog（控制函数 vs 领域 tools）；adapter 翻译成供应商 `tools` / `tool_calls`（允许多 call 批次）
- OpenAI adapter 优先消费 `ModelCompleteInput.messages`（Dialogue 投影）；无 messages 时回退 legacy context 字段
- MVP：确定性 stub / 固定夹具；真实供应商走 `@monai/model-openai`
- 不执行副作用、不写 State、密钥不进 Context（只经 SecretPort lease）
- 不在 adapter 内生成 Action

## 2. 非目标

- 在 adapter 内做 Policy/审批
- 无限重试绕过 Budget

## 3. 验收清单

- [x] stub 可驱动主路径（echo / deny-me / approve-me / finish / noop / workspace-read / workspace-search / workspace-write / artifact / acceptance→finish）
- [x] 失败/超时映射为结构化错误供 Engine 计量 attempt（M1d）
- [x] 真实供应商适配：`@monai/model-openai` 按 `resolvedTarget` 调 API；返回 `ModelDecision`（不再吐 Action JSON）
- [x] 调用边界经 SecretPort 取凭证；usage 回传供 Event（M1f）

## M1 退出条件

见 [sessions/0018](../sessions/0018-real-model-cluster-plan.md) M1f；[PHASES §M1](../PHASES.md#m1--真实模型簇可选)。已全部达成。

## 4. 依赖

ports、contracts、secret-env；Secret/配置注入。

## 5. 缺口与风险

- 供应商锁定不在本阶段强制
- Eval / Golden 114 必须继续 stub（07 门禁）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-09-02 | OpenAI adapter 支持 `ModelCompleteInput.messages` 优先；多 `tool_calls` 批次 |
| 2026-09-01 | ModelPort 改为 function calling：canonical catalog in、`ModelDecision` out；OpenAI adapter 翻译 `tools`/`tool_calls` |
| 2026-08-28 | M1f 实装完成：`@monai/model-openai` 支持 OpenAI 兼容端点 + usage 提取 + SecretPort 租约 |
| 2026-08-28 | M1 计划归档：真实 adapter + SecretPort + usage；见 0018 |
| 2026-08-27 | Golden：`workspace-search`；`acceptance` + lastFactId → finish |
| 2026-08-27 | P3：`@monai/model-stub` StubModelPort |
| 2026-08-27 | 创建进展页 |
