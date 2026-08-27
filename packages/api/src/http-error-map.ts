import type { ErrorCategory } from "@monai/contracts";

/**
 * Map domain ErrorCategory → HTTP status (does not change category semantics).
 */
export const ERROR_CATEGORY_HTTP_STATUS: Record<ErrorCategory, number> = {
  validation: 400,
  authorization: 403,
  approval_required: 409,
  hook_vetoed: 409,
  conflict: 409,
  lease_lost: 409,
  outcome_unknown: 409,
  transient: 503,
  budget_exceeded: 429,
  fatal: 500,
};

export type HttpErrorBody = {
  ok: false;
  code: ErrorCategory | "not_found" | "bad_request";
  message: string;
  httpStatus: number;
};

export function mapErrorCategoryToHttpStatus(code: ErrorCategory): number {
  return ERROR_CATEGORY_HTTP_STATUS[code] ?? 500;
}

export function httpErrorFromHandleFailure(failure: {
  code: ErrorCategory;
  message?: string;
}): HttpErrorBody {
  const httpStatus = mapErrorCategoryToHttpStatus(failure.code);
  return {
    ok: false,
    code: failure.code,
    message: failure.message ?? failure.code,
    httpStatus,
  };
}

export function notFound(message = "not found"): HttpErrorBody {
  return { ok: false, code: "not_found", message, httpStatus: 404 };
}

export function badRequest(message: string): HttpErrorBody {
  return { ok: false, code: "bad_request", message, httpStatus: 400 };
}
