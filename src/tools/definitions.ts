// U1: every property has a description.
// U2: url properties carry format: "uri".
// U3: typed cookie schema.
// U4: storage_set entries enforces string values.
// U5: pages.items typed.
// U6: target oneOf-style refinement (anyOf at JSON-Schema level).
// U7/U13: browser_eval description warns about RCE / disabled-by-default.
// U8: defaults declared so IDEs / clients can autocomplete.
// U9: chromium kept; doc note added in description.
// U14: note minLength on browser_note_tab.

const sessionIdProp = { type: "string", description: "Session ID returned by browser_connect or browser_launch." } as const;
const tabIdProp = { type: "string", description: "Optional tab ID; falls back to the session's active tab when omitted." } as const;
const requiredTabIdProp = { type: "string", description: "Tab ID to operate on." } as const;
const timeoutMsProp = { type: "number", description: "Optional timeout in milliseconds; defaults to MCP_BROWSER_DEFAULT_TIMEOUT_MS (15000)." } as const;
const browserKindProp = {
  type: "string",
  enum: ["brave", "chrome", "edge", "chromium"],
  description: "Browser kind. \"chromium\" is accepted but only matches an installation if a chromium.exe is detected (BROWSER_NOT_FOUND otherwise)."
} as const;

const cookieSchema = {
  type: "object",
  description: "A single cookie. Either domain+path or url is recommended.",
  properties: {
    name: { type: "string", description: "Cookie name (required)." },
    value: { type: "string", description: "Cookie value (required)." },
    domain: { type: "string", description: "Cookie domain (e.g. example.com)." },
    path: { type: "string", description: "Cookie path (default '/')." },
    expires: { type: "number", description: "Expiration UNIX time in seconds." },
    httpOnly: { type: "boolean", description: "Set HttpOnly flag." },
    secure: { type: "boolean", description: "Set Secure flag." },
    sameSite: { type: "string", enum: ["Strict", "Lax", "None"], description: "SameSite policy." },
    url: { type: "string", format: "uri", description: "URL the cookie applies to. Equivalent to specifying domain+path." }
  },
  required: ["name", "value"],
  additionalProperties: false
} as const;

const targetSchema = {
  type: "object",
  // U4: precedence note when multiple fields are supplied.
  description: "Target an element. Provide exactly one of elementRef, selector, or textQuery. When multiple are supplied, elementRef takes priority over selector, then textQuery.",
  properties: {
    elementRef: { type: "string", description: "Short-lived elementRef returned by browser_snapshot." },
    selector: { type: "string", description: "CSS selector." },
    textQuery: { type: "string", description: "Substring of element innerText/textContent." }
  },
  anyOf: [
    { required: ["elementRef"] },
    { required: ["selector"] },
    { required: ["textQuery"] }
  ],
  additionalProperties: false
} as const;

