import { describe, expect, it } from "vitest";

import { InMemoryWorkspace } from "./index.js";

describe("InMemoryWorkspace path escape", () => {
  it("rejects .. traversal on read", async () => {
    const ws = new InMemoryWorkspace({ "/safe/file.txt": "secret" });
    await expect(ws.read("/safe/../etc/passwd")).rejects.toThrow(/\.\./);
  });

  it("rejects .. traversal on write", async () => {
    const ws = new InMemoryWorkspace();
    await expect(ws.write("/../escape.txt", "x")).rejects.toThrow(/\.\./);
  });

  it("rejects non-absolute paths", async () => {
    const ws = new InMemoryWorkspace();
    await expect(ws.read("relative.txt")).rejects.toThrow(/absolute/);
  });

  it("round-trips write then read", async () => {
    const ws = new InMemoryWorkspace();
    await ws.write("/notes/out.md", "hello");
    const read = (await ws.read("/notes/out.md")) as { path: string; content: string };
    expect(read.path).toBe("/notes/out.md");
    expect(read.content).toBe("hello");
  });

  it("deletes a file and rejects root", async () => {
    const ws = new InMemoryWorkspace({ "/notes/out.md": "bye" });
    await ws.delete("/notes/out.md");
    await expect(ws.read("/notes/out.md")).rejects.toThrow(/not found/);
    await expect(ws.delete("/")).rejects.toThrow(/file path/);
  });
});
