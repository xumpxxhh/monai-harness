export {
  CONTRACTS_SCHEMA_VERSION,
  schemaVersionSchema,
  strictObject,
  type SchemaVersion,
} from "./schema.js";

export {
  ERROR_CATEGORIES,
  errorCategorySchema,
  harnessErrorSchema,
  type ErrorCategory,
  type HarnessError,
} from "./errors.js";

export {
  RUN_STATUSES,
  createInitialRun,
  packVersionRefSchema,
  runSchema,
  runStatusSchema,
  runStrategySchema,
  type Run,
  type RunStatus,
} from "./run.js";

export {
  APPROVAL_EVENT_TYPES,
  KNOWN_EVENT_TYPES,
  RUN_EVENT_TYPES,
  TOOL_EVENT_TYPES,
  TURN_EVENT_TYPES,
  approvalEventTypeSchema,
  eventCandidateSchema,
  eventEnvelopeSchema,
  eventProducerSchema,
  runEventTypeSchema,
  toolEventTypeSchema,
  turnEventTypeSchema,
  type ApprovalEventType,
  type EventCandidate,
  type EventEnvelope,
  type EventType,
  type KnownEventType,
  type RunEventType,
  type ToolEventType,
  type TurnEventType,
} from "./event.js";

export {
  ACTION_TYPES,
  POLICY_DECISIONS,
  actionSchema,
  actionTypeSchema,
  policyDecisionSchema,
  type Action,
  type ActionType,
  type PolicyDecision,
} from "./action.js";

export {
  createEmptyRunState,
  factEnvelopeSchema,
  observationSchema,
  observationSourceKindSchema,
  runStateSchema,
  type FactEnvelope,
  type Observation,
  type RunState,
} from "./observation.js";

export {
  TOOL_CALL_STATUSES,
  deliverySemanticsSchema,
  sideEffectProfileSchema,
  toolCallRecordSchema,
  toolCallStatusSchema,
  toolEffectContractSchema,
  type ToolCallRecord,
  type ToolCallStatus,
  type ToolEffectContract,
} from "./tool-call.js";

export {
  idempotencyNamespaceSchema,
  idempotencyOwnerRefSchema,
  idempotencyRecordSchema,
  idempotencyResultRefSchema,
  idempotencyStatusSchema,
  outboxAggregateRefSchema,
  outboxMessageSchema,
  outboxRecordSchema,
  outboxStatusSchema,
  type IdempotencyRecord,
  type OutboxMessage,
  type OutboxRecord,
} from "./records.js";

export {
  APPROVAL_REQUEST_KINDS,
  APPROVAL_STATUSES,
  approvalApproverSchema,
  approvalRecordSchema,
  approvalRequestKindSchema,
  approvalStatusSchema,
  type ApprovalRecord,
  type ApprovalRequestKind,
  type ApprovalStatus,
} from "./approval.js";

export {
  CONTINUATION_KINDS,
  checkpointSchema,
  continuationKindSchema,
  continuationSchema,
  type Checkpoint,
  type Continuation,
  type ContinuationKind,
} from "./checkpoint.js";

export {
  ACCEPTANCE_SELECTOR_TYPES,
  acceptanceCheckSchema,
  acceptanceSelectorTypeSchema,
  type AcceptanceCheck,
  type AcceptanceSelectorType,
} from "./acceptance.js";

/** Package identity (kept for P0 smoke imports). */
export const PACKAGE_NAME = "@monai/contracts" as const;
