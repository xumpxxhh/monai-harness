# 进展：adapters/sandbox-stub

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/sandbox-stub/` |
| 实现端口 | SandboxPort |
| 状态 | `not_started` |
| 首触阶段 | P0/P4（占位） |
| 上游 | [design/08 §2.7](../../design/08-mvp-and-evolution.md)、EDR-014 |
| 最后更新 | 2026-08-27 |

## 1. 范围

- 实现端口但 **拒绝** `exec` / 任意代码 / Shell
- 保证 DI 可注入「无能力」实现，避免误挂真沙箱

## 2. 非目标

- 提供真实隔离执行（后 MVP）

## 3. 验收清单

- [ ] 任何 exec 调用返回明确拒绝错误
- [ ] Agent allowlist / Registry 测试：不得注册 sandbox.exec 工具
- [ ] 文档与装配注释标明 MVP 禁用

## 4. 依赖

ports。

## 5. 缺口与风险

- 防止「开发方便」换成真 sandbox 而未改 EDR/门禁

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | 创建进展页 |
