import { describe, expect, it } from "vitest";
import { EnvSecretPort } from "./env-secret.js";

describe("EnvSecretPort", () => {
  it("resolves secret by key and env: prefix", async () => {
    const port = new EnvSecretPort({
      envMap: {
        OPENAI_API_KEY: "sk-test-12345",
        ANTHROPIC_API_KEY: "ant-test-67890",
      },
    });

    expect(await port.resolve("OPENAI_API_KEY")).toBe("sk-test-12345");
    expect(await port.resolve("env:OPENAI_API_KEY")).toBe("sk-test-12345");
    expect(await port.resolve("ANTHROPIC_API_KEY")).toBe("ant-test-67890");
  });

  it("throws error for missing secret", async () => {
    const port = new EnvSecretPort({ envMap: {} });
    await expect(port.resolve("NON_EXISTENT")).rejects.toThrow("Secret not found: NON_EXISTENT");
  });

  it("leases secret with expiresAt timestamp", async () => {
    const port = new EnvSecretPort({
      envMap: { API_KEY: "test-val" },
      defaultTtlMs: 30_000,
    });

    const lease = await port.lease("API_KEY", 5000);
    expect(lease.secretRef).toBe("API_KEY");
    expect(lease.value).toBe("test-val");
    expect(new Date(lease.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });
});
