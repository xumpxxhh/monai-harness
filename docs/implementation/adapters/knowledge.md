# 进展：adapters/knowledge

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/knowledge-*/` |
| 实现端口 | KnowledgePort |
| 状态 | `not_started` |
| 首触阶段 | P3 |
| 上游 | [design/05](../../design/05-context-and-data.md)、[design/08 §2.6](../../design/08-mvp-and-evolution.md)、EDR-014 |
| 最后更新 | 2026-08-27 |

## 1. 范围

- 按 sourceId + version + 权限 + 预算返回带 provenance 的片段
- MVP：精确键 / 标签 / 确定性规则检索 only
- 仅由 ContextBuilder 调用

## 2. 非目标

- 向量检索、语义路由、自动写回
- 查询结果自动变 Fact/State

## 3. 验收清单

- [ ] 冻结版本外数据不可被 Run 静默换用
- [ ] ACL / sensitivity 字段齐全
- [ ] 无向量依赖

## 4. 依赖

ports；runtime ContextBuilder。

## 5. 缺口与风险

- 知识文件布局（Git/JSON）实现时选定并写进本文

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | 创建进展页 |
