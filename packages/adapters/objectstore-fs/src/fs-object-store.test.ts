import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { contentHash, FsObjectStore } from "./fs-object-store.js";

describe("FsObjectStore", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function freshStore(tenantId = "tenant-a"): Promise<FsObjectStore> {
    const root = await mkdtemp(join(tmpdir(), "monai-obj-"));
    roots.push(root);
    return new FsObjectStore({ rootDir: root, tenantId });
  }

  it("puts and gets by key when hash matches", async () => {
    const store = await freshStore();
    const body = new TextEncoder().encode("hello artifact");
    const hash = contentHash(body);
    await expect(store.put("notes/a.md", body, hash)).resolves.toBe("notes/a.md");
    const got = await store.get("notes/a.md");
    expect(got).toEqual(body);
  });

  it("rejects hash mismatch", async () => {
    const store = await freshStore();
    const body = new TextEncoder().encode("hello");
    await expect(store.put("x.bin", body, "sha256:deadbeef")).rejects.toThrow(/hash mismatch/);
  });

  it("rejects path escape", async () => {
    const store = await freshStore();
    const body = new TextEncoder().encode("x");
    const hash = contentHash(body);
    await expect(store.put("../escape.bin", body, hash)).rejects.toThrow(/path escape/);
    await expect(store.get("a/../../etc/passwd")).rejects.toThrow(/path escape/);
  });

  it("isolates tenants under separate roots", async () => {
    const root = await mkdtemp(join(tmpdir(), "monai-obj-"));
    roots.push(root);
    const a = new FsObjectStore({ rootDir: root, tenantId: "t1" });
    const b = new FsObjectStore({ rootDir: root, tenantId: "t2" });
    const body = new TextEncoder().encode("secret-for-t1");
    const hash = contentHash(body);
    await a.put("shared-name.bin", body, hash);
    expect(await b.get("shared-name.bin")).toBeUndefined();
    expect(await a.get("shared-name.bin")).toEqual(body);
  });

  it("signedRef returns file URL under tenant root", async () => {
    const store = await freshStore("tenant-x");
    const body = new TextEncoder().encode("ref");
    const hash = contentHash(body);
    await store.put("blob.dat", body, hash);
    const ref = await store.signedRef("blob.dat");
    expect(ref.startsWith("file://")).toBe(true);
    expect(ref.includes("tenant-x")).toBe(true);
  });
});
