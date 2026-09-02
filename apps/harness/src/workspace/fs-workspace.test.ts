import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { FsWorkspace } from "./fs-workspace.js";

describe("FsWorkspace", () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    tmpDirs.length = 0;
  });

  async function makeWorkspace(files: Record<string, string>): Promise<FsWorkspace> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "harness-ws-"));
    tmpDirs.push(dir);
    for (const [rel, content] of Object.entries(files)) {
      const abs = path.join(dir, rel);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, content, "utf8");
    }
    return new FsWorkspace(dir);
  }

  it("lists root entries from disk", async () => {
    const ws = await makeWorkspace({
      "readme.md": "hello",
      "notes/a.md": "note",
    });
    const entries = (await ws.list("/")) as Array<{ name: string; path: string }>;
    expect(entries.map((e) => e.name).sort()).toEqual(["notes", "readme.md"]);
  });

  it("reads and writes files", async () => {
    const ws = await makeWorkspace({ "readme.md": "hello" });
    const read = (await ws.read("/readme.md")) as { path: string; content: string };
    expect(read.content).toBe("hello");

    await ws.write("/1.txt", "111");
    const created = (await ws.read("/1.txt")) as { content: string };
    expect(created.content).toBe("111");

    await ws.write("/notes/out.md", "nested");
    const nested = (await ws.read("/notes/out.md")) as { content: string };
    expect(nested.content).toBe("nested");
  });

  it("rejects path escape", async () => {
    const ws = await makeWorkspace({ "readme.md": "hello" });
    await expect(ws.read("/../secret")).rejects.toThrow(/rejects \.\./);
  });
});
