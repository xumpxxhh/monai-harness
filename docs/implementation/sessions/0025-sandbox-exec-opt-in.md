# Session 0025 — 真 SandboxPort / `sandbox.exec` opt-in

| 项 | 值 |
| --- | --- |
| 日期 | 2026-09-07 |
| 类型 | 实现（SandboxPort subprocess + Pack Tool 门控） |
| HANDOFF 已更新 | 是 |

## 目标

在 **EDR-014 默认关闭** 的前提下，落地可 opt-in 的可执行 `SandboxPort` 与 Pack Tool `sandbox.exec`。  
`FEATURE_ENABLE_SANDBOX_EXEC=true` 时挂载 `@monai/sandbox-subprocess`；默认仍为 `RejectingSandbox`。  
**EDR-010**（`isolated_extension` 载体）仍 Deferred。

## 载体

Node `child_process.spawn`：argv 数组、`shell: false`、sandboxRoot cwd、二进制白名单、墙钟超时与 stdout/stderr 截断。  
进程级受控执行；**非** cgroup / 网络命名空间 / Docker（Windows 上无完整隔离）。

## 改动路径

| 切片 | 路径 |
| --- | --- |
| EDR-014 注释 | `docs/engineering/00-implementation-baseline.md`、`04-ports-extensions-and-security.md` |
| ports | `packages/ports` — `SandboxExecRequest` / `SandboxExecResult` |
| adapter | `packages/adapters/sandbox-subprocess/` |
| Registry | `packages/runtime` — `allowEdr014Tools`；EDR-014 未放行工具记为 `disabled` |
| Pack Tool | `packages/packs/workspace-generic` — `sandbox.exec`（`defaultEnabled: false`，`requireApproval`） |
| 装配 | `packages/delivery` pack-wiring；`apps/harness` bootstrap / env |

## 验证

```text
pnpm --filter @monai/sandbox-subprocess test
pnpm --filter @monai/sandbox-stub test
pnpm --filter @monai/runtime test
pnpm --filter @monai/delivery test
pnpm --filter harness test
pnpm --filter @monai/observability test
```

## 明确不做

- EDR-010 WASM / worker_threads Pack 隔离
- Redis/SQS；API/Worker 拆分
- 默认开放网络 / 空白名单任意二进制
- Eval / 默认 MVP 装配挂载可执行 sandbox
