import { z } from "zod";

import { actionSchema } from "./action.js";
import { schemaVersionSchema, strictObject } from "./schema.js";

export const CONTINUATION_KINDS = ["approval", "input", "child_join", "paused"] as const;

export type ContinuationKind = (typeof CONTINUATION_KINDS)[number];

export const continuationKindSchema = z.enum(CONTINUATION_KINDS);

export const continuationSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  continuationId: z.string().min(1),
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  kind: continuationKindSchema,
  stepId: z.string().min(1),
  actionId: z.string().optional(),
  resumePhase: z.string().min(1),
  inputSchemaRef: z.string().optional(),
  approvalId: z.string().optional(),
  childRunIds: z.array(z.string().min(1)).optional(),
  deadline: z.string().optional(),
  strategyCursorRef: z.string().min(1),
  strategyCursorHash: z.string().min(1),
  createdAt: z.string().min(1),
  hash: z.string().min(1),
  /** MVP: Action snapshot for resume without full Event replay. */
  actionSnapshot: actionSchema.optional(),
  /** MVP: ask_user prompt / schema hint. */
  inputPrompt: z.string().optional(),
});

export type Continuation = z.infer<typeof continuationSchema>;

export const checkpointSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  checkpointId: z.string().min(1),
  runId: z.string().min(1),
  executionManifestRef: z.string().min(1),
  /** Stamped by Persistence to post-commit revision (design 03 §11.1). */
  revision: z.number().int().nonnegative(),
  /** Stamped by Persistence to last sequence in the same commit. */
  sequence: z.number().int().nonnegative(),
  stateRef: z.string().min(1),
  stateHash: z.string().min(1),
  strategy: strictObject({
    type: z.string().min(1),
    version: z.string().min(1),
    cursorRef: z.string().min(1),
    cursorHash: z.string().min(1),
  }),
  activeStepRef: z.string().optional(),
  continuationRef: z.string().optional(),
  createdAt: z.string().min(1),
  hash: z.string().min(1),
});

export type Checkpoint = z.infer<typeof checkpointSchema>;
