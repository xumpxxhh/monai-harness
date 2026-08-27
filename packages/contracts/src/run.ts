import { z } from "zod";

import { CONTRACTS_SCHEMA_VERSION, schemaVersionSchema, strictObject } from "./schema.js";

export const RUN_STATUSES = [
  "created",
  "queued",
  "running",
  "awaiting_approval",
  "awaiting_input",
  "waiting_child",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type RunStatus = (typeof RUN_STATUSES)[number];

export const runStatusSchema = z.enum(RUN_STATUSES);

export const packVersionRefSchema = strictObject({
  packId: z.string().min(1),
  version: z.string().min(1),
});

export const runStrategySchema = strictObject({
  type: z.enum(["light", "dag"]),
  version: z.string().min(1),
});

export const runSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  runId: z.string().min(1),
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  agentDefinitionId: z.string().min(1),
  agentVersion: z.string().min(1),
  executionManifestRef: z.string().min(1),
  packVersions: z.array(packVersionRefSchema),
  goal: z.string(),
  inputRef: z.string().optional(),
  status: runStatusSchema,
  strategy: runStrategySchema,
  budgets: z.record(z.unknown()).default({}),
  revision: z.number().int().nonnegative(),
  leaseEpoch: z.number().int().nonnegative(),
  rootRunId: z.string().min(1),
  parentRunId: z.string().optional(),
  parentStepId: z.string().optional(),
  spawnActionId: z.string().optional(),
  depth: z.number().int().nonnegative(),
  delegationScope: z.unknown().optional(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type Run = z.infer<typeof runSchema>;

export function createInitialRun(
  input: Omit<
    Run,
    "schemaVersion" | "status" | "revision" | "leaseEpoch" | "rootRunId" | "createdAt" | "updatedAt" | "depth"
  > & {
    rootRunId?: string;
    depth?: number;
    createdAt?: string;
    updatedAt?: string;
  },
): Run {
  const now = input.createdAt ?? new Date().toISOString();
  return runSchema.parse({
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    ...input,
    rootRunId: input.rootRunId ?? input.runId,
    status: "created",
    revision: 0,
    leaseEpoch: 0,
    depth: input.depth ?? 0,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
  });
}
