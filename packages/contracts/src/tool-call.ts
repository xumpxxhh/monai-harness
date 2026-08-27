import { z } from "zod";

import { schemaVersionSchema, strictObject } from "./schema.js";

export const TOOL_CALL_STATUSES = [
  "prepared",
  "dispatched",
  "succeeded",
  "failed",
  "outcome_unknown",
] as const;

export type ToolCallStatus = (typeof TOOL_CALL_STATUSES)[number];

export const toolCallStatusSchema = z.enum(TOOL_CALL_STATUSES);

export const sideEffectProfileSchema = z.enum(["none", "read", "write_low", "write_high"]);

export const deliverySemanticsSchema = z.enum(["at_most_once", "at_least_once"]);

export const toolEffectContractSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  sideEffectProfile: sideEffectProfileSchema,
  deliverySemantics: deliverySemanticsSchema,
  idempotencyScope: z.enum(["run", "tenant", "resource", "global"]),
  /** When true, outcome_unknown must be closed via reconcile — never new-key blind retry. */
  reconcileSupported: z.boolean(),
  timeoutMs: z.number().int().positive().optional(),
});

export type ToolEffectContract = z.infer<typeof toolEffectContractSchema>;

export const toolCallRecordSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  toolCallId: z.string().min(1),
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  actionId: z.string().min(1),
  toolId: z.string().min(1),
  toolVersion: z.string().min(1),
  executionManifestRef: z.string().min(1),
  inputHash: z.string().min(1),
  arguments: z.unknown().optional(),
  resourceScope: z.unknown().optional(),
  idempotencyKey: z.string().min(1).optional(),
  idempotencyScope: z.enum(["run", "tenant", "resource", "global"]).optional(),
  deliverySemantics: deliverySemanticsSchema,
  sideEffectProfile: sideEffectProfileSchema,
  status: toolCallStatusSchema,
  attempt: z.number().int().positive(),
  preparedAt: z.string().min(1),
  dispatchedAt: z.string().optional(),
  completedAt: z.string().optional(),
  resultObservationId: z.string().optional(),
  resultRef: z.string().optional(),
  resultHash: z.string().optional(),
  error: z.string().optional(),
  dispatchLeaseEpoch: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
  reconcileSupported: z.boolean(),
});

export type ToolCallRecord = z.infer<typeof toolCallRecordSchema>;
