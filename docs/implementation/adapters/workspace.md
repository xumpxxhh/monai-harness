# 进展：adapters/workspace

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/workspace-*/` |
| 实现端口 | WorkspacePort |
| 状态 | `in_progress`（`workspace-memory`） |
| 首触阶段 | P4 |
| 上游 | [design/08 §2.4](../../design/08-mvp-and-evolution.md)、[engineering/04](../../engineering/04-ports-extensions-and-security.md) |
| 最后更新 | 2026-08-27 |

## 1. 范围

- list / read / write / search 逻辑工作区
- 授权根 `/`、拒绝 `..` / 盘符段
- 测试可用内存 FS

## 2. 非目标

- 依赖 sandbox.exec
- 跨租户根

## 3. 验收清单

- [x] 基础路径逃逸（`..`、非绝对、drive）拒绝
- [x] 写操作仅经 Tool 调用链（Invoker）
- [ ] Windows 连接点/大小写完整矩阵
- [ ] 多租户根隔离

## 4. 依赖

ports。

## 5. 缺口与风险

- Windows 路径细节需后续测试矩阵

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | P4：`@monai/workspace-memory` |
| 2026-08-27 | 创建进展页 |
