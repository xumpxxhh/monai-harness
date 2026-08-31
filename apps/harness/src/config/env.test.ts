import { describe, expect, it } from "vitest";

import {
  allHarnessRolesEnabled,
  formatHarnessRoles,
  hasDeliveryRole,
  parseHarnessRoles,
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
