import { z } from "zod";

import { schemaVersionSchema, strictObject } from "./schema.js";

/** Core Run lifecycle event types (design 01 section 5.2). */
export const RUN_EVENT_TYPES = [
  "run.created",
  "run.queued",
  "run.lease_acquired",
  "run.lease_lost",
  "run.status_changed",
  "run.completed",
  "run.failed",
  "run.cancelled",
] as const;

/** P3 turn / decision-loop event types (subset of design 01 §5.2). */
export const TURN_EVENT_TYPES = [
  "step.started",
  "step.completed",
  "step.failed",
  "hook.invoked",
  "hook.context_contributed",
  "hook.vetoed",
  "hook.failed",
  "context.built",
  "context.summary_requested",
  "context.summary_created",
  "model.called",
  "model.responded",
  "action.proposed",
  "action.accepted",
  "action.rejected",
  "policy.evaluated",
  "policy.denied",
  "observation.recorded",
  "fact.accepted",
  "fact.rejected",
  "state.reduced",
] as const;

/** P4 ToolCall lifecycle events. */
export const TOOL_EVENT_TYPES = [
  "tool.call_prepared",
  "tool.dispatched",
  "tool.succeeded",
  "tool.failed",
  "tool.outcome_unknown",
  "tool.reconciled",
] as const;

/** P5 Approval / Checkpoint events. */
export const APPROVAL_EVENT_TYPES = [
  "approval.requested",
  "approval.approved",
  "approval.rejected",
  "approval.expired",
  "approval.revoked",
  "approval.consumed",
  "checkpoint.saved",
] as const;

export const KNOWN_EVENT_TYPES = [
  ...RUN_EVENT_TYPES,
  ...TURN_EVENT_TYPES,
  ...TOOL_EVENT_TYPES,
  ...APPROVAL_EVENT_TYPES,
] as const;

export type RunEventType = (typeof RUN_EVENT_TYPES)[number];
export type TurnEventType = (typeof TURN_EVENT_TYPES)[number];
export type ToolEventType = (typeof TOOL_EVENT_TYPES)[number];
export type ApprovalEventType = (typeof APPROVAL_EVENT_TYPES)[number];
export type KnownEventType = (typeof KNOWN_EVENT_TYPES)[number];

export type EventType = KnownEventType | (string & {});

export const runEventTypeSchema = z.enum(RUN_EVENT_TYPES);
export const turnEventTypeSchema = z.enum(TURN_EVENT_TYPES);
export const toolEventTypeSchema = z.enum(TOOL_EVENT_TYPES);
export const approvalEventTypeSchema = z.enum(APPROVAL_EVENT_TYPES);

export const eventProducerSchema = strictObject({
  type: z.string().min(1),
  id: z.string().min(1),
  version: z.string().optional(),
});

const eventCommonFields = {
  schemaVersion: schemaVersionSchema,
  eventId: z.string().min(1),
  eventType: z.string().min(1),
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().optional(),
  modelCallId: z.string().optional(),
  toolCallId: z.string().optional(),
  approvalId: z.string().optional(),
  confirmationGrantId: z.string().optional(),
  artifactId: z.string().optional(),
  tombstoneId: z.string().optional(),
  occurredAt: z.string().min(1),
  causationId: z.string().optional(),
  correlationId: z.string().min(1),
  producer: eventProducerSchema,
  payload: z.unknown().optional(),
  payloadRef: z.string().optional(),
  hash: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
} as const;

/**
 * Event candidate produced by Engine collaborators.
 * Must NOT carry `sequence` — Persistence assigns it inside the UoW.
 */
export const eventCandidateSchema = strictObject({
  ...eventCommonFields,
});

export type EventCandidate = z.infer<typeof eventCandidateSchema>;

export const eventEnvelopeSchema = strictObject({
  ...eventCommonFields,
  sequence: z.number().int().positive(),
  recordedAt: z.string().min(1),
});

export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
