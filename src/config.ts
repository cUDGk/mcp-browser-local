import os from "node:os";
import path from "node:path";

export type ServerConfig = {
  logLevel: "error" | "warn" | "info" | "debug";
  allowAttach: boolean;
  allowLaunch: boolean;
  allowEval: boolean;
  allowFileUpload: boolean;
  allowedUploadRoots: string[];
  allowedReadRoots: string[];
  allowPrivateNetworks: boolean;
  allowRemoteAttach: boolean;
  allowCrossOriginCookies: boolean;
  allowedExecutables: string[];
  allowedProfileRoots: string[];
  downloadsDir: string;
  screenshotDir: string;
  tempDir: string;
  maxSnapshotElements: number;
  maxTextChars: number;
  maxHtmlChars: number;
  maxEvalResultChars: number;
  maxEvalResultItems: number;
  maxEvalExpressionChars: number;
  maxElementRefs: number;
  maxTabsPerSession: number;
  maxSessions: number;
  maxNotesPerTab: number;
  maxPdfBytes: number;
  maxPdfPages: number;
  maxProfileBytes: number;
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
  const tempDir = process.env.MCP_BROWSER_TEMP_DIR ?? path.join(baseDir, "tmp");
  const allowedUploadRoots = parseRoots(process.env.MCP_BROWSER_ALLOWED_UPLOAD_ROOTS);
  const allowedReadRoots = parseRoots(process.env.MCP_BROWSER_ALLOWED_READ_ROOTS);
  const downloadsDir = process.env.MCP_BROWSER_DOWNLOAD_DIR ?? path.join(baseDir, "downloads");
  const allowedProfileRoots = parseRoots(process.env.MCP_BROWSER_ALLOWED_PROFILE_ROOTS);

  const validLogLevels: ServerConfig["logLevel"][] = ["error", "warn", "info", "debug"];
  const rawLogLevel = process.env.MCP_BROWSER_LOG_LEVEL ?? "info";
  const logLevel: ServerConfig["logLevel"] = (validLogLevels as string[]).includes(rawLogLevel)
    ? (rawLogLevel as ServerConfig["logLevel"])
    : "info";

  return {
    logLevel,
    allowAttach: parseBool(process.env.MCP_BROWSER_ALLOW_ATTACH, true),
    allowLaunch: parseBool(process.env.MCP_BROWSER_ALLOW_LAUNCH, true),
    allowEval: parseBool(process.env.MCP_BROWSER_ALLOW_EVAL, false),
    allowFileUpload: parseBool(process.env.MCP_BROWSER_ALLOW_FILE_UPLOAD, false),
    allowedUploadRoots,
    // S2: PDF filePath reads are restricted to these roots; defaults cover downloads / temp.
    allowedReadRoots: allowedReadRoots.length ? allowedReadRoots : [downloadsDir, tempDir, ...allowedUploadRoots],
    allowPrivateNetworks: parseBool(process.env.MCP_BROWSER_ALLOW_PRIVATE_NETWORKS, false),
    allowRemoteAttach: parseBool(process.env.MCP_BROWSER_ALLOW_REMOTE_ATTACH, false),
    allowCrossOriginCookies: parseBool(process.env.MCP_BROWSER_ALLOW_CROSS_ORIGIN_COOKIES, false),
    allowedExecutables: parseRoots(process.env.MCP_BROWSER_ALLOWED_EXECUTABLES),
    // profilePath validation: defaults to tempDir.
    allowedProfileRoots: allowedProfileRoots.length ? allowedProfileRoots : [tempDir],
    downloadsDir,
    screenshotDir: process.env.MCP_BROWSER_SCREENSHOT_DIR ?? path.join(baseDir, "screenshots"),
    tempDir,
    maxSnapshotElements: parseIntWithDefault(process.env.MCP_BROWSER_MAX_SNAPSHOT_ELEMENTS, 80),
    maxTextChars: parseIntWithDefault(process.env.MCP_BROWSER_MAX_TEXT_CHARS, 12000),
    maxHtmlChars: parseIntWithDefault(process.env.MCP_BROWSER_MAX_HTML_CHARS, 20000),
    maxEvalResultChars: parseIntWithDefault(process.env.MCP_BROWSER_MAX_EVAL_RESULT_CHARS, 4000),
    maxEvalResultItems: parseIntWithDefault(process.env.MCP_BROWSER_MAX_EVAL_RESULT_ITEMS, 100),
    maxEvalExpressionChars: parseIntWithDefault(process.env.MCP_BROWSER_MAX_EVAL_EXPRESSION_CHARS, 10240),
    maxElementRefs: parseIntWithDefault(process.env.MCP_BROWSER_MAX_ELEMENT_REFS, 5000),
    maxTabsPerSession: parseIntWithDefault(process.env.MCP_BROWSER_MAX_TABS_PER_SESSION, 64),
    maxSessions: parseIntWithDefault(process.env.MCP_BROWSER_MAX_SESSIONS, 16),
    maxNotesPerTab: parseIntWithDefault(process.env.MCP_BROWSER_MAX_NOTES_PER_TAB, 200),
    maxPdfBytes: parseIntWithDefault(process.env.MCP_BROWSER_MAX_PDF_BYTES, 200 * 1024 * 1024),
    maxPdfPages: parseIntWithDefault(process.env.MCP_BROWSER_MAX_PDF_PAGES, 200),
    maxProfileBytes: parseIntWithDefault(process.env.MCP_BROWSER_MAX_PROFILE_BYTES, 1024 * 1024 * 1024),
    defaultCommandTimeoutMs: parseIntWithDefault(process.env.MCP_BROWSER_DEFAULT_TIMEOUT_MS, 15000)
  };
}
