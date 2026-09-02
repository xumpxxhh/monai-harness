import { z } from "zod";

import { schemaVersionSchema, strictObject } from "./schema.js";

export const ACTION_TYPES = ["tool.call", "ask_user", "finish", "spawn_child", "noop"] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const actionTypeSchema = z.enum(ACTION_TYPES);

export const toolCallInvocationSchema = strictObject({
  toolId: z.string().min(1),
  arguments: z.unknown().optional(),
  resourceScope: z.unknown().optional(),
  idempotencyKey: z.string().min(1).optional(),
});

export type ToolCallInvocation = z.infer<typeof toolCallInvocationSchema>;

export const actionDependencySchema = strictObject({
  fromIndex: z.number().int().nonnegative(),
  toIndex: z.number().int().nonnegative(),
});

export type ActionDependency = z.infer<typeof actionDependencySchema>;

export const actionSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  actionId: z.string().min(1),
  type: actionTypeSchema,
  /** @deprecated N=1 legacy; authoritative batch is `calls`. */
  toolId: z.string().min(1).optional(),
  /** @deprecated N=1 legacy; authoritative batch is `calls`. */
  arguments: z.unknown().optional(),
  resourceScope: z.unknown().optional(),
  /** @deprecated per-invocation keys live on `calls[]`. */
  idempotencyKey: z.string().min(1).optional(),
  /** Domain tool batch (required when type=tool.call after normalization). */
  calls: z.array(toolCallInvocationSchema).optional(),
  /** When true, any deny collapses the whole batch (not enforced in MVP slice). */
  atomic: z.boolean().optional(),
  /** Invocation dependency edges (not enforced in MVP slice). */
  dependencies: z.array(actionDependencySchema).optional(),
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
}).superRefine((action, ctx) => {
  if (action.type !== "tool.call") return;
  const hasCalls = Array.isArray(action.calls) && action.calls.length > 0;
  const hasLegacy =
    typeof action.toolId === "string" &&
    action.toolId.length > 0;
  if (!hasCalls && !hasLegacy) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "tool.call requires calls[] or legacy toolId",
    });
  }
});

export type Action = z.infer<typeof actionSchema>;

export const POLICY_DECISIONS = ["allow", "deny", "require_approval"] as const;

export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

export const policyDecisionSchema = z.enum(POLICY_DECISIONS);
