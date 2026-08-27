import { z } from "zod";

import { actionSchema } from "./action.js";
import { schemaVersionSchema, strictObject } from "./schema.js";

export const APPROVAL_REQUEST_KINDS = [
  "policy_required",
  "mode_confirm_once",
  "mode_always",
] as const;

export type ApprovalRequestKind = (typeof APPROVAL_REQUEST_KINDS)[number];

export const approvalRequestKindSchema = z.enum(APPROVAL_REQUEST_KINDS);

export const APPROVAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "expired",
  "revoked",
  "consumed",
] as const;

export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

export const approvalStatusSchema = z.enum(APPROVAL_STATUSES);

export const approvalApproverSchema = strictObject({
  principalId: z.string().min(1),
  tenantId: z.string().min(1),
  authContextRef: z.string().optional(),
  decidedAt: z.string().min(1),
});

export const approvalRecordSchema = strictObject({
  schemaVersion: schemaVersionSchema,
  approvalId: z.string().min(1),
  tenantId: z.string().min(1),
  sessionId: z.string().min(1),
  runId: z.string().min(1),
  stepId: z.string().min(1),
  actionId: z.string().min(1),
  requestKind: approvalRequestKindSchema,
  actionDigest: z.string().min(1),
  canonicalizationVersion: z.string().min(1),
  actionSchemaVersion: z.string().min(1),
  digestAlgorithm: z.string().min(1),
  resourceScope: z.unknown().optional(),
  toolRef: strictObject({
    toolId: z.string().min(1),
    version: z.string().min(1),
  }).optional(),
  riskLevel: z.enum(["low", "medium", "high"]),
  evaluatedPolicyVersions: z.array(
    strictObject({
      policyId: z.string().min(1),
      version: z.string().min(1),
      digest: z.string().min(1),
    }),
  ),
  executionManifestRef: z.string().min(1),
  requestedAt: z.string().min(1),
  expiresAt: z.string().min(1),
  status: approvalStatusSchema,
  approver: approvalApproverSchema.optional(),
  decisionReason: z.string().optional(),
  consumedAt: z.string().optional(),
  consumedByToolCallId: z.string().optional(),
  revision: z.number().int().nonnegative(),
  /** MVP resume aid; Event Log remains source of truth for Action. */
  actionSnapshot: actionSchema.optional(),
});

export type ApprovalRecord = z.infer<typeof approvalRecordSchema>;
