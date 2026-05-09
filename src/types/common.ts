export type BrowserKind = "brave" | "chrome" | "edge" | "chromium";
export type SessionMode = "attach" | "launch";
export type ProfileMode = "isolated" | "profile-path";

export type ToolMeta = {
  sessionId?: string;
  tabId?: string;
  durationMs: number;
};

export type ToolErrorCode =
  | "BROWSER_NOT_FOUND"
  | "BROWSER_NOT_RUNNING"
  | "BROWSER_NOT_ATTACHABLE"
  | "DEBUGGING_ENDPOINT_NOT_FOUND"
  | "ATTACH_FAILED"
  | "LAUNCH_FAILED"
  | "PROFILE_LOCKED"
  | "SESSION_NOT_FOUND"
  | "TAB_NOT_FOUND"
  | "WINDOW_NOT_FOUND"
  | "ELEMENT_NOT_FOUND"
  | "ELEMENT_REF_STALE"
  | "SELECTOR_NOT_FOUND"
  | "AMBIGUOUS_TARGET"
  | "ELEMENT_NOT_VISIBLE"
  | "ELEMENT_NOT_INTERACTABLE"
  | "NAVIGATION_TIMEOUT"
  | "WAIT_TIMEOUT"
  | "DOWNLOAD_TIMEOUT"
  | "PDF_OPEN_FAILED"
  | "PDF_PARSE_FAILED"
  | "EVAL_DISABLED"
  | "UPLOAD_PATH_NOT_ALLOWED"
  | "INVALID_ARGUMENT"
  | "UNSUPPORTED_OPERATION"
  | "RESULT_TOO_LARGE"
  | "RESOURCE_LIMIT"
  | "INTERNAL_ERROR";

export type ToolFailure = {
  code: ToolErrorCode;
  message: string;
  retryable: boolean;
  details?: Record<string, unknown>;
};

export type ToolResult<T> =
  | {
      ok: true;
      data: T;
      meta: ToolMeta;
    }
  | {
      ok: false;
      error: ToolFailure;
      meta: ToolMeta;
    };

export type BoundingBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};
