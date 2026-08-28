/** Queue message leased from QueuePort (EDR-004). */
export type QueueMessage = {
  messageId: string;
  runId: string;
  revision: number;
  messageType: string;
  dedupeKey: string;
  payload?: unknown;
};

export type QueueEnqueueInput = {
  runId: string;
  revision: number;
  messageType: string;
  dedupeKey: string;
  payload?: unknown;
};

/** QueuePort — at-least-once enqueue/lease/ack (EDR-004). */
export type QueuePort = {
  enqueue(message: QueueEnqueueInput): Promise<void>;
  lease(limit: number, ownerId: string): Promise<QueueMessage[]>;
  ack(messageId: string): Promise<void>;
  nack(messageId: string): Promise<void>;
};

/** Lease metadata after Engine committed leaseEpoch++. */
export type LeaseRecord = {
  runId: string;
  ownerId: string;
  leaseEpoch: number;
  acquiredAt: string;
  expiresAt: string;
  lastHeartbeatAt: string;
};

/**
 * LeasePort — run execution fencing metadata.
 * leaseEpoch is owned by Engine CommitPlan; bind records owner after successful commit.
 */
export type LeasePort = {
  bind(runId: string, ownerId: string, leaseEpoch: number, ttlMs: number): Promise<void>;
  heartbeat(runId: string, ownerId: string, leaseEpoch: number): Promise<void>;
  validate(runId: string, ownerId: string, leaseEpoch: number): Promise<boolean>;
  release(runId: string, ownerId: string, leaseEpoch: number): Promise<void>;
  get(runId: string): Promise<LeaseRecord | undefined>;
};

export type ExecutionManifestStorePort = {
  put(manifestId: string, content: unknown, hash: string): Promise<void>;
  get(manifestId: string): Promise<{ content: unknown; hash: string } | undefined>;
};

/**
 * ModelPort — structured completion outside any open UoW (EDR-003).
 * Implementations return an Action-shaped object (validated by Engine).
 */
export type ModelPort = {
  completeStructured(input: {
    context: unknown;
    schema: unknown;
    modelPolicy?: unknown;
  }): Promise<unknown>;
};

export type KnowledgePort = {
  retrieve(query: unknown): Promise<unknown[]>;
};

export type WorkspacePort = {
  list(path: string): Promise<unknown[]>;
  read(path: string): Promise<unknown>;
  write(path: string, content: unknown): Promise<void>;
  search(query: string): Promise<unknown[]>;
};

export type ObjectStorePort = {
  put(key: string, body: Uint8Array, hash: string): Promise<string>;
  get(key: string): Promise<Uint8Array | undefined>;
  signedRef(key: string): Promise<string>;
};

/**
 * SandboxPort — interface retained; MVP must NOT mount an executable implementation (EDR-014).
 */
export type SandboxPort = {
  /** @deprecated MVP: do not call. */
  exec(_request: unknown): Promise<never>;
};

export type SecretLease = {
  secretRef: string;
  value: string;
  expiresAt: string;
};

export type SecretPort = {
  resolve(secretRef: string): Promise<string>;
  lease(secretRef: string, ttlMs?: number): Promise<SecretLease>;
};

import type { EventEnvelope } from "@monai/contracts";

export type EventStreamPort = {
  readFrom(runId: string, fromSequence: number): AsyncIterable<EventEnvelope>;
};

export type EvaluationPort = {
  submitSample(sample: unknown): Promise<void>;
};

export type ApprovalPort = {
  get(approvalId: string): Promise<unknown | undefined>;
};

export type ToolCallPort = {
  get(toolCallId: string): Promise<unknown | undefined>;
};
