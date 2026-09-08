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

/** User-visible stream channels (never raw Action JSON content). */
export type ModelPreviewChannel = "reasoning" | "display";

export type ModelFunctionKind = "control" | "domain";

/** Vendor-neutral function definition. Adapters translate to provider wire format. */
export type ModelFunctionDef = {
  name: string;
  description: string;
  /** JSON Schema object for arguments. */
  parameters: unknown;
  kind: ModelFunctionKind;
};

export type ModelFunctionCall = {
  name: string;
  arguments: unknown;
};

/** Canonical model decision. Engine maps this to Action; adapters must not emit Action. */
export type ModelDecision = {
  content?: string;
  calls: ModelFunctionCall[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  target?: string;
  finishReason?: string;
  latencyMs?: number;
  reasoning?: string;
};

export type ModelCompleteInput = {
  context: unknown;
  /** @deprecated unused; Engine maps function calls, not Action JSON schema. */
  schema?: unknown;
  controlFunctions?: readonly ModelFunctionDef[];
  domainTools?: readonly ModelFunctionDef[];
  modelPolicy?: unknown;
  /** Runtime-owned decision prompt; adapters must not invent their own. */
  systemPrompt: string;
  /** Runtime-projected chat messages; adapters prefer this over flattening context. */
  messages?: readonly ModelMessage[];
};

export type { ModelMessage, ModelMessageToolCall };

export type ModelStreamDelta = {
  kind: "delta";
  channel: ModelPreviewChannel;
  text: string;
};

export type ModelStreamDone = {
  kind: "done";
  result: ModelDecision;
};

/** Wire request about to be sent to the model provider (no secrets). */
export type ModelStreamRequest = {
  kind: "request";
  url: string;
  body: unknown;
};

export type ModelStreamChunk = ModelStreamDelta | ModelStreamDone | ModelStreamRequest;

/**
 * ModelPort — completion outside any open UoW (EDR-003).
 * Returns a vendor-neutral ModelDecision (or, for eval stubs, an Action-shaped object).
 * Optional streaming may yield `request` then user-facing deltas; execution waits for `done`.
 */
export type ModelPort = {
  completeStructured(input: ModelCompleteInput): Promise<unknown>;
  completeStructuredStream?(input: ModelCompleteInput): AsyncIterable<ModelStreamChunk>;
};

export type KnowledgePort = {
  retrieve(query: unknown): Promise<unknown[]>;
};

/** MVP: Memory retrieval disabled by default (design 05 §7). */
export type MemoryRetrieveInput = {
  tenantId: string;
  sessionId: string;
  runId: string;
  subjectRef?: string;
  query?: string;
  limit?: number;
};

export type MemoryItem = {
  memoryId: string;
  version: string;
  hash: string;
  content?: string;
  contentRef?: string;
};

export type MemoryPort = {
  retrieve(input: MemoryRetrieveInput): Promise<MemoryItem[]>;
};

export type WorkspacePort = {
  list(path: string): Promise<unknown[]>;
  read(path: string): Promise<unknown>;
  write(path: string, content: unknown): Promise<void>;
  /**
   * Delete a file or directory under the authorized workspace root.
   * Must reject `/`. Directories are removed recursively.
   */
  delete(path: string): Promise<{ kind: "file" | "directory" }>;
  search(query: string): Promise<unknown[]>;
};

/**
 * Opt-in bash/shell exec inside the authorized workspace root (workspace.exec).
 * Distinct from SandboxPort (argv-only, separate sandboxRoot).
 */
export type WorkspaceShellExecRequest = {
  /** Shell command string passed to `bash -lc` (or configured shell). */
  command: string;
  /** Optional relative cwd under the workspace root (default "."). */
  cwd?: string;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
};

export type WorkspaceShellExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
  /** Absolute cwd used for the process. */
  cwd: string;
};

export type WorkspaceShellPort = {
  exec(request: WorkspaceShellExecRequest): Promise<WorkspaceShellExecResult>;
};

export type ObjectStorePort = {
  put(key: string, body: Uint8Array, hash: string): Promise<string>;
  get(key: string): Promise<Uint8Array | undefined>;
  signedRef(key: string): Promise<string>;
};

/**
 * Bounded sandbox exec request (opt-in; default MVP uses RejectingSandbox).
 * argv only — never a shell string.
 */
export type SandboxExecRequest = {
  argv: string[];
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
};

/** Bounded sandbox exec result. Truncation/timeout must not be reported as full success by Tools. */
export type SandboxExecResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
};

/**
 * SandboxPort — MVP **default** is non-executable stub (EDR-014).
 * Executable adapters (e.g. subprocess) only when feature flag + assembly opt-in.
 */
export type SandboxPort = {
  exec(request: SandboxExecRequest): Promise<SandboxExecResult>;
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

import type { EventEnvelope, ModelMessage, ModelMessageToolCall } from "@monai/contracts";

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
