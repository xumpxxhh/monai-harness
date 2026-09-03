# Session 0022 — Pack Tool SSOT

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-02 |
| 类型 | 重构（扩展模型接线） |
| HANDOFF 已更新 | 是 |

## 目标

把 Tool 模型面元数据收回 Pack Manifest，Runtime 只消费 Registry / 冻结 Manifest；加工具不必改 Core catalog / prompt / hints。

## 改动路径

| 切片 | 路径 |
| --- | --- |
| packDefaultAllowlist / packRequireApprovalTools | `packages/pack-sdk/src/index.ts` |
| Manifest 填满字段 + 派生 allowlist | `packages/packs/workspace-generic/src/manifest.ts` |
| Registry 存完整 PackToolDefinition | `packages/runtime/src/extension/extension-registry.ts` |
| 冻结 Manifest 拷贝完整字段 | `packages/runtime/src/manifest/build-manifest.ts` |
| catalog / prompt / context / hydrate | `function-catalog.ts`、`agent-system-prompt.ts`、`build-context.ts`、`execute-turn.ts` |
| TOOL_CATALOG 收缩 | `packages/runtime/src/execution/tool-catalog.ts`（仅 echo / risky.write） |
| SSOT 回归 | `packages/runtime/src/extension/pack-tool-ssot.test.ts` |
| 作者清单 | `docs/engineering/04-ports-extensions-and-security.md` §9.1 |

## 验证

```text
pnpm --filter @monai/runtime test
pnpm --filter @monai/delivery test
pnpm --filter @monai/observability test
```

## 未完成

- `definePackTool` 合成 handler + 声明（后续 DX）
- KnowledgePort / Context `knowledge` section
