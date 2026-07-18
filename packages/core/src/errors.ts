export const ERROR_CODES = [
  "AUTH_REQUIRED",
  "PERMISSION_DENIED",
  "VALIDATION_FAILED",
  "TIMEOUT",
  "AGENT_FAILED",
  "STEP_FAILED",
  "ASSERTION_FAILED",
  "APPROVAL_REJECTED",
  "CANCELLED",
  "NOT_FOUND",
  "CONFLICT",
  "ADAPTER_UNAVAILABLE",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface SerializedError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

export class AbtnError extends Error {
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "AbtnError";
    this.code = code;
    this.details = details;
  }

  serialize(): SerializedError {
    return { code: this.code, message: this.message, details: this.details };
  }
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof AbtnError) return err.serialize();
  if (err instanceof Error) return { code: "INTERNAL", message: err.message };
  return { code: "INTERNAL", message: String(err) };
}
