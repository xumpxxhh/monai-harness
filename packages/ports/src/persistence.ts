import type {
  ApprovalRecord,
  Checkpoint,
  Continuation,
  EventEnvelope,
  Run,
  RunState,
  RunStatus,
  ToolCallRecord,
} from "@monai/contracts";

import type { CommitPlan, CommitResult } from "./commit.js";

/**
 * Open unit of work for a single Run (or create path keyed by runId).
 * External Model/Tool/network IO must NOT run while a UoW is open (EDR-003).
 */
export type UnitOfWork = {
  readonly runId: string;
  commit(plan: CommitPlan): Promise<CommitResult>;
  rollback(): Promise<void>;
};

/** Read-only Run list filter (console / ops views). */
export type ListRunsFilter = {
  tenantId: string;
  sessionId?: string;
  status?: RunStatus;
  /** Default 50; capped by adapter. */
  limit?: number;
};

export type PersistencePort = {
  beginUnitOfWork(runId: string): Promise<UnitOfWork>;
  getRun(runId: string): Promise<Run | undefined>;
  listRuns(filter: ListRunsFilter): Promise<Run[]>;
  listEvents(runId: string, fromSequence?: number): Promise<EventEnvelope[]>;
  /** Latest committed Run State snapshot (Reducer output). */
  getState(runId: string): Promise<RunState | undefined>;
  getToolCall(toolCallId: string): Promise<ToolCallRecord | undefined>;
  listToolCalls(runId: string): Promise<ToolCallRecord[]>;
  getApproval(approvalId: string): Promise<ApprovalRecord | undefined>;
  listApprovals(runId: string): Promise<ApprovalRecord[]>;
  getLatestCheckpoint(runId: string): Promise<Checkpoint | undefined>;
  getContinuation(runId: string): Promise<Continuation | undefined>;
  /** Content-addressed State snapshot at Checkpoint boundary (P6 recovery). */
  getStateSnapshot(stateRef: string): Promise<RunState | undefined>;
};
