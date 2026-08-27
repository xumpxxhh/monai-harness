export type SyntheticWriteInput = {
  resourceKey: string;
  payload: unknown;
  idempotencyKey: string;
};

export type SyntheticWriteResult = {
  resourceKey: string;
  effectCount: number;
  status: "applied" | "duplicate";
  payloadHash: string;
};

export type SyntheticSinkOptions = {
  /** When true, next write throws TimeoutError without applying (inject once). */
  timeoutNextWrite?: boolean;
};

export class SyntheticTimeoutError extends Error {
  readonly code = "synthetic_timeout" as const;
  constructor(message = "synthetic sink timeout") {
    super(message);
    this.name = "SyntheticTimeoutError";
  }
}

/**
 * Isolated synthetic write_high sink for approval/unknown/reconcile tests.
 * Must never be wired to real external HTTP.
 */
export class IsolatedSyntheticSink {
  private readonly effects = new Map<
    string,
    { count: number; lastPayloadHash: string; lastIdempotencyKey: string; payload: unknown }
  >();
  private timeoutNextWrite: boolean;

  constructor(options: SyntheticSinkOptions = {}) {
    this.timeoutNextWrite = options.timeoutNextWrite ?? false;
  }

  setTimeoutNextWrite(value: boolean): void {
    this.timeoutNextWrite = value;
  }

  async write(input: SyntheticWriteInput): Promise<SyntheticWriteResult> {
    if (this.timeoutNextWrite) {
      this.timeoutNextWrite = false;
      // Side effect may or may not have applied — here we apply then "lose" the response
      // so reconcile can find authoritative success (common timeout-after-commit case).
      this.apply(input);
      throw new SyntheticTimeoutError();
    }
    return this.apply(input);
  }

  async reconcile(resourceKey: string, idempotencyKey: string): Promise<SyntheticWriteResult | undefined> {
    const row = this.effects.get(resourceKey);
    if (!row) return undefined;
    if (row.lastIdempotencyKey !== idempotencyKey) {
      return undefined;
    }
    return {
      resourceKey,
      effectCount: row.count,
      status: "applied",
      payloadHash: row.lastPayloadHash,
    };
  }

  effectCount(resourceKey: string): number {
    return this.effects.get(resourceKey)?.count ?? 0;
  }

  private apply(input: SyntheticWriteInput): SyntheticWriteResult {
    const payloadHash = `hash:${input.idempotencyKey}:${stableString(input.payload)}`;
    const prev = this.effects.get(input.resourceKey);
    if (prev && prev.lastIdempotencyKey === input.idempotencyKey) {
      return {
        resourceKey: input.resourceKey,
        effectCount: prev.count,
        status: "duplicate",
        payloadHash: prev.lastPayloadHash,
      };
    }
    const count = (prev?.count ?? 0) + 1;
    this.effects.set(input.resourceKey, {
      count,
      lastPayloadHash: payloadHash,
      lastIdempotencyKey: input.idempotencyKey,
      payload: input.payload,
    });
    return {
      resourceKey: input.resourceKey,
      effectCount: count,
      status: "applied",
      payloadHash,
    };
  }
}

function stableString(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value ?? null);
}

export const PACKAGE_NAME = "@monai/synthetic-sink" as const;
