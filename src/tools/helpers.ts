import type { ToolResult } from "../types/common.js";
import { asToolError } from "../core/errors.js";

export async function runTool<T>(meta: { sessionId?: string; tabId?: string }, fn: () => Promise<T>): Promise<ToolResult<T>> {
  const startedAt = Date.now();
  try {
    const data = await fn();
    return {
      ok: true,
      data,
      meta: {
        sessionId: meta.sessionId,
        tabId: meta.tabId,
        durationMs: Date.now() - startedAt
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: asToolError(error).toFailure(),
      meta: {
        sessionId: meta.sessionId,
        tabId: meta.tabId,
        durationMs: Date.now() - startedAt
      }
    };
  }
}
