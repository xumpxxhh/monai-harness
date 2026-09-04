import { config as loadEnvFile } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveContextProjectionPolicy,
  type ContextProjectionPolicy,
} from "@monai/contracts";

export type PersistenceDriver = "memory" | "postgres";

export const HARNESS_ROLE_IDS = [
  "api",
  "dispatcher",
  "scheduler",
  "worker",
  "observability",
  "governance",
] as const;

export type HarnessRole = (typeof HARNESS_ROLE_IDS)[number];

export type HarnessRoles = Record<HarnessRole, boolean>;

export type FeatureFlags = {
  enableDag: boolean;
  enableSpawnChild: boolean;
  enableMemory: boolean;
  enableSandboxExec: boolean;
  enableRealWriteHigh: boolean;
};

export type HarnessConfig = {
  persistenceDriver: PersistenceDriver;
  modelDriver: "stub" | "openai";
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  openaiResponseFormat: "json_object" | "none";
  openaiAuthHeader?: string;
  /** Completion max_tokens; unset → adapter default (1024). */
  openaiMaxTokens?: number;
  databaseUrl: string;
  port: number;
  /** demo = CreateRun→execute_turn then exit; serve = keep delivery loops */
  mode: "demo" | "serve";
  runEvalOnStart: boolean;
  loopIntervalMs: number;
  featureFlags: FeatureFlags;
  corsOrigins: string[];
  /** serve: auto execute_turn after lease (app TurnDriver). */
  autoExecuteTurn: boolean;
  /** In-process role switches (P9d). Default: all on. */
  roles: HarnessRoles;
  /** Agent workspace root on disk (`/` maps here). */
  workspaceDir: string;
  /** RAG HTTP base URL; empty = knowledge.search disabled (EDR-016). */
  knowledgeBaseUrl?: string;
  knowledgeCollectionIds: readonly string[];
  knowledgeTopK?: number;
  knowledgeTimeoutMs: number;
  /** Context projection / compression / section budget (env overrideable). */
  contextProjectionPolicy: ContextProjectionPolicy;
};

/** `apps/harness` package root (works from `src/config/` and compiled `dist/config/`). */
export function harnessRootDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

/** Default on-disk workspace: `apps/harness/workspace`. */
export function defaultWorkspaceDir(): string {
  return resolve(harnessRootDir(), "workspace");
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

/** Positive int from env; blank/invalid → fallback. */
export function parsePositiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return fallback;
  return n;
}

/** Positive int from env; blank/invalid → undefined. */
export function parseOptionalPositiveInt(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return undefined;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return undefined;
  return n;
}

/**
 * Context projection policy from env (`CONTEXT_*`).
 * Unset keys keep `DEFAULT_CONTEXT_PROJECTION_POLICY`.
 */
export function parseContextProjectionPolicy(
  env: NodeJS.Dict<string>,
): ContextProjectionPolicy {
  const d = resolveContextProjectionPolicy();
  return resolveContextProjectionPolicy({
    recentTurnCount: parsePositiveInt(env.CONTEXT_RECENT_TURN_COUNT, d.recentTurnCount),
    recentTokenBudget: parsePositiveInt(env.CONTEXT_RECENT_TOKEN_BUDGET, d.recentTokenBudget),
    compressThreshold: parsePositiveInt(env.CONTEXT_COMPRESS_THRESHOLD, d.compressThreshold),
    maxTotalTokens: parsePositiveInt(env.CONTEXT_MAX_TOTAL_TOKENS, d.maxTotalTokens ?? 8192),
    maxToolContentChars: parsePositiveInt(
      env.CONTEXT_MAX_TOOL_CONTENT_CHARS,
      d.maxToolContentChars ?? 8_000,
    ),
  });
}

export function allHarnessRolesEnabled(): HarnessRoles {
  return {
    api: true,
    dispatcher: true,
    scheduler: true,
    worker: true,
    observability: true,
    governance: true,
  };
}

/**
 * Parse in-process role switches.
 * `HARNESS_ROLES=api,worker` is an allowlist; otherwise `HARNESS_ROLE_*` (default true).
 */
