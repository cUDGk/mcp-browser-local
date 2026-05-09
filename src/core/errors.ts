import { z } from "zod";
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

  // B30: surface zod validation errors as INVALID_ARGUMENT with the issues array.
  if (error instanceof z.ZodError) {
    return new ToolError("INVALID_ARGUMENT", "Invalid arguments", false, {
      issues: error.issues
    });
  }

  if (error instanceof Error) {
    return new ToolError(fallbackCode, error.message);
  }

  return new ToolError(fallbackCode, "Unknown error");
}
