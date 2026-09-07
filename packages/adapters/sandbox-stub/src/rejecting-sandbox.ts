import type { SandboxPort } from "@monai/ports";

export const SANDBOX_EXEC_DISABLED_MESSAGE =
  "sandbox.exec is disabled in MVP (EDR-014); SandboxPort stub rejects all exec";

/**
 * Non-executable SandboxPort (EDR-014).
 * Inject so DI cannot accidentally omit a port and later mount a real sandbox unnoticed.
 */
export class RejectingSandbox implements SandboxPort {
  async exec(_request: unknown): Promise<never> {
    throw new Error(SANDBOX_EXEC_DISABLED_MESSAGE);
  }
}
