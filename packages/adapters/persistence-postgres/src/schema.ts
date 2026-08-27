import { integer, jsonb, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

import type {
  ApprovalRecord,
  Checkpoint,
  Continuation,
  EventEnvelope,
  IdempotencyRecord,
  OutboxRecord,
  Run,
  RunState,
  ToolCallRecord,
} from "@monai/contracts";

/**
 * Drizzle table defs. Domain objects live in JSONB `body`;
 * scalar columns exist for locking, uniqueness, and scans (engineering/03 §2.1 / §9).
 */
export const runs = pgTable("runs", {
  runId: text("run_id").primaryKey(),
  tenantId: text("tenant_id").notNull(),
  status: text("status").notNull(),
  revision: integer("revision").notNull(),
  leaseEpoch: integer("lease_epoch").notNull(),
  updatedAt: text("updated_at").notNull(),
  body: jsonb("body").$type<Run>().notNull(),
});

export const events = pgTable(
  "events",
  {
    eventId: text("event_id").primaryKey(),
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    sequence: integer("sequence").notNull(),
    eventType: text("event_type").notNull(),
    body: jsonb("body").$type<EventEnvelope>().notNull(),
  },
  (t) => [uniqueIndex("events_tenant_run_seq_uidx").on(t.tenantId, t.runId, t.sequence)],
);

export const runState = pgTable("run_state", {
  runId: text("run_id").primaryKey(),
  body: jsonb("body").$type<RunState>().notNull(),
});

export const toolCalls = pgTable("tool_calls", {
  toolCallId: text("tool_call_id").primaryKey(),
  runId: text("run_id").notNull(),
  status: text("status").notNull(),
  body: jsonb("body").$type<ToolCallRecord>().notNull(),
});

export const approvals = pgTable("approvals", {
  approvalId: text("approval_id").primaryKey(),
  runId: text("run_id").notNull(),
  status: text("status").notNull(),
  body: jsonb("body").$type<ApprovalRecord>().notNull(),
});

export const checkpoints = pgTable("checkpoints", {
  checkpointId: text("checkpoint_id").primaryKey(),
  runId: text("run_id").notNull(),
  sequence: integer("sequence").notNull(),
  stateRef: text("state_ref").notNull(),
  body: jsonb("body").$type<Checkpoint>().notNull(),
});

export const continuations = pgTable("continuations", {
  runId: text("run_id").primaryKey(),
  body: jsonb("body").$type<Continuation>().notNull(),
});

export const stateSnapshots = pgTable("state_snapshots", {
  stateRef: text("state_ref").primaryKey(),
  body: jsonb("body").$type<RunState>().notNull(),
});

export const outbox = pgTable("outbox", {
  outboxRecordId: text("outbox_record_id").primaryKey(),
  status: text("status").notNull(),
  availableAt: text("available_at").notNull(),
  claimOwner: text("claim_owner"),
  claimExpiresAt: text("claim_expires_at"),
  revision: integer("revision").notNull(),
  body: jsonb("body").$type<OutboxRecord>().notNull(),
});

export const idempotency = pgTable(
  "idempotency",
  {
    idempotencyRecordId: text("idempotency_record_id").primaryKey(),
    namespace: text("namespace").notNull(),
    tenantId: text("tenant_id").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    requestHash: text("request_hash").notNull(),
    body: jsonb("body").$type<IdempotencyRecord>().notNull(),
  },
  (t) => [
    uniqueIndex("idempotency_ns_tenant_key_uidx").on(t.namespace, t.tenantId, t.dedupeKey),
  ],
);

export const schema = {
  runs,
  events,
  runState,
  toolCalls,
  approvals,
  checkpoints,
  continuations,
  stateSnapshots,
  outbox,
  idempotency,
};
