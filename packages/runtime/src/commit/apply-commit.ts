import type { CommitPlan, CommitResult, UnitOfWork } from "@monai/ports";

import { orderEventCandidates } from "../ordering/order-events.js";

export type ApplyCommitOptions = {
  /** When true (default), reorder plan.events by lifecycle stage before commit. */
  orderEvents?: boolean;
};

/**
 * Apply a CommitPlan through an already-open UnitOfWork.
 * Does not perform Model/Tool/network IO (EDR-003).
 */
export async function applyCommit(
  uow: UnitOfWork,
  plan: CommitPlan,
  options: ApplyCommitOptions = {},
): Promise<CommitResult> {
  const orderEvents = options.orderEvents ?? true;

  if (plan.expectedRevision < 0 || plan.expectedLeaseEpoch < 0) {
    return {
      ok: false,
      code: "validation",
      message: "expectedRevision/expectedLeaseEpoch must be non-negative",
    };
  }

  if (!plan.runCreate && plan.events.length === 0 && !plan.runPatch) {
    return {
      ok: false,
      code: "validation",
      message: "CommitPlan has no events, runCreate, or runPatch",
    };
  }

  const orderedPlan: CommitPlan = orderEvents
    ? { ...plan, events: orderEventCandidates(plan.events) }
    : plan;

  return uow.commit(orderedPlan);
}
