import { z } from "zod";

import { CONTRACTS_SCHEMA_VERSION, schemaVersionSchema, strictObject } from "./schema.js";

export const observationSourceKindSchema = z.enum(["tool", "hook", "user"]);

export const observationSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  observationId: z.string().min(1),
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().optional(),
  source: strictObject({
    kind: observationSourceKindSchema,
    sourceId: z.string().min(1),
    principalId: z.string().optional(),
    version: z.string().optional(),
  }),
  observedAt: z.string().min(1),
  data: z.unknown().optional(),
  dataRef: z.string().optional(),
  hash: z.string().min(1),
  declaredSchemaRef: z.string().optional(),
  sensitivity: z.string().optional(),
});

export type Observation = z.infer<typeof observationSchema>;

export const factEnvelopeSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  factId: z.string().min(1),
  factType: z.string().min(1),
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().optional(),
  observationIds: z.array(z.string().min(1)),
  subjectRefs: z.array(z.string()).default([]),
  acceptedAt: z.string().min(1),
  validators: z
    .array(
      strictObject({
        validatorId: z.string().min(1),
        version: z.string().min(1),
        inputHash: z.string().min(1),
        decision: z.enum(["pass", "fail"]),
        evidenceRef: z.string().optional(),
      }),
    )
    .default([]),
  authorizationDecisionRef: z.string().min(1),
  businessRuleRefs: z.array(z.string()).default([]),
  data: z.unknown().optional(),
  dataRef: z.string().optional(),
  hash: z.string().min(1),
});

export type FactEnvelope = z.infer<typeof factEnvelopeSchema>;

/** Deterministic Run State snapshot produced only by Reducer. */
export const runStateSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  facts: z
    .array(
      strictObject({
        factId: z.string().min(1),
        factType: z.string().min(1),
        summary: z.string(),
        data: z.unknown().optional(),
      }),
    )
    .default([]),
  lastFactId: z.string().optional(),
  cursor: strictObject({
    stepCount: z.number().int().nonnegative(),
  }).default({ stepCount: 0 }),
});

export type RunState = z.infer<typeof runStateSchema>;

export function createEmptyRunState(): RunState {
  return runStateSchema.parse({
    schemaVersion: CONTRACTS_SCHEMA_VERSION,
    facts: [],
    cursor: { stepCount: 0 },
  });
}
