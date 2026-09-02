import { z } from "zod";

import { strictObject } from "./schema.js";

export const DIALOGUE_TURN_ROLES = ["user", "assistant", "tool"] as const;
export type DialogueTurnRole = (typeof DIALOGUE_TURN_ROLES)[number];
export const dialogueTurnRoleSchema = z.enum(DIALOGUE_TURN_ROLES);

export const modelMessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type ModelMessageRole = z.infer<typeof modelMessageRoleSchema>;

export const modelMessageToolCallSchema = strictObject({
  id: z.string().min(1),
  type: z.literal("function"),
  function: strictObject({
    name: z.string().min(1),
    arguments: z.string(),
  }),
});

export type ModelMessageToolCall = z.infer<typeof modelMessageToolCallSchema>;

export const modelMessageSchema = strictObject({
  role: modelMessageRoleSchema,
  content: z.string().optional(),
  name: z.string().optional(),
  toolCallId: z.string().optional(),
  toolCalls: z.array(modelMessageToolCallSchema).optional(),
});

export type ModelMessage = z.infer<typeof modelMessageSchema>;

export const dialogueTurnSequenceRangeSchema = strictObject({
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
});

export const dialogueTurnToolCallSchema = strictObject({
  id: z.string().min(1),
  name: z.string().min(1),
  arguments: z.unknown().optional(),
});

export const dialogueTurnSchema = strictObject({
  turnId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().optional(),
  role: dialogueTurnRoleSchema,
  content: z.string().optional(),
  toolCalls: z.array(dialogueTurnToolCallSchema).optional(),
  toolCallId: z.string().optional(),
  toolName: z.string().optional(),
  sourceEventIds: z.array(z.string().min(1)),
  sequenceRange: dialogueTurnSequenceRangeSchema,
});

export type DialogueTurn = z.infer<typeof dialogueTurnSchema>;

export const dialogueEventRangeSchema = strictObject({
  runId: z.string().min(1),
  fromSequence: z.number().int().positive(),
  toSequence: z.number().int().positive(),
});

export const contextCompressionRecordSchema = strictObject({
  compressionId: z.string().min(1),
  summaryHash: z.string().min(1),
  summaryText: z.string().min(1),
  sourceRunIds: z.array(z.string().min(1)),
  sourceEventRanges: z.array(dialogueEventRangeSchema),
  summarizerModelCallId: z.string().optional(),
  createdAt: z.string().min(1),
});

export type ContextCompressionRecord = z.infer<typeof contextCompressionRecordSchema>;

export const contextProjectionPolicySchema = strictObject({
  recentTurnCount: z.number().int().positive(),
  recentTokenBudget: z.number().int().positive(),
  compressThreshold: z.number().int().positive(),
});

export type ContextProjectionPolicy = z.infer<typeof contextProjectionPolicySchema>;

export const DEFAULT_CONTEXT_PROJECTION_POLICY: ContextProjectionPolicy = {
  recentTurnCount: 6,
  recentTokenBudget: 4096,
  compressThreshold: 8192,
};

export const contextDialogueSourceSchema = strictObject({
  runId: z.string().min(1),
  fromSequence: z.number().int().positive(),
  toSequence: z.number().int().positive(),
  sessionId: z.string().optional(),
  priorRunIds: z.array(z.string().min(1)).optional(),
});

export type ContextDialogueSource = z.infer<typeof contextDialogueSourceSchema>;

export const contextMemoryContributionSchema = strictObject({
  memoryId: z.string().min(1),
  version: z.string().min(1),
  hash: z.string().min(1),
  contentRef: z.string().optional(),
});

export type ContextMemoryContribution = z.infer<typeof contextMemoryContributionSchema>;
