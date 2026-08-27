# 进展：packages/packs/workspace-generic

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/packs/workspace-generic/` |
| 状态 | `not_started` |
| 首触阶段 | P3–P5 |
| 上游 | [design/08](../../design/08-mvp-and-evolution.md)、[engineering/04 §9](../../engineering/04-ports-extensions-and-security.md) |
| 最后更新 | 2026-08-27 |

## 1. 范围

MVP Tool：

```text
workspace.list | workspace.read | workspace.search
artifact.write_markdown | artifact.validate
synthetic.write_high | synthetic.write_high.reconcile
```

- 固定规则 Knowledge、required acceptanceChecks Validator
- 最小 Policy；五个 Hook 点最小可观测实现
- 版本化 Manifest + 权限声明

## 2. 非目标

- 文档研究 / 工单 Pack（仅协议样例，非 MVP 必装）
- sandbox.exec、真实 write_high、语义检索

## 3. 验收清单

- [ ] Manifest 通过 Registry 校验
- [ ] permissions ⊆ permissionsRequested
- [ ] ToolEffectContract 完整（含 synthetic reconcile）
- [ ] 路径防逃逸与输出大小限制（对接 workspace adapter）
- [ ] 不依赖 runtime 内部模块（仅 pack-sdk + contracts）

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| pack-sdk、contracts | |
| workspace / objectstore / synthetic-sink adapters | 运行期 |

## 5. 缺口与风险

- Agent Definition 装配位置（governance vs harness bootstrap）需在 P3 明确

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | 创建进展页 |
