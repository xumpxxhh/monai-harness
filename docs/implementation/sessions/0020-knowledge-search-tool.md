# Session 0020 — RAG `knowledge.search` Tool（EDR-016）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-02 |
| 类型 | 实现（RAG Tool 切片） |
| HANDOFF 已更新 | 是 |

## 目标

按 [docs/rag/agent-integration.md](../../rag/agent-integration.md) 接入自研 RAG HTTP 为 Pack Tool **`knowledge.search`**（模型按需调用），**不**实现 KnowledgePort 预检索。

## 改动路径

| 切片 | 路径 |
| --- | --- |
| EDR-016 | `docs/engineering/00-implementation-baseline.md` |
| HTTP 客户端 | `packages/adapters/knowledge-http/` |
| Pack Tool | `packages/packs/workspace-generic/src/manifest.ts` |
| 装配 | `packages/delivery/src/pack-wiring.ts`、`apps/harness/src/bootstrap/container.ts` |
| 模型面 | `function-catalog`、`tool-catalog`、`agent-system-prompt`、`build-context` |
| 配置 | `apps/harness/src/config/env.ts`、`.env.example`、`turbo.json` |

## 验证

```text
pnpm --filter @monai/knowledge-http test
pnpm --filter @monai/runtime test
pnpm --filter @monai/delivery test
pnpm --filter harness test
pnpm --filter @monai/observability test   # Eval 仍 stub，114 绿
```

## 未完成（仍属 design 08 §2.6 缺口）

- KnowledgePort + Context Builder `knowledge` section
- `knowledgeSelections` / Knowledge miss 指标
- `list_knowledge_collections` Tool
- RAG 认证网关

## 联调

1. RAG 服务 `pnpm dev:knowledge`，`GET /health` embedding=connected
2. harness `.env`：`KNOWLEDGE_BASE_URL=http://localhost:3001` + `KNOWLEDGE_COLLECTION_IDS=kb-…`
3. Goal 含事实问题；模型应调用 `knowledge.search`；hits 进入 tool 消息与 recent facts
