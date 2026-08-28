import type { SecretLease, SecretPort } from "@monai/ports";

export interface EnvSecretPortOptions {
  envMap?: Record<string, string | undefined>;
  defaultTtlMs?: number;
}

/**
 * EnvSecretPort — provides short-lived leased secrets from environment variables (design 06 §3).
 * Secrets never leak into Context or Event payloads.
 */
export class EnvSecretPort implements SecretPort {
  private readonly envMap: Record<string, string | undefined>;
  private readonly defaultTtlMs: number;

  constructor(options: EnvSecretPortOptions = {}) {
    this.envMap = options.envMap ?? process.env;
    this.defaultTtlMs = options.defaultTtlMs ?? 60_000;
  }

  private normalizeKey(secretRef: string): string {
    if (secretRef.startsWith("env:")) {
      return secretRef.slice(4);
    }
    return secretRef;
  }

  async resolve(secretRef: string): Promise<string> {
    const key = this.normalizeKey(secretRef);
    const val = this.envMap[key];
    if (val === undefined || val === "") {
      throw new Error(`Secret not found: ${secretRef}`);
    }
    return val;
  }

  async lease(secretRef: string, ttlMs?: number): Promise<SecretLease> {
    const value = await this.resolve(secretRef);
    const ttl = ttlMs ?? this.defaultTtlMs;
    const expiresAt = new Date(Date.now() + ttl).toISOString();
    return {
      secretRef,
      value,
      expiresAt,
    };
  }
}
