# HANDOFF — 实现交接

> 最后更新：2026-09-02（**Pack Tool SSOT**：模型面元数据只在 Pack Manifest）

## 当前状态（一句话）

**P0–P9、M1、M2 已完成；RAG `knowledge.search` 与 `workspace.write` 已接入；Pack 为 Tool 扩展唯一来源。**
- 加工具：只改 Pack `handler` + `tools[]`（description / parameters / argHint / systemPrompt / defaultEnabled / requireApproval）
- Runtime 从 Registry / 冻结 Manifest 投影 catalog、prompt、context；`TOOL_CATALOG` 仅保留 `echo` / `risky.write`
- **KnowledgePort / Context `knowledge` section 仍缺口** — 不得宣称 design 08 阶段 A 关闭

## 下一步

1. **KnowledgePort 检索切片**（design 08 §2.6：冻结 source 版本 + Context selections；与 RAG Tool 并存或收敛策略待定）
2. **ConfirmationGrant / confirm_once**（P5 增强）
3. **真实单机 / Docker 联调与真实模型 End-to-End 演示加固**（含 RAG + OpenAI 联调）

## 禁区

- Eval / Golden 114 用例不得改用真实模型（07：固定 Tool 桩）
- Eval 默认不得挂载 RAG 客户端（无 `KNOWLEDGE_BASE_URL`）
- 模型 API Key 不得进 Context / Event 明文（只经 SecretPort lease）
- 不得在 Reducer / Hook 中绕过安全边界
- 不宣称 design 08 阶段 A 仅因接 RAG Tool 而关闭（KnowledgePort 未做仍缺口）
- **不得**在 runtime 为新 Pack Tool 硬编码 DOMAIN_TOOL_DEFS / TOOL_ARG_HINTS / system-prompt 分支

## 回归基线

```text
pnpm --filter @monai/pack-sdk build
pnpm --filter @monai/pack-workspace-generic build
pnpm --filter @monai/runtime test
pnpm --filter @monai/delivery test
pnpm --filter @monai/observability test     # 114 Eval（stub）
pnpm --filter harness test
```

## 关键路径

| 用途 | 路径 |
| --- | --- |
| 加工具作者清单 | `docs/engineering/04-ports-extensions-and-security.md` §9.1 |
| Pack Manifest SSOT | `packages/packs/workspace-generic/src/manifest.ts` |
| packDefaultAllowlist | `packages/pack-sdk/src/index.ts` |
| Registry 完整定义 | `packages/runtime/src/extension/extension-registry.ts` |
| SSOT 回归 | `packages/runtime/src/extension/pack-tool-ssot.test.ts` |
| RAG 接入文档 | `docs/rag/agent-integration.md` |
| 装配 | `packages/delivery/src/pack-wiring.ts` |
| Function catalog | `packages/runtime/src/model/function-catalog.ts`（只消费 toolDefs） |
