import { z } from "zod";

import { schemaVersionSchema, strictObject } from "./schema.js";
import { eventProducerSchema } from "./event.js";

/** Governance stream event types (design 01 §5.2 — control plane, no Run state). */
export const GOVERNANCE_EVENT_TYPES = [
  "pack.registered",
  "pack.registration_rejected",
] as const;

export type GovernanceEventType = (typeof GOVERNANCE_EVENT_TYPES)[number];

export const governanceEventTypeSchema = z.enum(GOVERNANCE_EVENT_TYPES);

const governanceEventCommonFields = {
  schemaVersion: schemaVersionSchema,
  eventId: z.string().min(1),
  eventType: governanceEventTypeSchema,
  tenantId: z.string().min(1),
  governanceStreamId: z.string().min(1),
  occurredAt: z.string().min(1),
  correlationId: z.string().min(1),
  producer: eventProducerSchema,
  payload: z.unknown().optional(),
  hash: z.string().min(1),
} as const;

export const governanceEventCandidateSchema = strictObject({
  ...governanceEventCommonFields,
});

export type GovernanceEventCandidate = z.infer<typeof governanceEventCandidateSchema>;

export const governanceEventEnvelopeSchema = strictObject({
  ...governanceEventCommonFields,
  sequence: z.number().int().positive(),
  recordedAt: z.string().min(1),
});

export type GovernanceEventEnvelope = z.infer<typeof governanceEventEnvelopeSchema>;
