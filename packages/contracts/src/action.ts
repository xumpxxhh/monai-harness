import { z } from "zod";

import { schemaVersionSchema, strictObject } from "./schema.js";

export const ACTION_TYPES = ["tool.call", "ask_user", "finish", "spawn_child", "noop"] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const actionTypeSchema = z.enum(ACTION_TYPES);

export const actionSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  actionId: z.string().min(1),
  type: actionTypeSchema,
  toolId: z.string().min(1).optional(),
  arguments: z.unknown().optional(),
  resourceScope: z.unknown().optional(),
  idempotencyKey: z.string().min(1).optional(),
  childSpec: z
    .object({
      goal: z.string(),
      inputRef: z.string().optional(),
      delegationScope: z.unknown(),
      strategy: z.unknown().optional(),
    })
    .strict()
    .optional(),
  rationaleRef: z.string().optional(),
  /** Agent-authored text shown to the user (not a user-sent message). Not part of auth digest. */
  displayText: z.string().optional(),
});

export type Action = z.infer<typeof actionSchema>;

export const POLICY_DECISIONS = ["allow", "deny", "require_approval"] as const;

export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export const policyDecisionSchema = z.enum(POLICY_DECISIONS);
