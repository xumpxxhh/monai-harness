import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

import type { ObjectStorePort } from "@monai/ports";

export type FsObjectStoreOptions = {
  /** Absolute root directory for all object blobs. */
  rootDir: string;
  /** Tenant partition under root (required for isolation). */
  tenantId: string;
};

/**
 * Filesystem ObjectStorePort: tenant-scoped paths + content hash check.
 * signedRef returns a local file:// URL (MVP; not a time-limited signed URL).
 */
export class FsObjectStore implements ObjectStorePort {
  private readonly rootDir: string;
  private readonly tenantId: string;
  private readonly tenantRoot: string;

  constructor(options: FsObjectStoreOptions) {
    if (!options.tenantId.trim()) {
      throw new Error("FsObjectStore requires non-empty tenantId");
    }
    if (options.tenantId.includes("..") || options.tenantId.includes("/") || options.tenantId.includes("\\")) {
      throw new Error("FsObjectStore tenantId must be a single path segment");
    }
    this.rootDir = resolve(options.rootDir);
    this.tenantId = options.tenantId.trim();
    this.tenantRoot = resolve(this.rootDir, this.tenantId);
  }

  getTenantRoot(): string {
    return this.tenantRoot;
  }

  async put(key: string, body: Uint8Array, hash: string): Promise<string> {
    const expected = contentHash(body);
    if (!hashesEqual(hash, expected)) {
      throw new Error(
        `objectstore hash mismatch: provided=${normalizeHash(hash)} computed=${expected}`,
      );
    }
    const abs = this.resolveKeyPath(key);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, body);
    return key;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const abs = this.resolveKeyPath(key);
    try {
      const buf = await readFile(abs);
      return new Uint8Array(buf);
    } catch (err) {
      if (isNotFound(err)) return undefined;
      throw err;
    }
  }

  async signedRef(key: string): Promise<string> {
    const abs = this.resolveKeyPath(key);
    return pathToFileURL(abs).href;
  }

  private resolveKeyPath(key: string): string {
    const normalized = key.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalized || normalized.includes("\0") || normalized.split("/").includes("..")) {
      throw new Error(`objectstore path escape rejected: ${key}`);
    }
    const abs = resolve(this.tenantRoot, normalized);
    const rootWithSep = this.tenantRoot.endsWith(sep) ? this.tenantRoot : this.tenantRoot + sep;
    if (abs !== this.tenantRoot && !abs.startsWith(rootWithSep)) {
      throw new Error(`objectstore path escape rejected: ${key}`);
    }
    return abs;
  }
}

export function contentHash(body: Uint8Array): string {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

function normalizeHash(hash: string): string {
  const trimmed = hash.trim();
  if (trimmed.startsWith("sha256:")) return trimmed.toLowerCase();
  return `sha256:${trimmed.toLowerCase()}`;
}

function hashesEqual(provided: string, computed: string): boolean {
  return normalizeHash(provided) === computed.toLowerCase();
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: string }).code === "ENOENT"
  );
}
