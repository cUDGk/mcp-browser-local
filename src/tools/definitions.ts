export const toolDefinitions = [
  { name: "browser_list_installations", description: "List installed Chromium-based browsers and their profile roots.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "browser_list_running", description: "List running Chromium-based browsers and whether they are attachable.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  {
    name: "browser_connect",
    description: "Attach to a running Chromium-based browser with remote debugging enabled.",
    inputSchema: {
      type: "object",
      properties: {
        browser: { type: "string", enum: ["brave", "chrome", "edge", "chromium"] },
        host: { type: "string" },
        port: { type: "number" },
        pickFirstAttachable: { type: "boolean" }
      },
      additionalProperties: false
    }
  },
  {
    name: "browser_launch",
    description: "Launch a Chromium-based browser with an isolated or explicit profile path.",
    inputSchema: {
      type: "object",
      properties: {
        browser: { type: "string", enum: ["brave", "chrome", "edge", "chromium"] },
        executablePath: { type: "string" },
        profileMode: { type: "string", enum: ["isolated", "profile-path"] },
        profilePath: { type: "string" },
        startupUrl: { type: "string" },
        windowSize: {
          type: "object",
          properties: { width: { type: "number" }, height: { type: "number" } },
          required: ["width", "height"],
          additionalProperties: false
        }
      },
      required: ["browser"],
      additionalProperties: false
    }
  },
  { name: "browser_disconnect", description: "Disconnect and remove a session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_list_sessions", description: "List active MCP browser sessions.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "browser_get_session", description: "Get a single active MCP browser session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_list_managed_tabs", description: "List tabs tracked by MCP, including notes and whether MCP opened them.", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_note_tab", description: "Add a note to a tracked tab.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, note: { type: "string" } }, required: ["sessionId", "tabId", "note"], additionalProperties: false } },
  { name: "browser_list_tabs", description: "List page targets for a session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_new_tab", description: "Create a new tab in a session.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, url: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_activate_tab", description: "Activate a tab and make it the session default.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" } }, required: ["sessionId", "tabId"], additionalProperties: false } },
  { name: "browser_close_tab", description: "Close a tab.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" } }, required: ["sessionId", "tabId"], additionalProperties: false } },
  { name: "browser_navigate", description: "Navigate a tab to a URL.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, url: { type: "string" }, waitUntil: { type: "string", enum: ["domcontentloaded", "load"] }, timeoutMs: { type: "number" } }, required: ["sessionId", "url"], additionalProperties: false } },
  { name: "browser_go_back", description: "Navigate back in history.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_go_forward", description: "Navigate forward in history.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_reload", description: "Reload the current page.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_wait_for", description: "Wait for a selector, text, or URL fragment.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, selector: { type: "string" }, text: { type: "string" }, urlIncludes: { type: "string" }, timeoutMs: { type: "number" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_snapshot", description: "Return a lightweight semantic page snapshot.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_get_text", description: "Get visible text for the page or a scoped selector.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, target: { type: "object", properties: { selector: { type: "string" } }, additionalProperties: false }, maxChars: { type: "number" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_get_html", description: "Get scoped HTML for a selector.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, target: { type: "object", properties: { selector: { type: "string" } }, required: ["selector"], additionalProperties: false }, mode: { type: "string", enum: ["outerHTML", "innerHTML"] }, maxChars: { type: "number" } }, required: ["sessionId", "target"], additionalProperties: false } },
  { name: "browser_eval", description: "Evaluate a small JavaScript expression and return JSON-serializable output.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, expression: { type: "string" } }, required: ["sessionId", "expression"], additionalProperties: false } },
  { name: "browser_click", description: "Click an element by elementRef, selector, or textQuery.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, target: { type: "object", properties: { elementRef: { type: "string" }, selector: { type: "string" }, textQuery: { type: "string" } }, additionalProperties: false } }, required: ["sessionId", "target"], additionalProperties: false } },
  { name: "browser_type", description: "Type into an element by elementRef, selector, or textQuery.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, target: { type: "object", properties: { elementRef: { type: "string" }, selector: { type: "string" }, textQuery: { type: "string" } }, additionalProperties: false }, text: { type: "string" }, clearFirst: { type: "boolean" } }, required: ["sessionId", "target", "text"], additionalProperties: false } },
  { name: "browser_press_key", description: "Dispatch a key press to the active tab.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, key: { type: "string" } }, required: ["sessionId", "key"], additionalProperties: false } },
  { name: "browser_scroll", description: "Scroll the current page by a delta.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, deltaX: { type: "number" }, deltaY: { type: "number" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_take_screenshot", description: "Capture a PNG screenshot of the current tab.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, nameHint: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_pdf_open", description: "Open a PDF URL in the current tab by default, or a new tab when requested.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, url: { type: "string" }, newTab: { type: "boolean" }, waitUntil: { type: "string", enum: ["domcontentloaded", "load"] }, timeoutMs: { type: "number" }, note: { type: "string" } }, required: ["sessionId", "url"], additionalProperties: false } },
  { name: "browser_pdf_viewer_state", description: "Inspect the current PDF viewer state such as page number and page count.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_pdf_next_page", description: "Advance the current PDF viewer by one page.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_pdf_prev_page", description: "Move the current PDF viewer back by one page.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_pdf_extract", description: "Extract text from a PDF file path, URL, or the current tab if it points at a PDF.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, filePath: { type: "string" }, url: { type: "string" }, pages: { type: "array", items: { type: "number" } }, maxCharsPerPage: { type: "number" } }, additionalProperties: false } },
  { name: "browser_get_cookies", description: "Get cookies for the current tab context.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" } }, required: ["sessionId"], additionalProperties: false } },
  { name: "browser_set_cookies", description: "Set cookies for the current tab context.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, cookies: { type: "array", items: { type: "object" } } }, required: ["sessionId", "cookies"], additionalProperties: false } },
  { name: "browser_storage_get", description: "Get localStorage or sessionStorage.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, kind: { type: "string", enum: ["localStorage", "sessionStorage"] } }, required: ["sessionId", "kind"], additionalProperties: false } },
  { name: "browser_storage_set", description: "Set localStorage or sessionStorage entries.", inputSchema: { type: "object", properties: { sessionId: { type: "string" }, tabId: { type: "string" }, kind: { type: "string", enum: ["localStorage", "sessionStorage"] }, entries: { type: "object" } }, required: ["sessionId", "kind", "entries"], additionalProperties: false } }
] as const;
