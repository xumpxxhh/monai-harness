# Session 0016 — P9 阶段 A 收口计划（修订）

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-28 |
| 类型 | 规划（计划归档；代码待 P9a 开工） |
| HANDOFF 已更新 | 是 |

## 背景

P0–P8 主链已完成。对照 [design/08 阶段 A](../../design/08-mvp-and-evolution.md#阶段-a--mvp-契约闭环)，仍缺 Pack/Registry、Eval 完整矩阵、governance 最小面；**不等于**开阶段 B 或拆 API+Worker。

计划经自评修订：**本轮不做 CreateRun Manifest 冻结**，先做薄 Pack 装配；控制面 Eval 可与 Pack 并行；安全 8 后置。

## 子阶段顺序

```text
P9a   薄 Pack（contracts/types + Registry + workspace-generic + ToolInvoker 注入）
  ↓
P9a2  Manifest 冻结（CreateRun 存 hash；Engine 读 Manifest）
  ↓
P9b   控制面 Eval（恢复 8×5、审批 6×1、幂等 6×5；可与 P9a 并行）
P9b-sec  安全 8×1（依赖 Pack allowlist / 路径规范化）
  ↓
P9c   governance 最小 + Event 可重算时间指标
P9d   运维可选（角色开关、L1-on-PG、EDR-007 README 一致性）
```

## 改动路径（本 session）

| 文件 | 说明 |
| --- | --- |
| `docs/implementation/PHASES.md` | 新增 P9 阶段与子阶段 |
| `docs/implementation/HANDOFF.md` | 焦点切至 P9a；禁区与链接 |
| `docs/implementation/STATUS.md` | P9 行；包/测试 readiness 备注 |
| `docs/implementation/sessions/0016-p9-stage-a-plan.md` | 本日志 |

## P9a 第一刀（下一 session）

1. `packages/contracts`：`AgentDefinition` / `ExecutionManifest` / `PackRegistrationResult` 类型
2. `packages/pack-sdk`：Tool handler + `ExecutionContext`
3. `packages/runtime/src/extension/`：内存 ExtensionRegistry
4. `packages/packs/workspace-generic`：MVP Tool + 5 Hook
5. `workspace-memory` 路径防逃逸；`ToolInvoker` handlers 注入；harness/Eval 注册 Pack

## 明确不做（P9a）

- `ExecutionManifestStorePort` 持久化 + CreateRun 冻结 Manifest
- Engine 删除 `EngineDeps` allowlist 改读 Manifest
- governance 包、KnowledgePort 完整实现、真实 ObjectStore

## 阶段 A 退出说明

即使 P9 全完成，**Token/cost 20% 回归带**仍可能缺 usage + 价表（见 `MVP_METRIC_GAPS`）。不宣称自动关闭阶段 A。

## 验证

- 文档内部链接可解析
- HANDOFF 四节已覆盖；PHASES 含 P9 退出条件草稿

## 未完成

- P9a–P9d 代码实装
- 包进展页勾选（实装后更新 workspace-generic / pack-sdk / runtime / observability / governance）
