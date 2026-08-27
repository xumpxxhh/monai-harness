import { z } from "zod";

import { strictObject } from "./schema.js";

export const ACCEPTANCE_SELECTOR_TYPES = [
  "json_pointer",
  "artifact_ref",
  "fact_ref",
  "state_ref",
] as const;

export const acceptanceSelectorTypeSchema = z.enum(ACCEPTANCE_SELECTOR_TYPES);

export const acceptanceCheckSchema = strictObject({
  checkId: z.string().min(1),
  validatorRef: strictObject({
    validatorId: z.string().min(1),
    version: z.string().min(1),
  }),
  inputSelector: strictObject({
    selectorVersion: z.string().min(1),
    selectorType: acceptanceSelectorTypeSchema,
    selector: z.string().optional(),
    ref: z.string().optional(),
    schemaRef: z.string().min(1),
    required: z.boolean(),
  }),
  required: z.boolean(),
});

export type AcceptanceCheck = z.infer<typeof acceptanceCheckSchema>;
export type AcceptanceSelectorType = z.infer<typeof acceptanceSelectorTypeSchema>;