export const toolDefinitions = [
  {
    name: "browser_list_installations",
    description: "List installed Chromium-based browsers and their profile roots.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "browser_list_running",
    description: "List running Chromium-based browsers and whether they are attachable.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "browser_connect",
    description: "Attach to a running Chromium-based browser with remote debugging enabled. Non-loopback hosts require MCP_BROWSER_ALLOW_REMOTE_ATTACH=1. When AMBIGUOUS_TARGET is returned, the details.candidates field lists each (browser, processId, port) — pass `browser` or `pickFirstAttachable: true` to disambiguate.",
    inputSchema: {
      type: "object",
      properties: {
        browser: browserKindProp,
        host: { type: "string", description: "Debugging host (default 127.0.0.1)." },
        port: { type: "number", description: "Explicit debugging port. If omitted, auto-detect from running processes." },
        pickFirstAttachable: { type: "boolean", description: "When multiple browsers match, pick the one with the lowest PID." }
      },
      additionalProperties: false
    }
  },
  {
    name: "browser_launch",
    description: "Launch a Chromium-based browser with an isolated or explicit profile path. executablePath must match an entry from browser_list_installations or MCP_BROWSER_ALLOWED_EXECUTABLES.",
    inputSchema: {
      type: "object",
      properties: {
        browser: browserKindProp,
        executablePath: { type: "string", description: "Optional path to a browser executable. Must be on the allowlist." },
        profileMode: { type: "string", enum: ["isolated", "profile-path"], default: "isolated", description: "Use a temporary profile or an explicit profile path." },
        profilePath: { type: "string", description: "Path to user-data-dir; only used when profileMode='profile-path'. Must live under MCP_BROWSER_ALLOWED_PROFILE_ROOTS (defaults to MCP_BROWSER_TEMP_DIR)." },
        startupUrl: { type: "string", format: "uri", description: "URL to open in the new browser window." },
        windowSize: {
          type: "object",
          description: "Initial window size in CSS pixels.",
          properties: {
            width: { type: "number", description: "Width in pixels." },
            height: { type: "number", description: "Height in pixels." }
          },
          required: ["width", "height"],
          additionalProperties: false
        }
      },
      required: ["browser"],
      additionalProperties: false
    }
  },
  {
    name: "browser_disconnect",
    description: "Disconnect and remove a session. Closes MCP-opened tabs and tears down isolated profile temp dirs.",
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_list_sessions",
    description: "List active MCP browser sessions.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }
  },
  {
    name: "browser_get_session",
    description: "Get a single active MCP browser session.",
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_list_managed_tabs",
    description: "List tabs tracked by MCP, including notes and whether MCP opened them.",
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_note_tab",
    description: "Add a note to a tracked tab.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: requiredTabIdProp,
        note: { type: "string", minLength: 1, description: "Note text (non-empty)." }
      },
      required: ["sessionId", "tabId", "note"],
      additionalProperties: false
    }
  },
  {
    name: "browser_list_tabs",
    description: "List page targets for a session.",
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_new_tab",
    description: "Create a new tab in a session.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        url: { type: "string", format: "uri", description: "Initial URL (default about:blank). Subject to SSRF guard." }
      },
      required: ["sessionId"],
      additionalProperties: false
    }
  },
  {
    name: "browser_activate_tab",
    description: "Activate a tab and make it the session default.",
    inputSchema: {
      type: "object",
      properties: { sessionId: sessionIdProp, tabId: requiredTabIdProp },
      required: ["sessionId", "tabId"],
      additionalProperties: false
    }
  },
  {
    name: "browser_close_tab",
    description: "Close a tab.",
    inputSchema: {
      type: "object",
      properties: { sessionId: sessionIdProp, tabId: requiredTabIdProp },
      required: ["sessionId", "tabId"],
      additionalProperties: false
    }
  },
  {
    name: "browser_navigate",
    description: "Navigate a tab to a URL. Subject to SSRF guard (private IPs / localhost / non-http schemes blocked unless MCP_BROWSER_ALLOW_PRIVATE_NETWORKS=1).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        url: { type: "string", format: "uri", description: "Target URL." },
        waitUntil: { type: "string", enum: ["domcontentloaded", "load"], default: "load", description: "Lifecycle event to wait for." },
        timeoutMs: timeoutMsProp
      },
      required: ["sessionId", "url"],
      additionalProperties: false
    }
  },
  {
    name: "browser_go_back",
    description: "Navigate back in history.",
    // U7: optional timeoutMs so callers can override the default-15s lifecycle wait.
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp, tabId: tabIdProp, timeoutMs: timeoutMsProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_go_forward",
    description: "Navigate forward in history.",
    // U7: optional timeoutMs so callers can override the default-15s lifecycle wait.
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp, tabId: tabIdProp, timeoutMs: timeoutMsProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_reload",
    description: "Reload the current page.",
    // U8: accept optional timeoutMs.
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp, tabId: tabIdProp, timeoutMs: timeoutMsProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_wait_for",
    description: "Wait for a selector, text, or URL fragment. At least one of selector/text/urlIncludes must be provided.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        selector: { type: "string", description: "CSS selector to wait for." },
        text: { type: "string", description: "Substring expected in document.body.innerText." },
        urlIncludes: { type: "string", description: "Substring expected in location.href." },
        timeoutMs: timeoutMsProp
      },
      required: ["sessionId"],
      anyOf: [
        { required: ["selector"] },
        { required: ["text"] },
        { required: ["urlIncludes"] }
      ],
      additionalProperties: false
    }
  },
  {
    name: "browser_snapshot",
    description: "Return a lightweight semantic page snapshot with short-lived elementRefs.",
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp, tabId: tabIdProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_get_text",
    // U6: clarify that omitting target returns whole-page text.
    description: "Get visible text for the page or a scoped selector. Omit `target` to get the full page text (document.body.innerText).",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        target: {
          type: "object",
          description: "Optional scope for text extraction.",
          properties: { selector: { type: "string", description: "CSS selector to scope to." } },
          additionalProperties: false
        },
        maxChars: { type: "number", description: "Cap on returned characters (default MCP_BROWSER_MAX_TEXT_CHARS)." }
      },
      required: ["sessionId"],
      additionalProperties: false
    }
  },
  {
    name: "browser_get_html",
    description: "Get scoped HTML for a selector.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        target: {
          type: "object",
          description: "Element scope.",
          properties: { selector: { type: "string", description: "CSS selector." } },
          required: ["selector"],
          additionalProperties: false
        },
        mode: { type: "string", enum: ["outerHTML", "innerHTML"], default: "outerHTML", description: "Whether to include the matched element itself." },
        maxChars: { type: "number", description: "Cap on returned characters (default MCP_BROWSER_MAX_HTML_CHARS)." }
      },
      required: ["sessionId", "target"],
      additionalProperties: false
    }
  },
  {
    name: "browser_eval",
    description: "Evaluate a JavaScript expression and return JSON-serializable output. Disabled by default; requires MCP_BROWSER_ALLOW_EVAL=1. Arbitrary JS execution; treat as RCE. Expressions are length-capped (MCP_BROWSER_MAX_EVAL_EXPRESSION_CHARS), import()/require()/Function() are rejected, and execution is bounded by MCP_BROWSER_DEFAULT_TIMEOUT_MS.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        // U1: bound the expression length up-front so the schema rejects empty / oversize input
        // before zod / FORBIDDEN_EVAL_PATTERNS even runs. maxLength matches the default
        // MCP_BROWSER_MAX_EVAL_EXPRESSION_CHARS cap.
        expression: { type: "string", minLength: 1, maxLength: 10240, description: "JavaScript expression evaluated in the tab's main frame." }
      },
      required: ["sessionId", "expression"],
      additionalProperties: false
    }
  },
  {
    name: "browser_click",
    description: "Click an element by elementRef, selector, or textQuery.",
    inputSchema: {
      type: "object",
      properties: { sessionId: sessionIdProp, tabId: tabIdProp, target: targetSchema },
      required: ["sessionId", "target"],
      additionalProperties: false
    }
  },
  {
    name: "browser_type",
    description: "Type into an element by elementRef, selector, or textQuery.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        target: targetSchema,
        text: { type: "string", description: "Text to type." },
        clearFirst: { type: "boolean", default: true, description: "Clear the existing value before typing." }
      },
      required: ["sessionId", "target", "text"],
      additionalProperties: false
    }
  },
  {
    name: "browser_press_key",
    description: "Dispatch a key press to the active tab.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        // U2: empty string was being accepted and would dispatch a no-op key event.
        key: { type: "string", minLength: 1, description: "Key name (Enter, Escape, ArrowDown, PageDown, ...) or a single character." }
      },
      required: ["sessionId", "key"],
      additionalProperties: false
    }
  },
  {
    name: "browser_scroll",
    description: "Scroll the current page by a delta.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        // U5: bound scroll deltas so an LLM with a wild tool-arg generator can't ask for
        // ±1e308-pixel scrolls (which silently noop or hang depending on the renderer).
        deltaX: { type: "number", minimum: -50000, maximum: 50000, default: 0, description: "Horizontal scroll delta in pixels (validated to ±50000 range)." },
        deltaY: { type: "number", minimum: -50000, maximum: 50000, default: 600, description: "Vertical scroll delta in pixels (validated to ±50000 range)." }
      },
      required: ["sessionId"],
      additionalProperties: false
    }
  },
  {
    name: "browser_take_screenshot",
    description: "Capture a PNG screenshot of the current tab. Returns the saved file path and a base64 image content block.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        nameHint: { type: "string", description: "Filename hint; sanitized to [A-Za-z0-9_-]." }
      },
      required: ["sessionId"],
      additionalProperties: false
    }
  },
  {
    name: "browser_pdf_open",
    description: "Open a PDF URL in the current tab by default, or a new tab when requested. Subject to SSRF guard.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        url: { type: "string", format: "uri", description: "URL of the PDF." },
        newTab: { type: "boolean", default: false, description: "Open in a new tab instead of reusing the active one." },
        waitUntil: { type: "string", enum: ["domcontentloaded", "load"], default: "load", description: "Lifecycle event to wait for." },
        timeoutMs: timeoutMsProp,
        note: { type: "string", description: "Optional note to attach to the resulting tab." }
      },
      required: ["sessionId", "url"],
      additionalProperties: false
    }
  },
  {
    name: "browser_pdf_viewer_state",
    description: "Inspect the current PDF viewer state such as page number and page count.",
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp, tabId: tabIdProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_pdf_next_page",
    description: "Advance the current PDF viewer by one page.",
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp, tabId: tabIdProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_pdf_prev_page",
    description: "Move the current PDF viewer back by one page.",
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp, tabId: tabIdProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_pdf_extract",
    description: "Extract text from a PDF file path, URL, or the current tab if it points at a PDF. filePath must end with .pdf and live under MCP_BROWSER_ALLOWED_READ_ROOTS (defaults to downloads + temp). url is subject to the SSRF guard.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        filePath: { type: "string", description: "Local PDF path; restricted to allowed read roots." },
        url: { type: "string", format: "uri", description: "Remote PDF URL." },
        pages: {
          type: "array",
          description: "1-based page numbers to extract; default = all pages.",
          items: { type: "integer", minimum: 1 }
        },
        maxCharsPerPage: { type: "number", description: "Cap on text per page (default 4000)." }
      },
      // U3: at least one of filePath / url / sessionId must be supplied — otherwise
      // there's no PDF to extract and the call would fail at the runtime guard anyway.
      anyOf: [
        { required: ["filePath"] },
        { required: ["url"] },
        { required: ["sessionId"] }
      ],
      additionalProperties: false
    }
  },
  {
    name: "browser_get_cookies",
    description: "Get cookies for the current tab context.",
    inputSchema: { type: "object", properties: { sessionId: sessionIdProp, tabId: tabIdProp }, required: ["sessionId"], additionalProperties: false }
  },
  {
    name: "browser_set_cookies",
    description: "Set cookies for the current tab context. In attach mode, cookie domains must match the active tab's eTLD+1 unless MCP_BROWSER_ALLOW_CROSS_ORIGIN_COOKIES=1.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        cookies: { type: "array", description: "Cookies to set.", items: cookieSchema }
      },
      required: ["sessionId", "cookies"],
      additionalProperties: false
    }
  },
  {
    name: "browser_storage_get",
    description: "Get localStorage or sessionStorage.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        kind: { type: "string", enum: ["localStorage", "sessionStorage"], description: "Storage area to read." }
      },
      required: ["sessionId", "kind"],
      additionalProperties: false
    }
  },
  {
    name: "browser_storage_set",
    description: "Set localStorage or sessionStorage entries.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        kind: { type: "string", enum: ["localStorage", "sessionStorage"], description: "Storage area to write." },
        entries: {
          type: "object",
          description: "Key/value entries to set. Values must be strings.",
          additionalProperties: { type: "string" }
        }
      },
      required: ["sessionId", "kind", "entries"],
      additionalProperties: false
    }
  },
  // U11: hover (CDP Input.dispatchMouseEvent mouseMoved at element center).
  {
    name: "browser_hover",
    description: "Hover the mouse pointer over an element by elementRef, selector, or textQuery (dispatches a CDP mouseMoved at the element center).",
    inputSchema: {
      type: "object",
      properties: { sessionId: sessionIdProp, tabId: tabIdProp, target: targetSchema },
      required: ["sessionId", "target"],
      additionalProperties: false
    }
  },
  // U12: select_option for <select> elements.
  {
    name: "browser_select_option",
    description: "Select one or more options on a <select> element by value or label. Fires input + change events.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        target: targetSchema,
        values: {
          type: "array",
          description: "Values to select; falls back to label match if no value matches. For single-select, only the first match is honored.",
          items: { type: "string" },
          minItems: 1
        }
      },
      required: ["sessionId", "target", "values"],
      additionalProperties: false
    }
  },
  // U13: set_checked for checkbox / radio inputs.
  {
    name: "browser_set_checked",
    description: "Set a checkbox / radio's checked state. Fires input + change events only if the state actually changes.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        target: targetSchema,
        checked: { type: "boolean", description: "Desired checked state." }
      },
      required: ["sessionId", "target", "checked"],
      additionalProperties: false
    }
  },
  // U14: wait_for_network_idle.
  {
    name: "browser_wait_for_network_idle",
    description: "Wait until the page has zero in-flight network requests for a sustained idle window. Useful right after navigation when load events fire before XHR/fetch settle.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: sessionIdProp,
        tabId: tabIdProp,
        idleMs: { type: "number", minimum: 1, default: 500, description: "Consecutive ms of zero in-flight requests required (default 500)." },
        timeoutMs: timeoutMsProp
      },
      required: ["sessionId"],
      additionalProperties: false
    }
  }
] as const;
