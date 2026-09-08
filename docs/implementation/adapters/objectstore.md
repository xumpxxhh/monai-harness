# 进展：adapters/objectstore

## 元信息

| 项 | 值 |
| --- | --- |
| 计划路径 | `packages/adapters/objectstore-*/` |
| 实现端口 | ObjectStorePort |
| 状态 | `done`（`objectstore-fs`；artifact Tool 已接入） |
| 首触阶段 | P4 |
| 上游 | [design/01 Artifact](../../design/01-domain-model.md)、[engineering/03](../../engineering/03-persistence-and-transactions.md) |
| 最后更新 | 2026-09-08 |

## 1. 范围

- put / get / signedRef（MVP：`file://`）
- 内容 sha256 校验；路径防逃逸；租户目录隔离
- Artifact 正文：`artifact.write_markdown` / `artifact.validate` → `ports.objectStore`

## 2. 非目标

- 时效签名 URL / 云对象存储
- 另建 memory adapter 包（Eval 默认用 tmpdir 上的 `FsObjectStore`）

## 3. 验收清单

- [x] hash 校验失败拒绝
- [x] 租户隔离
- [x] 与 artifact.write_markdown / validate 联调（Eval 114 仍绿）

## 4. 依赖

ports。包：`@monai/objectstore-fs`。

## 5. 缺口与风险

- signedRef 为本地 `file://`，非云签名 URL
- Artifact 元数据仍不进 DB `artifacts_meta`

## 6. 最近变更

| 日期 | 说明 |
| --- | --- |
| 2026-09-08 | 抽检：artifact→FsObjectStore 口径与代码一致；日期刷新 |
| 2026-09-07 | 撤回误加的 `@monai/objectstore-memory`；统一 `FsObjectStore`（tmpdir 默认） |
| 2026-09-07 | artifact Tool 迁 ObjectStorePort；harness `HARNESS_OBJECT_STORE_DIR` |
| 2026-09-07 | `@monai/objectstore-fs` 落地 |
| 2026-08-27 | 创建进展页 |
