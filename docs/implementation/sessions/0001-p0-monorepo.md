# 0001 — P0 Monorepo 骨架 + EDR 关闭

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P0 → `done` |
| HANDOFF 已更新 | 是 |

## 目标

关闭 EDR-005/006/008/009，搭建 pnpm + Turborepo 空仓，使 stub 包可 build / check-types，harness 可 start。

## 改动

- 工程：`docs/engineering/00`、`03`、`04`、`README` — EDR Accepted 回写
- 根：`package.json`、`pnpm-workspace.yaml`、`turbo.json`、`.npmrc`、`.gitignore`、`tsconfig.json`
- `tooling/tsconfig`（base + library）
- 包 stub：`@monai/contracts|ports|runtime|api|delivery`、`apps/harness`
- 进展：STATUS / PHASES / HANDOFF / packages 进展页 / 本会话日志

## 验证

- [x] `pnpm install`
- [x] `pnpm build`
- [x] `pnpm check-types`
- [x] `pnpm --filter harness start`

## 未完成

- P1 contracts/ports/persistence/runtime commit
- ESLint boundaries / dependency-cruiser 实际接入
- adapters/packs 目录（按计划延后）
