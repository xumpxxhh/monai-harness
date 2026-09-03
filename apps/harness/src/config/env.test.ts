import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT_PROJECTION_POLICY } from "@monai/contracts";

import {
  allHarnessRolesEnabled,
  formatHarnessRoles,
  hasDeliveryRole,
  parseContextProjectionPolicy,
  parseHarnessRoles,
  parsePositiveInt,
} from "./env.js";

describe("parseHarnessRoles", () => {
  it("defaults all roles on when unset", () => {
    expect(parseHarnessRoles({})).toEqual(allHarnessRolesEnabled());
  });

  it("treats empty HARNESS_ROLES as unset", () => {
    expect(parseHarnessRoles({ HARNESS_ROLES: "  " })).toEqual(allHarnessRolesEnabled());
  });

  it("HARNESS_ROLES is an allowlist", () => {
    expect(parseHarnessRoles({ HARNESS_ROLES: "api, worker" })).toEqual({
      api: true,
      dispatcher: false,
      scheduler: false,
      worker: true,
      observability: false,
      governance: false,
    });
  });

  it("HARNESS_ROLE_* disables a single role", () => {
    expect(parseHarnessRoles({ HARNESS_ROLE_API: "false" })).toEqual({
      ...allHarnessRolesEnabled(),
      api: false,
    });
  });

  it("allowlist wins over individual flags", () => {
    expect(
      parseHarnessRoles({
        HARNESS_ROLES: "api",
        HARNESS_ROLE_DISPATCHER: "true",
      }),
    ).toEqual({
      api: true,
      dispatcher: false,
      scheduler: false,
      worker: false,
      observability: false,
      governance: false,
    });
  });
});

describe("role helpers", () => {
  it("hasDeliveryRole is true when any delivery role is on", () => {
    expect(hasDeliveryRole(allHarnessRolesEnabled())).toBe(true);
    expect(
      hasDeliveryRole({
        ...allHarnessRolesEnabled(),
        dispatcher: false,
        scheduler: false,
        worker: false,
      }),
    ).toBe(false);
    expect(
      hasDeliveryRole({
        api: true,
        dispatcher: false,
        scheduler: false,
        worker: true,
        observability: false,
        governance: false,
      }),
    ).toBe(true);
  });

  it("formatHarnessRoles lists every role", () => {
    expect(formatHarnessRoles(allHarnessRolesEnabled())).toBe(
      "api=true dispatcher=true scheduler=true worker=true observability=true governance=true",
    );
  });
});

describe("parsePositiveInt", () => {
  it("returns fallback for blank or invalid", () => {
    expect(parsePositiveInt(undefined, 6)).toBe(6);
    expect(parsePositiveInt("  ", 6)).toBe(6);
    expect(parsePositiveInt("0", 6)).toBe(6);
    expect(parsePositiveInt("-1", 6)).toBe(6);
    expect(parsePositiveInt("1.5", 6)).toBe(6);
  });

  it("parses positive integers", () => {
    expect(parsePositiveInt("24", 6)).toBe(24);
  });
});

describe("parseContextProjectionPolicy", () => {
  it("defaults to contract defaults when unset", () => {
    expect(parseContextProjectionPolicy({})).toEqual(DEFAULT_CONTEXT_PROJECTION_POLICY);
  });

  it("overrides individual CONTEXT_* keys", () => {
    expect(
      parseContextProjectionPolicy({
        CONTEXT_RECENT_TURN_COUNT: "24",
        CONTEXT_RECENT_TOKEN_BUDGET: "32000",
        CONTEXT_COMPRESS_THRESHOLD: "64000",
        CONTEXT_MAX_TOTAL_TOKENS: "64000",
        CONTEXT_MAX_TOOL_CONTENT_CHARS: "32000",
      }),
    ).toEqual({
      recentTurnCount: 24,
      recentTokenBudget: 32000,
      compressThreshold: 64000,
      maxTotalTokens: 64000,
      maxToolContentChars: 32000,
    });
  });
});
