# 进展：packages/packs/workspace-generic

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/packs/workspace-generic/` |
| 状态 | `done`（P9a + write/delete + M3 RAG Tool + sandbox opt-in 元数据） |
| 首触阶段 | P3–P5 |
| 上游 | [design/08](../../design/08-mvp-and-evolution.md)、[engineering/04 §9](../../engineering/04-ports-extensions-and-security.md) |
| 最后更新 | 2026-09-08 |

## 1. 范围

Pack Tool（模型面元数据只在 Manifest，SSOT 见 [0022](../sessions/0022-pack-tool-ssot.md)）：

```text
workspace.list | workspace.read | workspace.search | workspace.write | workspace.delete
artifact.write_markdown | artifact.validate
synthetic.write_high | synthetic.write_high.reconcile
knowledge.search          （defaultEnabled: false；需 KNOWLEDGE_BASE_URL）
sandbox.exec              （defaultEnabled: false；需 FEATURE_ENABLE_SANDBOX_EXEC）
```

- required acceptanceChecks Validator；最小 Policy；Hook 最小可观测
- 版本化 Manifest + 权限声明

## 2. 非目标

- 文档研究 / 工单 Pack（仅协议样例，非 MVP 必装）
- 真实 `write_high` 外部写；默认开放任意 Shell（sandbox 仅 opt-in + 白名单）
- KnowledgePort / Context `knowledge` section（属 ports/runtime；本 Pack 只提供 RAG HTTP Tool）

## 3. 验收清单

- [x] Manifest 通过 Registry 校验（harness / delivery wiring）
- [x] permissions ⊆ permissionsRequested
- [x] ToolEffectContract 完整（含 synthetic reconcile）
- [x] 路径防逃逸与输出大小限制（对接 workspace / objectstore adapter）
- [x] 不依赖 runtime 内部模块（仅 pack-sdk + contracts + 运行期 ports）
- [x] `workspace.write` / `workspace.delete` handler + 默认 allowlist
- [x] `knowledge.search` / `sandbox.exec` 元数据存在且默认不进 allowlist

## 4. 依赖

| 依赖 | 说明 |
| --- | --- |
| pack-sdk、contracts | |
| workspace / objectstore / synthetic-sink / 可选 knowledge-http / sandbox | 运行期经 ExecutionContext |

## 5. 缺口与风险

- Agent Definition 仍经 harness bootstrap / EngineDeps 注入，非独立持久对象

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-09-08 | 进展页纠错：勾选验收；Tool 列表补 delete / knowledge.search / sandbox.exec |
| 2026-09-07 | `sandbox.exec` Pack Tool（defaultEnabled false；0025） |
| 2026-09-02 | `workspace.delete`；`knowledge.search`（0020/0021 族） |
| 2026-09-02 | `workspace.write` handler + Manifest + 默认 allowlist |
| 2026-08-27 | 创建进展页 |
