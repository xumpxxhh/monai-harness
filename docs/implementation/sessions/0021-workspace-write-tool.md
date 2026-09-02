# Session 0021 — `workspace.write` Tool

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-02 |
| 类型 | 实现（Pack Tool） |
| HANDOFF 已更新 | 是 |

## 目标

把已存在的 `WorkspacePort.write` / catalog 占位接成可用 Pack Tool **`workspace.write`**（`write_low`，默认 allowlist）。

## 改动路径

| 切片 | 路径 |
| --- | --- |
| Pack handler + Manifest + allowlist | `packages/packs/workspace-generic/src/manifest.ts` |
| Function catalog / prompt / hints | `function-catalog.ts`、`agent-system-prompt.ts`、`build-context.ts` |
| Stub 驱动 | `packages/adapters/model-stub/src/index.ts`（goal 含 `workspace-write`） |
| L1 | `packages/delivery/src/tool-chain.test.ts` |

## 验证

```text
pnpm --filter @monai/runtime test
pnpm --filter @monai/delivery test
pnpm --filter @monai/workspace-memory test
pnpm --filter harness test
pnpm --filter @monai/observability test
```

## 未完成

- KnowledgePort / Context `knowledge` section
- ConfirmationGrant / confirm_once
