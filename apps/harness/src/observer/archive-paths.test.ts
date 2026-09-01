import { describe, expect, it } from "vitest";

import { demoRunArchiveDir, repoRootDir } from "./archive-paths.js";

describe("archive-paths", () => {
  it("resolves repo temp demo-runs directory", () => {
    const dir = demoRunArchiveDir("cli-test", new Date("2026-09-01T02:00:00.000Z"));
    expect(dir).toContain("temp");
    expect(dir).toContain("demo-runs");
    expect(dir).toContain("cli-test");
    expect(repoRootDir()).toContain("monai-harness");
  });
});
