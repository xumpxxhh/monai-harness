# 进展：adapters/sandbox-stub

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/sandbox-stub/` |
| 实现端口 | SandboxPort |
| 状态 | `done` |
| 首触阶段 | P0/P4（占位） |
| 上游 | [design/08 §2.7](../../design/08-mvp-and-evolution.md)、EDR-014、[0025](../sessions/0025-sandbox-exec-opt-in.md) |
| 最后更新 | 2026-09-07 |

## 1. 范围

- 实现端口但 **拒绝** `exec` / 任意代码 / Shell
- 保证 DI 可注入「无能力」实现，避免误挂真沙箱
- **默认** harness / Eval / L1 wiring 使用本实现

## 2. 非目标

- 提供真实隔离执行（见 `@monai/sandbox-subprocess` opt-in）

## 3. 验收清单

- [x] 任何 exec 调用返回明确拒绝错误（`RejectingSandbox`）
- [x] Agent allowlist / Registry 测试：默认不得注册 sandbox.exec（未 `allowEdr014Tools`）
- [x] 文档与装配注释标明 MVP 默认禁用（EDR-014；harness bootstrap fail-closed）

## 4. 依赖

ports。包：`@monai/sandbox-stub`。

## 5. 缺口与风险

- 防止未开 flag 误挂可执行 sandbox（装配断言 + Registry 默认 disabled）

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-09-07 | 0025：仍为默认实现；可执行路径见 sandbox-subprocess |
| 2026-09-07 | `@monai/sandbox-stub`：`RejectingSandbox`；delivery/runtime/harness 注入 |
| 2026-08-27 | 创建进展页 |
