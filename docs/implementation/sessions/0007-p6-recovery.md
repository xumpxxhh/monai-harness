# 0007 — P6 Recovery

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P6 |
| HANDOFF 已更新 | 是 |

## 目标

RecoveryService：Checkpoint 选择 + Event replay + State hash 校验；stale lease 对账路径。

## 改动

- `packages/runtime/src/recovery/`：`replay-events`、`RecoveryService`、`computeStateHash`
- `Engine.acquire_lease` 成功后调用 `recover`
- `persistence-memory`：Checkpoint 提交时存 `stateRef` 快照；`getStateSnapshot`
- `ports`：`PersistencePort.getStateSnapshot`
- `execute-turn`：等待态 Checkpoint 同 UoW 写入 `state`
- `tool-commands`：`observation.recorded` 携带完整 Observation（replay 可重建）

## 验证

```powershell
pnpm --filter @monai/runtime build
pnpm --filter @monai/runtime test
```

- 18 tests passed（含 4 个 recovery L1）

## 未完成

- design 08 完整故障注入矩阵（当前 L1 子集）
- ConfirmationGrant / confirm_once
