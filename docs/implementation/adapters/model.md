# 进展：adapters/model

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/model-*/` |
| 实现端口 | ModelPort |
| 状态 | `in_progress`（`model-stub`） |
| 首触阶段 | P3（先 stub） |
| 上游 | [engineering/04](../../engineering/04-ports-extensions-and-security.md)、设计 02 ModelPort |
| 最后更新 | 2026-08-27 |

## 1. 范围

- `completeStructured(context, schema, modelPolicy)`
- MVP：确定性 stub / 固定夹具；后再接真实供应商
- 不执行副作用、不写 State、密钥不进 Context

## 2. 非目标

- 在 adapter 内做 Policy/审批
- 无限重试绕过 Budget

## 3. 验收清单

- [x] stub 可驱动主路径（echo / deny-me / approve-me / finish / noop / workspace-read / workspace-search / artifact / acceptance→finish）
- [ ] 失败/超时映射为结构化错误供 Engine 计量 attempt
- [ ] 真实供应商适配可选、可切换

## 4. 依赖

ports、contracts；Secret/配置注入（真实供应商阶段）。

## 5. 缺口与风险

- 供应商锁定不在本阶段强制

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | Golden：`workspace-search`；`acceptance` + lastFactId → finish |
| 2026-08-27 | P3：`@monai/model-stub` StubModelPort |
| 2026-08-27 | 创建进展页 |
