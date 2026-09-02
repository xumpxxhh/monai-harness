import { z } from "zod";

import {
  contextDialogueSourceSchema,
  contextMemoryContributionSchema,
  contextProjectionPolicySchema,
} from "./dialogue.js";
import { schemaVersionSchema, strictObject } from "./schema.js";

export const CONTEXT_SECTION_KINDS = [
  "safety_boundary",
  "user_input",
  "state_summary",
  "tools",
  "skills",
  "knowledge",
  "recent_events",
  "memory",
  "history",
] as const;

export type ContextSectionKind = (typeof CONTEXT_SECTION_KINDS)[number];
export const contextSectionKindSchema = z.enum(CONTEXT_SECTION_KINDS);

export const contextSectionSchema = strictObject({
  kind: contextSectionKindSchema,
  contentRef: z.string().optional(),
  text: z.string().optional(),
  hash: z.string().min(1),
  tokenCount: z.number().int().nonnegative(),
  provenance: strictObject({
    sourceKind: z.string().min(1),
    sourceId: z.string().min(1),
    sourceVersion: z.string().optional(),
    retrievedAt: z.string().optional(),
  }).optional(),
  sensitivity: z.string().optional(),
});

export type ContextSection = z.infer<typeof contextSectionSchema>;

export const contextBudgetSchema = strictObject({
  maxTotalTokens: z.number().int().positive(),
  reservedOutputTokens: z.number().int().nonnegative().optional(),
  hardMaxTokens: z.number().int().positive().optional(),
});

export type ContextBudget = z.infer<typeof contextBudgetSchema>;

export const contextBuildTruncationSchema = strictObject({
  sectionKind: contextSectionKindSchema,
  originalTokens: z.number().int().nonnegative(),
  truncatedTokens: z.number().int().nonnegative(),
  reason: z.string().min(1),
});

export type ContextBuildTruncation = z.infer<typeof contextBuildTruncationSchema>;

export const contextBuildRecordSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  contextBuildId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  executionManifestRef: z.string().min(1),
  executionManifestHash: z.string().min(1),
  agentDefinition: strictObject({
    agentDefinitionId: z.string().min(1),
    version: z.string().min(1),
    digest: z.string().min(1),
  }),
  packVersions: z.array(
    strictObject({
      packId: z.string().min(1),
      version: z.string().min(1),
      digest: z.string().min(1),
    }),
  ),
  modelPolicy: strictObject({
    version: z.string().min(1),
    resolvedTarget: z.string().min(1),
    digest: z.string().min(1),
  }),
  strategy: strictObject({
    type: z.string().min(1),
    version: z.string().min(1),
    digest: z.string().optional(),
  }),
  contextBuilder: strictObject({
    version: z.string().min(1),
    digest: z.string().optional(),
  }),
  stateHash: z.string().min(1),
  latestUserObservationHash: z.string().optional(),
  selectedTools: z.array(
    strictObject({
      toolId: z.string().min(1),
      version: z.string().min(1),
      digest: z.string().optional(),
    }),
  ),
  selectedSkills: z
    .array(
      strictObject({
        skillId: z.string().min(1),
        version: z.string().min(1),
        digest: z.string().optional(),
      }),
    )
    .optional(),
  knowledgeFragments: z
    .array(
      strictObject({
        fragmentId: z.string().min(1),
        sourceId: z.string().min(1),
        sourceVersion: z.string().min(1),
        hash: z.string().min(1),
        contentRef: z.string().optional(),
      }),
    )
    .optional(),
  hookContributions: z
    .array(
      strictObject({
        hookId: z.string().min(1),
        version: z.string().optional(),
        hash: z.string().min(1),
        contentRef: z.string().optional(),
      }),
    )
    .optional(),
  contextHash: z.string().min(1),
  totalTokens: z.number().int().nonnegative(),
  truncations: z.array(contextBuildTruncationSchema),
  projectionPolicy: contextProjectionPolicySchema.optional(),
  dialogueSource: contextDialogueSourceSchema.optional(),
  compressionRef: z.string().optional(),
  messagesHash: z.string().optional(),
  memoryContributions: z.array(contextMemoryContributionSchema).optional(),
  memoryEnabled: z.boolean().optional(),
  createdAt: z.string().min(1),
});

export type ContextBuildRecord = z.infer<typeof contextBuildRecordSchema>;
