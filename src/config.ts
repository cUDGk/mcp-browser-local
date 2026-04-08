import os from "node:os";
import path from "node:path";

export type ServerConfig = {
  logLevel: "error" | "warn" | "info" | "debug";
  allowAttach: boolean;
  allowLaunch: boolean;
  allowEval: boolean;
  allowFileUpload: boolean;
  allowedUploadRoots: string[];
  downloadsDir: string;
  screenshotDir: string;
  tempDir: string;
  maxSnapshotElements: number;
  maxTextChars: number;
  maxHtmlChars: number;
  maxEvalResultChars: number;
  maxEvalResultItems: number;
  defaultCommandTimeoutMs: number;
};

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseIntWithDefault(value: string | undefined, defaultValue: number): number {
  if (!value) {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function parseRoots(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadConfig(): ServerConfig {
  const baseDir = path.join(os.homedir(), ".mcp-browser-local");

  return {
    logLevel: (process.env.MCP_BROWSER_LOG_LEVEL as ServerConfig["logLevel"]) ?? "info",
    allowAttach: parseBool(process.env.MCP_BROWSER_ALLOW_ATTACH, true),
    allowLaunch: parseBool(process.env.MCP_BROWSER_ALLOW_LAUNCH, true),
    allowEval: parseBool(process.env.MCP_BROWSER_ALLOW_EVAL, false),
    allowFileUpload: parseBool(process.env.MCP_BROWSER_ALLOW_FILE_UPLOAD, false),
    allowedUploadRoots: parseRoots(process.env.MCP_BROWSER_ALLOWED_UPLOAD_ROOTS),
    downloadsDir: process.env.MCP_BROWSER_DOWNLOAD_DIR ?? path.join(baseDir, "downloads"),
    screenshotDir: process.env.MCP_BROWSER_SCREENSHOT_DIR ?? path.join(baseDir, "screenshots"),
    tempDir: process.env.MCP_BROWSER_TEMP_DIR ?? path.join(baseDir, "tmp"),
    maxSnapshotElements: parseIntWithDefault(process.env.MCP_BROWSER_MAX_SNAPSHOT_ELEMENTS, 80),
    maxTextChars: parseIntWithDefault(process.env.MCP_BROWSER_MAX_TEXT_CHARS, 12000),
    maxHtmlChars: parseIntWithDefault(process.env.MCP_BROWSER_MAX_HTML_CHARS, 20000),
    maxEvalResultChars: parseIntWithDefault(process.env.MCP_BROWSER_MAX_EVAL_RESULT_CHARS, 4000),
    maxEvalResultItems: parseIntWithDefault(process.env.MCP_BROWSER_MAX_EVAL_RESULT_ITEMS, 100),
    defaultCommandTimeoutMs: parseIntWithDefault(process.env.MCP_BROWSER_DEFAULT_TIMEOUT_MS, 15000)
  };
}
