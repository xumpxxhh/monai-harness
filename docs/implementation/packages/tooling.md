# 进展：tooling / 仓库根

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | 仓库根 + `tooling/*`（按需） |
| 状态 | `done`（P0） |
| 首触阶段 | P0 |
| 上游 | [turborepo.md](../../turborepo.md)、[engineering/01](../../engineering/01-repository-and-modules.md)、[EDR-001](../../engineering/00-implementation-baseline.md#8-edr-索引) |
| 最后更新 | 2026-08-27 |

## 1. 范围

- pnpm workspace、`packageManager`、Node engines
- 根 `turbo.json`（build/lint/test/check-types/dev）
- 共享 `tsconfig` / eslint / prettier（可放 `tooling/`）
- `.gitignore`（含 `.turbo`、`dist`、`.env`）
- 架构依赖约束工具选型与接入
- 锁定统一 npm scope 名

## 2. 非目标

- 业务代码
- 远程 turbo cache（可后置）

## 3. 验收清单

- [x] `pnpm-workspace.yaml` 覆盖 `apps/*`、`packages/*`、`packages/adapters/*`、`tooling/*`
- [x] 根脚本均为 `turbo run …`
- [x] `pnpm install` + `pnpm build`（空包）可通过
- [x] Core 禁止依赖 adapters/packs 的规则可执行或已文档化待启用
- [x] scope 名写入本文并与各包 `package.json` 一致

**锁定 scope**：`@monai/*`（应用短名 `harness`）。

**架构禁止边**（源自 [engineering/01 §4.2](../../engineering/01-repository-and-modules.md)；本阶段文档化，后续用 `eslint-plugin-boundaries` 或 dependency-cruiser 接入）：

```text
runtime          ──X──► packs/*
runtime          ──X──► adapters/*（无静态 import；仅 DI 注入）
packs/*          ──X──► runtime | api | delivery | adapters/persistence
observability    ──X──► runtime 写路径 / commit API
api              ──X──► adapters/persistence（写）
contracts        ──X──► 任何其他 packages
ports            ──X──► runtime | adapters | packs
任意 core 包     ──X──► 具体 ORM/Redis/OpenAI SDK（仅 adapters 允许）
```

## 4. 依赖

无代码依赖。EDR-007/010 仍 Deferred。

## 5. 缺口与风险

- ESLint / dependency-cruiser 尚未接入；仅文档约束
- packs workspace glob 待建包时再加

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | P1：workspace 增加 `packages/adapters/*`；catalog 增加 zod/vitest |
| 2026-08-27 | P0：根 workspace + turbo + `@monai/tsconfig`；scope=`@monai` |
| 2026-08-27 | 创建进展页 |
