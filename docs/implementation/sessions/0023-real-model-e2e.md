# Session 0023 — 真模型 E2E 演示加固

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-07 |
| 类型 | 联调 / 演示硬化 |
| HANDOFF 已更新 | 是 |

## 目标

在本机用真实 OpenAI（或兼容网关）稳定跑完 **Session Demo** 固定剧本：失败可停、归档可复盘。  
**不**改 Eval 114 stub；**不**做 KnowledgePort / confirm_once。

## 前置 `.env`（`apps/harness/.env`）

最小：

```env
MODEL_DRIVER=openai
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
OPENAI_MAX_TOKENS=8192
PERSISTENCE_DRIVER=memory
HARNESS_RUN_EVAL=false
```

兼容网关常见附加项：

```env
OPENAI_AUTH_HEADER=api-key
OPENAI_RESPONSE_FORMAT=none
```

可选 RAG（未设 `KNOWLEDGE_BASE_URL` 则跳过剧本中的知识轮）：

```env
KNOWLEDGE_BASE_URL=http://localhost:3001
KNOWLEDGE_COLLECTION_IDS=kb-...
```

密钥只经 SecretPort；不得写入文档或 Event。

## 命令

```powershell
# 交互 Session
pnpm harness:session

# 非交互冒烟（默认轮 1–2 + /exit）
pnpm harness:session:smoke
# 自定义消息用 || 分隔：
# $env:HARNESS_SMOKE_MESSAGES="列出工作区||把 hello 写入 /notes/e2e-smoke.md||/exit"; pnpm harness:session:smoke
```

等价：`turbo build harness` 后 `pnpm --filter harness demo:session` / `demo:session:smoke`。  
归档根：`temp/demo-sessions/<sessionId>/`（含 `transcript.jsonl`、`runs/<runId>/model-input|model-context|final/`）。

## 固定剧本

| 轮 | 用户输入（示例） | 期望 |
| --- | --- | --- |
| 1 | `列出工作区根目录` | `workspace_list`（或等价）→ 可读答复 → finish |
| 2 | `把「hello e2e」写入 /notes/e2e-smoke.md` | `workspace_write` → finish；磁盘可见 |
| 3 | （可选）`根据知识库简述 X` | 仅当配置了 RAG：`knowledge_search` → 引用 hits，不编造 |
| 4 | （可选）`删除 /notes/e2e-smoke.md` | `awaiting_approval` → 批准 → delete |
| 5 | `/exit` | Session 结束 |

最小验收：**轮 1 + 轮 2** 即可。

## 成功判据

- 相关 Run 进入终态（如 `succeeded`）或明确 `aborted`（失败剧本）
- `model-input/*.json` 含最终 `systemPrompt`；若有分层观测则含 `systemPromptLayers`
- timeline / final 可复盘；无无限 `(1/3)` 停滞刷屏
- stub Eval 仍绿：`pnpm --filter @monai/observability test`

## 失败判据（必须可停）

- 网络 / 坏 Key：`step.failed` 连续无真实进展时，`stagnantTurns` 累加至 `MAX_STAGNANT=3` → `aborted`
- **不得**因 revision 抬升而清零停滞计数（见 `demo-shared.ts`）
- 相同 toolId+args 连续 ≥2 次无 finish → abort

## 改动路径

| 切片 | 路径 |
| --- | --- |
| 停滞清零修复 + 失败日志 | `apps/harness/src/cli/demo-shared.ts` |
| 脚本化冒烟 CLI | `apps/harness/src/cli/demo-session-smoke.ts` |
| 交接 | `docs/implementation/HANDOFF.md` |
| 本笔记 | `docs/implementation/sessions/0023-real-model-e2e.md` |

## 验证

```text
pnpm --filter @monai/runtime test
pnpm --filter @monai/observability test
pnpm harness:session:smoke   # 或人工 pnpm harness:session 跑轮 1–2
```

## 已知故障（已修）

- **`tool_call idempotency requestHash mismatch`（Postgres）**  
  原因：`workspace_write` 等工具 `idempotencyScope=run`，但 dedupe 曾按裸 `idempotencyKey` 做租户级去重；模型跨 Session Run 复用短 key 且参数不同即冲突。  
  修复：`prepare-tool-calls` 对 `run` scope 使用 `run:{runId}:{key}` 作为持久化 dedupeKey。

## 未完成 / 后续可选

- RAG 专用一轮进冒烟默认路径
- `PERSISTENCE_DRIVER=postgres` + `pnpm db:up`
- `HARNESS_MODE=serve` SSE 冒烟
- KnowledgePort、confirm_once（显式延后）
