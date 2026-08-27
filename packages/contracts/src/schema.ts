import { z } from "zod";

/** Current contracts schema version for first-party types. */
export const CONTRACTS_SCHEMA_VERSION = "0.1.0" as const;

export type SchemaVersion = string;

/**
 * Strict object helper: unknown keys are rejected (design 01 section 10).
 * Prefer this over bare `z.object` for external / persisted envelopes.
 */
export function strictObject<T extends z.ZodRawShape>(shape: T) {
  return z.object(shape).strict();
}

export const schemaVersionSchema = z.string().min(1);
