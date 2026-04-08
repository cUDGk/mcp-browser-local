import type { ToolErrorCode, ToolFailure } from "../types/common.js";

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;

  constructor(code: ToolErrorCode, message: string, retryable = false, details?: Record<string, unknown>) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.retryable = retryable;
    this.details = details;
  }

  toFailure(): ToolFailure {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      details: this.details
    };
  }
}

export function asToolError(error: unknown, fallbackCode: ToolErrorCode = "INTERNAL_ERROR"): ToolError {
  if (error instanceof ToolError) {
    return error;
  }

  if (error instanceof Error) {
    return new ToolError(fallbackCode, error.message);
  }

  return new ToolError(fallbackCode, "Unknown error");
}
