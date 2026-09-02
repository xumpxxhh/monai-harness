import { z } from "zod";

import { acceptanceCheckSchema } from "./acceptance.js";
import { modelPolicySchema } from "./model.js";
import { schemaVersionSchema, strictObject } from "./schema.js";
import { toolEffectContractSchema } from "./tool-call.js";

export const agentBudgetsSchema = strictObject({
  maxSteps: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  maxCost: z.number().positive().optional(),
  maxWallTime: z.number().int().positive().optional(),
});

export const agentModelPolicySchema = strictObject({
  primary: z.string().min(1),
  fallback: z.string().optional(),
  temperatureBounds: strictObject({
    min: z.number(),
    max: z.number(),
  }).optional(),
});

export const agentDefinitionSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  agentDefinitionId: z.string().min(1),
  name: z.string().min(1),
  version: z.string().min(1),
  skillRefs: z.array(strictObject({ skillId: z.string().min(1), version: z.string().min(1) })).optional(),
  toolAllowlist: z.array(z.string().min(1)),
  workflowRefs: z.array(strictObject({ workflowId: z.string().min(1), version: z.string().min(1) })).optional(),
  policyRefs: z.array(strictObject({ policyId: z.string().min(1), version: z.string().min(1) })).optional(),
  knowledgeRefs: z.array(strictObject({ sourceId: z.string().min(1), version: z.string().min(1) })).optional(),
  modelPolicy: agentModelPolicySchema.optional(),
  budgets: agentBudgetsSchema.optional(),
  defaults: strictObject({
    approvalMode: z.string().optional(),
    executionStrategy: strictObject({
      type: z.enum(["light", "dag"]),
      version: z.string().min(1),
    }).optional(),
  }).optional(),
  acceptanceChecks: z.array(acceptanceCheckSchema).optional(),
});

export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

export const packToolDefinitionSchema = strictObject({
  toolId: z.string().min(1),
  version: z.string().min(1),
  effectContract: toolEffectContractSchema,
  /** Model-facing description. Pack is the source of truth; Core must not hardcode tool docs. */
  description: z.string().min(1).optional(),
  /** JSON Schema object for function-calling arguments. */
  parameters: z.unknown().optional(),
  /** One-line arg hint for Context tools section. */
  argHint: z.string().optional(),
  /** Extra system-prompt rules when this tool is allowlisted. */
  systemPrompt: z.string().optional(),
  /** When false, registered but omitted from default allowlist (opt-in at wiring). Default true. */
  defaultEnabled: z.boolean().optional(),
  /** Policy require_approval when allowlisted. */
  requireApproval: z.boolean().optional(),
  inputSchemaVersion: z.string().optional(),
  outputSchemaVersion: z.string().optional(),
  digest: z.string().optional(),
});

export type PackToolDefinition = z.infer<typeof packToolDefinitionSchema>;

export const packHookDefinitionSchema = strictObject({
  hookPoint: z.enum(["PreReasoning", "PostReasoning", "PreToolCall", "PostToolCall", "OnRunEnd"]),
  handlerId: z.string().min(1),
  version: z.string().optional(),
  digest: z.string().optional(),
});

export type PackHookDefinition = z.infer<typeof packHookDefinitionSchema>;

export const packManifestSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  packId: z.string().min(1),
  version: z.string().min(1),
  coreContractRange: z.string().min(1),
  permissionsRequested: z.array(z.string().min(1)),
  tools: z.array(packToolDefinitionSchema),
  hooks: z.array(packHookDefinitionSchema).optional(),
  policies: z.array(strictObject({ policyId: z.string().min(1), version: z.string().min(1), digest: z.string().optional() })).optional(),
  validators: z.array(strictObject({ validatorId: z.string().min(1), version: z.string().min(1), digest: z.string().optional() })).optional(),
  evaluators: z.array(strictObject({ evaluatorId: z.string().min(1), version: z.string().min(1), digest: z.string().optional() })).optional(),
  knowledgeSources: z.array(strictObject({ sourceId: z.string().min(1), version: z.string().min(1) })).optional(),
  digest: z.string().optional(),
});

export type PackManifest = z.infer<typeof packManifestSchema>;

export const packRegistrationStatusSchema = z.enum(["active", "partial_rejected", "rejected", "disabled"]);

export const packContributionStatusSchema = z.enum(["registered", "rejected", "disabled"]);

export const packContributionKindSchema = z.enum(["tool", "hook", "policy", "validator", "evaluator", "knowledge"]);

export const packContributionRecordSchema = strictObject({
  kind: packContributionKindSchema,
  id: z.string().min(1),
  version: z.string().min(1),
  status: packContributionStatusSchema,
  reasonCodes: z.array(z.string()),
  effectivePermissions: z.array(z.string()),
});

export type PackContributionRecord = z.infer<typeof packContributionRecordSchema>;

export const packRegistrationResultSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  registrationId: z.string().min(1),
  tenantId: z.string().min(1),
  packRef: strictObject({
    packId: z.string().min(1),
    version: z.string().min(1),
  }),
  manifestDigest: z.string().min(1),
  status: packRegistrationStatusSchema,
  resolvedDependencies: z.array(strictObject({
    packId: z.string().min(1),
    version: z.string().min(1),
    digest: z.string().min(1),
  })),
  contributions: z.array(packContributionRecordSchema),
  createdAt: z.string().min(1),
  hash: z.string().min(1),
});

export type PackRegistrationResult = z.infer<typeof packRegistrationResultSchema>;

export const executionManifestSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  manifestId: z.string().min(1),
  createdAt: z.string().min(1),
  eventOrderingVersion: z.string().min(1),
  agentDefinition: strictObject({
    agentDefinitionId: z.string().min(1),
    version: z.string().min(1),
    digest: z.string().min(1),
  }),
  packVersions: z.array(strictObject({
    packId: z.string().min(1),
    version: z.string().min(1),
    digest: z.string().min(1),
  })),
  tools: z.array(packToolDefinitionSchema),
  hooks: z.array(packHookDefinitionSchema).optional(),
  policies: z.array(strictObject({ policyId: z.string().min(1), version: z.string().min(1), digest: z.string().optional() })).optional(),
  validators: z.array(strictObject({ validatorId: z.string().min(1), version: z.string().min(1), digest: z.string().optional() })).optional(),
  evaluators: z.array(strictObject({ evaluatorId: z.string().min(1), version: z.string().min(1), digest: z.string().optional() })).optional(),
  knowledgeSources: z.array(strictObject({ sourceId: z.string().min(1), version: z.string().min(1) })).optional(),
  strategy: strictObject({
    type: z.enum(["light", "dag"]),
    version: z.string().min(1),
    digest: z.string().optional(),
  }),
  toolAllowlist: z.array(z.string().min(1)),
  requireApprovalTools: z.array(z.string().min(1)),
  acceptanceChecks: z.array(acceptanceCheckSchema),
  budgets: z.record(z.unknown()).optional(),
  modelPolicy: modelPolicySchema.optional(),
  contextBuilder: strictObject({
    version: z.string().min(1),
    digest: z.string().optional(),
  }).optional(),
  reducer: strictObject({
    version: z.string().min(1),
    digest: z.string().optional(),
  }).optional(),
  coreContractVersion: z.string().min(1),
  hash: z.string().min(1),
});

export type ExecutionManifest = z.infer<typeof executionManifestSchema>;
