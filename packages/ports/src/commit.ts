import type {
  ApprovalRecord,
  Checkpoint,
  Continuation,
  EventCandidate,
  IdempotencyRecord,
  OutboxRecord,
  Run,
  RunState,
  ToolCallRecord,
} from "@monai/contracts";
import type { ErrorCategory } from "@monai/contracts";

/**
 * Commit plan assembled by Engine; Persistence assigns sequences and bumps revision.
 * Shape aligned with engineering/03 section 4.
 */
export type CommitPlan = {
  expectedRevision: number;
  expectedLeaseEpoch: number;
  events: EventCandidate[];
  runPatch?: Partial<Run>;
  /** When creating a new Run (e.g. UoW-CreateRun), supply the full initial row. */
  runCreate?: Run;
  idempotency?: IdempotencyRecord[];
  outbox?: OutboxRecord[];
  /** Reserved for later phases — Persistence may ignore until implemented. */
  steps?: unknown[];
  /** Reducer output; persisted with fact.accepted / state.reduced. */
  state?: RunState;
  stateHash?: string;
  toolCalls?: ToolCallRecord[];
  approvals?: ApprovalRecord[];
  confirmationGrants?: unknown[];
  checkpoint?: Checkpoint;
  continuation?: Continuation;
  /** When true, clear active continuation after commit (e.g. after consume+prepared). */
  clearContinuation?: boolean;
  artifactsMeta?: unknown[];
  /** MVP: write path disabled (EDR-014). */
  childRunLinks?: unknown[];
};

export type CommitSuccess = {
  ok: true;
  revision: number;
  sequences: number[];
  leaseEpoch: number;
};

export type CommitFailure = {
  ok: false;
  code: ErrorCategory;
  message?: string;
};

export type CommitResult = CommitSuccess | CommitFailure;
