import { z } from "zod";

import { strictObject } from "./schema.js";

export const ERROR_CATEGORIES = [
  "validation",
  "authorization",
  "approval_required",
  "hook_vetoed",
  "conflict",
  "lease_lost",
  "outcome_unknown",
  "transient",
  "budget_exceeded",
  "fatal",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export const errorCategorySchema = z.enum(ERROR_CATEGORIES);

export const harnessErrorSchema = strictObject({
  code: z.string().min(1),
  category: errorCategorySchema,
  retryable: z.boolean(),
  message: z.string(),
  details: z.unknown().optional(),
  causationId: z.string().optional(),
});

export type HarnessError = z.infer<typeof harnessErrorSchema>;
