import type { ToolResult } from "../types/common.js";
import { asToolError } from "../core/errors.js";

// Claude Code などの LLM クライアントは object / array 型の引数を JSON 文字列化して
// 渡してくる場合がある。zod が string を reject するより先に緩く正規化する。
export function coerceObject<T>(val: unknown): T | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "") return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object") return parsed as T;
    } catch {
      // fallthrough
    }
    return undefined;
  }
  if (typeof val === "object") return val as T;
  return undefined;
}

export function coerceArray<T>(val: unknown): T[] | undefined {
  if (val === undefined || val === null) return undefined;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed === "") return undefined;
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed as T[];
    } catch {
      // fallthrough
    }
    return undefined;
  }
  if (Array.isArray(val)) return val as T[];
  return undefined;
}

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
