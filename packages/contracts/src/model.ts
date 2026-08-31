import { z } from "zod";

import { strictObject } from "./schema.js";

export const modelUsageSchema = strictObject({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export type ModelUsage = z.infer<typeof modelUsageSchema>;

export const modelCostSchema = strictObject({
  amount: z.number().nonnegative(),
  currency: z.string().min(1),
  isUnknown: z.boolean().optional(),
});

export type ModelCost = z.infer<typeof modelCostSchema>;

export const modelPolicySchema = strictObject({
  version: z.string().min(1),
  resolvedTarget: z.string().min(1),
  fallbackTarget: z.string().optional(),
  maxRetries: z.number().int().nonnegative().optional(),
  temperature: z.number().optional(),
  maxTokens: z.number().int().positive().optional(),
  digest: z.string().optional(),
});

export type ModelPolicy = z.infer<typeof modelPolicySchema>;

export const PRICE_TABLE_STATIC_VERSION = "2026-08-static";

export interface PriceTableEntry {
  inputPerMillion: number;
  outputPerMillion: number;
  currency: string;
}

export const STATIC_PRICE_TABLE: Record<string, PriceTableEntry> = {
  "gpt-4o": { inputPerMillion: 5.0, outputPerMillion: 15.0, currency: "USD" },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6, currency: "USD" },
  "claude-3-5-sonnet": { inputPerMillion: 3.0, outputPerMillion: 15.0, currency: "USD" },
  "stub": { inputPerMillion: 0.0, outputPerMillion: 0.0, currency: "USD" },
};

export const modelCalledPayloadSchema = strictObject({
  modelCallId: z.string().min(1),
  stepId: z.string().min(1),
  attempt: z.number().int().positive(),
  target: z.string().min(1),
  modelPolicyVersion: z.string().min(1),
  priceTableVersion: z.string().optional(),
  contextHash: z.string().min(1),
});

export type ModelCalledPayload = z.infer<typeof modelCalledPayloadSchema>;

export const modelRespondedPayloadSchema = strictObject({
  modelCallId: z.string().min(1),
  stepId: z.string().min(1),
  attempt: z.number().int().positive(),
  target: z.string().min(1),
  usage: modelUsageSchema,
  priceTableVersion: z.string().optional(),
  cost: modelCostSchema.optional(),
  finishReason: z.string().optional(),
  latencyMs: z.number().nonnegative().optional(),
  /** Full model reasoning / thinking text for UX replay (not an execution input). */
  reasoning: z.string().optional(),
  /** User-facing projection of the accepted action (not raw JSON). */
  display: z.string().optional(),
});

export type ModelRespondedPayload = z.infer<typeof modelRespondedPayloadSchema>;
