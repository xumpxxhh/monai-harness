import pg from "pg";

const { Pool } = pg;

/** Matches root `docker-compose.yml` service `postgres`. */
export const DEFAULT_TEST_DATABASE_URL =
  "postgres://monai:monai@127.0.0.1:54329/monai_harness";

export type TestPgHandle = {
  connectionString: string;
  pool: pg.Pool;
  stop: () => Promise<void>;
};

async function waitForPostgres(connectionString: string, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const pool = new Pool({ connectionString });
    try {
      await pool.query("SELECT 1");
      await pool.end();
      return;
    } catch (err) {
      lastError = err;
      await pool.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(
    `Postgres not ready at ${connectionString}: ${String(lastError)}. ` +
      `Start the fixed project DB with: docker compose up -d postgres`,
  );
}

/**
 * Connect to the project-fixed Postgres (compose `postgres` or DATABASE_URL).
 * Does not pull/run/rm containers — leave lifecycle to docker compose.
 */
export async function startTestPostgres(): Promise<TestPgHandle> {
  const connectionString =
    process.env.DATABASE_URL?.trim() || DEFAULT_TEST_DATABASE_URL;
  await waitForPostgres(connectionString);
  const pool = new Pool({ connectionString });
  return {
    connectionString,
    pool,
    stop: async () => {
      await pool.end();
    },
  };
}
