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
});
