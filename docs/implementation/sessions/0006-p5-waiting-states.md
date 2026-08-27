# 0006 — P5 等待态

| 项 | 值 |
| --- | --- |
| 日期 | 2026-08-27 |
| 阶段 | P5 → `done` |
| HANDOFF 已更新 | 是 |

## 目标

Approval / ask_user / Checkpoint：等待只唤醒到 queued；消费与 prepared 同 UoW。

## 改动

- contracts：ApprovalRecord / Checkpoint / Continuation；approval.* + checkpoint.saved
- ports：CommitPlan 类型；Persistence getters
- persistence-memory：持久化审批/检查点/续写；commit 戳 revision/sequence
- runtime：wait → awaiting_* + release lease；approval_decision / submit_input；resume consume+prepared
- api：`buildApprovalDecisionCommand` / `buildSubmitInputCommand`
- delivery：approval-chain L1（含默认 synthetic require_approval）

## 验证

- [x] `pnpm build`
- [x] runtime 14 + delivery 10 + persistence 3

## 未完成

- ConfirmationGrant / confirm_once
- Checkpoint 恢复（P6）
- L2 PG；HTTP（EDR-007）
