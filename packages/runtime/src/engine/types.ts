import type { ErrorCategory, Run } from "@monai/contracts";

export type HandleSuccess = {
  ok: true;
  run: Run;
  revision: number;
  leaseEpoch: number;
  idempotent?: boolean;
};

export type HandleFailure = {
  ok: false;
  code: ErrorCategory;
  message?: string;
};

export type HandleResult = HandleSuccess | HandleFailure;
