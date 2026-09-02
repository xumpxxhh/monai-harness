# HANDOFF — 实现交接

> 最后更新：2026-09-02（**RAG `knowledge.search` Tool 已实装**）

## 当前状态（一句话）

**P0–P9、M1、M2 已完成；RAG HTTP 已以 Pack Tool `knowledge.search` 接入（EDR-016，模型按需检索）。**
- 配置 `KNOWLEDGE_BASE_URL` 时 harness 注入 `@monai/knowledge-http` 并将 Tool 加入 allowlist
- 未配置时 Eval / 默认装配行为不变（114 stub 仍绿）
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

## 回归基线

```text
pnpm --filter @monai/knowledge-http test
pnpm --filter @monai/runtime test
pnpm --filter @monai/secret-env test
pnpm --filter @monai/model-openai test
pnpm --filter @monai/observability test     # 114 Eval（stub）
pnpm --filter harness test
```

## 关键路径

| 用途 | 路径 |
| --- | --- |
| RAG 接入文档 | `docs/rag/agent-integration.md` |
| Session 0020 | `docs/implementation/sessions/0020-knowledge-search-tool.md` |
| HTTP 客户端 | `packages/adapters/knowledge-http/src/knowledge-client.ts` |
| Pack handler | `packages/packs/workspace-generic/src/manifest.ts` |
| 装配 | `packages/delivery/src/pack-wiring.ts`、`apps/harness/src/bootstrap/container.ts` |
| 环境变量 | `apps/harness/src/config/env.ts`、`.env.example` |
| Function catalog | `packages/runtime/src/model/function-catalog.ts` |
| System prompt | `packages/runtime/src/model/agent-system-prompt.ts` |
