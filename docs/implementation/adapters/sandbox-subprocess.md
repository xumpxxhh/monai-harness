# 进展：adapters/sandbox-subprocess

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/sandbox-subprocess/` |
| 实现端口 | SandboxPort |
| 状态 | `done`（opt-in） |
| 首触阶段 | 0025 |
| 上游 | EDR-014 澄清、[design/06 §9](../../design/06-safety-and-control.md)、[0025](../sessions/0025-sandbox-exec-opt-in.md) |
| 最后更新 | 2026-09-07 |

## 1. 范围

- `SubprocessSandbox`：`spawn` argv、`shell: false`、sandboxRoot、二进制白名单、超时、输出截断
- 仅在 `FEATURE_ENABLE_SANDBOX_EXEC=true` 时由 harness 挂载

## 2. 非目标

- EDR-010 `isolated_extension` / Docker / cgroup / 网络命名空间
- 空白名单任意二进制；默认开放网络

## 3. 验收清单

- [x] 空白名单 fail-closed
- [x] 非白名单 / 带路径分隔的 argv[0] 拒绝
- [x] cwd 必须落在 sandboxRoot 内
- [x] 超时与截断有界；截断/超时不得伪装完整成功（Tool 层 `ok: false`）
- [x] 默认装配仍用 RejectingSandbox

## 4. 依赖

ports。包：`@monai/sandbox-subprocess`。

## 5. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-09-07 | 初版 SubprocessSandbox + L0 单测（0025） |
