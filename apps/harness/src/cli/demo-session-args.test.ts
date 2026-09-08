import { describe, expect, it } from "vitest";

import { parseSessionCliArgs } from "./demo-session.js";

describe("parseSessionCliArgs", () => {
  it("returns empty when no args", () => {
    expect(parseSessionCliArgs([])).toEqual({ resumeSessionId: undefined });
  });

  it("parses --resume=<sessionId>", () => {
    expect(parseSessionCliArgs(["--resume=cli-session-1"])).toEqual({
      resumeSessionId: "cli-session-1",
    });
  });

  it("throws when --resume= has empty value", () => {
    expect(() => parseSessionCliArgs(["--resume="])).toThrow(
      /--resume=<sessionId> requires a sessionId/,
    );
  });

  it("throws when --resume is used without equals form", () => {
    expect(() => parseSessionCliArgs(["--resume", "cli-session-1"])).toThrow(
      /use --resume=<sessionId>/,
    );
  });

  it("throws on unknown option", () => {
    expect(() => parseSessionCliArgs(["--foo"])).toThrow(/unknown option --foo/);
  });

  it("throws on unexpected positional argument", () => {
    expect(() => parseSessionCliArgs(["cli-session-1"])).toThrow(/unexpected argument/);
  });
});
