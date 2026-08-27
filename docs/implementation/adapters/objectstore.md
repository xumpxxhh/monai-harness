# 进展：adapters/objectstore

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/objectstore-*/` |
| 实现端口 | ObjectStorePort |
| 状态 | `not_started` |
| 首触阶段 | P4 |
| 上游 | [design/01 Artifact](../../design/01-domain-model.md)、[engineering/03](../../engineering/03-persistence-and-transactions.md) |
| 最后更新 | 2026-08-27 |

## 1. 范围

- put / get / signedRef（MVP 可简化为 tenant-scoped path）
- 内容寻址哈希；不可变内容
- Artifact 正文存储；DB 仅元数据

## 2. 非目标

- 原地覆盖同一 ref 内容

## 3. 验收清单

- [ ] hash 校验失败拒绝
- [ ] 租户隔离
- [ ] 与 artifact.write_markdown 联调

## 4. 依赖

ports。

## 5. 缺口与风险

- signedRef 是否 MVP 必需：可先路径引用，在进展页标明

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-08-27 | 创建进展页 |