export function parseHarnessRoles(env: NodeJS.Dict<string>): HarnessRoles {
  const listRaw = env.HARNESS_ROLES?.trim();
  if (listRaw) {
    const wanted = new Set(
      listRaw
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    const known = new Set<string>(HARNESS_ROLE_IDS);
    const unknown = [...wanted].filter((role) => !known.has(role));
    if (unknown.length > 0) {
      console.warn(`[harness] unknown roles in HARNESS_ROLES: ${unknown.join(", ")}`);
    }
    return {
      api: wanted.has("api"),
      dispatcher: wanted.has("dispatcher"),
      scheduler: wanted.has("scheduler"),
      worker: wanted.has("worker"),
      observability: wanted.has("observability"),
      governance: wanted.has("governance"),
    };
  }

  return {
    api: parseBool(env.HARNESS_ROLE_API, true),
    dispatcher: parseBool(env.HARNESS_ROLE_DISPATCHER, true),
    scheduler: parseBool(env.HARNESS_ROLE_SCHEDULER, true),
    worker: parseBool(env.HARNESS_ROLE_WORKER, true),
    observability: parseBool(env.HARNESS_ROLE_OBSERVABILITY, true),
    governance: parseBool(env.HARNESS_ROLE_GOVERNANCE, true),
  };
}

export function formatHarnessRoles(roles: HarnessRoles): string {
  return HARNESS_ROLE_IDS.map((id) => `${id}=${roles[id]}`).join(" ");
}

export function hasDeliveryRole(roles: HarnessRoles): boolean {
  return roles.dispatcher || roles.scheduler || roles.worker;
}

/** Load `apps/harness/.env` via dotenv; overrides process.env for configured keys. */
export function loadDotEnv(): void {
  const envPath = resolve(harnessRootDir(), ".env");
  loadEnvFile({ path: envPath, override: true });
}

export function loadConfig(): HarnessConfig {
  loadDotEnv();

  const driverRaw = (process.env.PERSISTENCE_DRIVER ?? "memory").trim().toLowerCase();
  const persistenceDriver: PersistenceDriver =
    driverRaw === "postgres" ? "postgres" : "memory";

  const modelDriverRaw = (process.env.MODEL_DRIVER ?? "stub").trim().toLowerCase();
  const modelDriver: "stub" | "openai" = modelDriverRaw === "openai" ? "openai" : "stub";

  const modeRaw = (process.env.HARNESS_MODE ?? "demo").trim().toLowerCase();
  const mode: "demo" | "serve" = modeRaw === "serve" ? "serve" : "demo";

  const featureFlags: FeatureFlags = {
    enableDag: parseBool(process.env.FEATURE_ENABLE_DAG, false),
    enableSpawnChild: parseBool(process.env.FEATURE_ENABLE_SPAWN_CHILD, false),
    enableMemory: parseBool(process.env.FEATURE_ENABLE_MEMORY, false),
    enableSandboxExec: parseBool(process.env.FEATURE_ENABLE_SANDBOX_EXEC, false),
    enableRealWriteHigh: parseBool(process.env.FEATURE_ENABLE_REAL_WRITE_HIGH, false),
  };

  // EDR-014: MVP must keep these off unless explicitly overridden (still logged).
  assertMvpFlags(featureFlags);

  const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
  const autoExecuteTurn =
    mode === "serve" && parseBool(process.env.HARNESS_AUTO_EXECUTE_TURN, true);
  const roles = parseHarnessRoles(process.env);
  const workspaceDirRaw = process.env.HARNESS_WORKSPACE_DIR?.trim();
  const workspaceDir = workspaceDirRaw
    ? resolve(workspaceDirRaw)
    : defaultWorkspaceDir();

  const knowledgeBaseUrl = process.env.KNOWLEDGE_BASE_URL?.trim() || undefined;
  const knowledgeCollectionIds = parseCommaSeparated(process.env.KNOWLEDGE_COLLECTION_IDS);
  const knowledgeTopKRaw = process.env.KNOWLEDGE_TOP_K?.trim();
  const knowledgeTopK = knowledgeTopKRaw ? Number(knowledgeTopKRaw) : undefined;
  const knowledgeTimeoutMs =
    Number(process.env.KNOWLEDGE_TIMEOUT_MS ?? "60000") || 60_000;

  const contextProjectionPolicy = parseContextProjectionPolicy(process.env);
  const openaiMaxTokens = parseOptionalPositiveInt(process.env.OPENAI_MAX_TOKENS);

  return {
    persistenceDriver,
    modelDriver,
    openaiApiKey: process.env.OPENAI_API_KEY,
    openaiBaseUrl: process.env.OPENAI_BASE_URL,
    openaiModel: process.env.OPENAI_MODEL?.trim() || undefined,
    openaiResponseFormat:
      (process.env.OPENAI_RESPONSE_FORMAT ?? "json_object").trim().toLowerCase() === "none"
        ? "none"
        : "json_object",
    openaiAuthHeader:
      process.env.OPENAI_AUTH_HEADER?.trim() ||
      (process.env.OPENAI_API_KEY?.startsWith("ak_") ? "api-key" : undefined),
    openaiMaxTokens,
    databaseUrl:
      process.env.DATABASE_URL?.trim() ||
      "postgres://monai:monai@127.0.0.1:54329/monai_harness",
    port: Number(process.env.PORT ?? "3000") || 3000,
    mode,
    runEvalOnStart: parseBool(process.env.HARNESS_RUN_EVAL, true),
    loopIntervalMs: Number(process.env.HARNESS_LOOP_INTERVAL_MS ?? "500") || 500,
    featureFlags,
    corsOrigins,
    autoExecuteTurn,
    roles,
    workspaceDir,
    knowledgeBaseUrl,
    knowledgeCollectionIds,
    knowledgeTopK: Number.isFinite(knowledgeTopK) ? knowledgeTopK : undefined,
    knowledgeTimeoutMs,
    contextProjectionPolicy,
  };
}

function parseCommaSeparated(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseCorsOrigins(raw: string | undefined): string[] {
  const defaults = ["http://localhost:5173", "http://127.0.0.1:5173"];
  if (!raw?.trim()) return defaults;
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : defaults;
}

function assertMvpFlags(flags: FeatureFlags): void {
  const enabled = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => k);
  if (enabled.length > 0) {
    console.warn(
      `[harness][edr-014] non-default feature flags enabled: ${enabled.join(", ")} (MVP should keep these off)`,
    );
  }
}
