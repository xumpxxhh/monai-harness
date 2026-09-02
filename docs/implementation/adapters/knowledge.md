# 进展：adapters/knowledge

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/knowledge-http/` |
| 实现形态 | **RAG HTTP 客户端**（Pack Tool `knowledge.search` 后端；EDR-016） |
| KnowledgePort | 仍 `not_started` |
| 状态 | `in_progress`（HTTP 客户端 done；KnowledgePort 后置） |
| 首触阶段 | M3 / RAG Tool 切片 |
| 上游 | [design/08 §2.6](../../design/08-mvp-and-evolution.md)、[docs/rag/agent-integration.md](../../rag/agent-integration.md)、EDR-016 |
| 最后更新 | 2026-09-02 |

## 1. 范围

- `@monai/knowledge-http`：`POST /api/v1/search` 客户端（UTF-8、60s 超时、grounding 映射）
- Pack Tool `knowledge.search` 经 `ExecutionContext.ports.knowledge` 调用
- harness 仅在 `KNOWLEDGE_BASE_URL` 配置时启用 Tool + allowlist

## 2. 非目标

- KnowledgePort.retrieve / Context Builder `knowledge` section
- `list_knowledge_collections` Tool
- RAG 入库、改策略、认证网关
- Eval 114 挂载真实 RAG

## 3. 验收清单

- [x] HTTP 客户端参数映射（query / collectionIds / topK）
- [x] grounding.empty / HTTP 错误可测试
- [x] Pack handler 未配置 client 时 fail closed
- [x] Eval 默认 allowlist 不含 `knowledge.search`
- [ ] KnowledgePort 冻结 source 版本检索（design 08 §2.6）

## 4. 依赖

- `@monai/pack-workspace-generic` handler
- `@monai/delivery` wireWorkspaceGenericPack
- harness env：`KNOWLEDGE_BASE_URL`、`KNOWLEDGE_COLLECTION_IDS`

## 5. 缺口与风险

- RAG 无租户 ACL / 无 Manifest 冻结版本 — 与 design 05 Knowledge Source 语义不同
- 生产需在网关加认证与库级授权（见 agent-integration.md §2）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-09-02 | EDR-016：`knowledge-http` + Pack Tool + harness 装配 |
| 2026-08-27 | 创建进展页（KnowledgePort not_started） |
