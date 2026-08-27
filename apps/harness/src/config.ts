import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type PersistenceDriver = "memory" | "postgres";

export type FeatureFlags = {
  enableDag: boolean;
  enableSpawnChild: boolean;
  enableMemory: boolean;
  enableSandboxExec: boolean;
  enableRealWriteHigh: boolean;
};

export type HarnessConfig = {
  persistenceDriver: PersistenceDriver;
  databaseUrl: string;
  port: number;
  /** demo = CreateRun→execute_turn then exit; serve = keep delivery loops */
  mode: "demo" | "serve";
  runEvalOnStart: boolean;
  loopIntervalMs: number;
  featureFlags: FeatureFlags;
};

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw.trim() === "") return fallback;
  const v = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(v)) return true;
  if (["0", "false", "no", "off"].includes(v)) return false;
  return fallback;
}

/** Load `.env` without overriding existing process.env. Tries cwd then repo root. */
export function loadDotEnv(): void {
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../.env"),
  ];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = value;
      }
    }
    return;
  }
}

export function loadConfig(): HarnessConfig {
  loadDotEnv();

  const driverRaw = (process.env.PERSISTENCE_DRIVER ?? "memory").trim().toLowerCase();
  const persistenceDriver: PersistenceDriver =
    driverRaw === "postgres" ? "postgres" : "memory";

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

  return {
    persistenceDriver,
    databaseUrl:
      process.env.DATABASE_URL?.trim() ||
      "postgres://monai:monai@127.0.0.1:54329/monai_harness",
    port: Number(process.env.PORT ?? "3000") || 3000,
    mode,
    runEvalOnStart: parseBool(process.env.HARNESS_RUN_EVAL, true),
    loopIntervalMs: Number(process.env.HARNESS_LOOP_INTERVAL_MS ?? "500") || 500,
    featureFlags,
  };
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
