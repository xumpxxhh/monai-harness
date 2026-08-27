import { z } from "zod";

import { schemaVersionSchema, strictObject } from "./schema.js";

export const idempotencyNamespaceSchema = z.enum(["create_run", "tool_call", "child_run"]);

export const idempotencyStatusSchema = z.enum(["reserved", "completed", "expired"]);

export const idempotencyOwnerRefSchema = strictObject({
  ownerType: z.enum(["run", "tool_call", "child_run"]),
  runId: z.string().min(1),
  stepId: z.string().optional(),
  toolCallId: z.string().optional(),
  parentRunId: z.string().optional(),
  spawnActionId: z.string().optional(),
});

export const idempotencyResultRefSchema = strictObject({
  resultType: z.enum(["run", "tool_result", "child_run"]),
  runId: z.string().optional(),
  toolCallId: z.string().optional(),
  childRunId: z.string().optional(),
  payloadRef: z.string().optional(),
  hash: z.string().optional(),
});

export const idempotencyRecordSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  idempotencyRecordId: z.string().min(1),
  namespace: idempotencyNamespaceSchema,
  tenantId: z.string().min(1),
  key: z.string().min(1),
  dedupeKey: z.string().min(1),
  requestHash: z.string().min(1),
  ownerRef: idempotencyOwnerRefSchema,
  resultRef: idempotencyResultRefSchema.optional(),
  status: idempotencyStatusSchema,
  revision: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  completedAt: z.string().optional(),
});

export type IdempotencyRecord = z.infer<typeof idempotencyRecordSchema>;

export const outboxStatusSchema = z.enum([
  "pending",
  "claimed",
  "published",
  "failed",
  "expired",
]);

export const outboxAggregateRefSchema = strictObject({
  aggregateType: z.string().min(1),
  aggregateId: z.string().min(1),
  revision: z.number().int().nonnegative(),
});

export const outboxMessageSchema = strictObject({
  messageType: z.string().min(1),
  tenantId: z.string().min(1),
  aggregateRef: outboxAggregateRefSchema,
  dedupeKey: z.string().min(1),
  payload: z.unknown().optional(),
  payloadRef: z.string().optional(),
  payloadHash: z.string().min(1),
  availableAt: z.string().min(1),
});

export type OutboxMessage = z.infer<typeof outboxMessageSchema>;

export const outboxRecordSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  outboxRecordId: z.string().min(1),
  message: outboxMessageSchema,
  status: outboxStatusSchema,
  claimOwner: z.string().optional(),
  claimExpiresAt: z.string().optional(),
  publishAttempts: z.number().int().nonnegative(),
  publishedAt: z.string().optional(),
  lastError: z.string().optional(),
  revision: z.number().int().nonnegative(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  expiresAt: z.string().min(1),
});

export type OutboxRecord = z.infer<typeof outboxRecordSchema>;
