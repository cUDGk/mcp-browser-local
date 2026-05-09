# mcp-browser-local

Local Chromium MCP server for `Codex` and `Claude Code`.

This server is designed for desktop browser use, not just headless automation. It supports:

- attach to a running `Brave`, `Chrome`, `Edge`, or `Chromium` instance when remote debugging is enabled
- launch an isolated or explicit profile-path browser session
- lightweight semantic page snapshots instead of full HTML dumps
- basic page automation: tabs, navigation, click, type, keypress, scroll, hover, select_option, set_checked, wait_for_network_idle, scoped text/HTML, screenshots
- PDF extraction from local files, URLs, or the current tab
- PDF viewer helpers for open, state inspection, and next/previous page navigation
- managed-tab tracking with notes and automatic cleanup for tabs opened by MCP

## Safety model

- `default profile` is `attach only`
- `launch + browser-default` is intentionally not supported
- attach mode only works when the browser was started with `--remote-debugging-port=<port>`
- `browser_eval` is disabled by default
- file upload is not yet implemented (`MCP_BROWSER_ALLOW_FILE_UPLOAD` / `MCP_BROWSER_ALLOWED_UPLOAD_ROOTS` are reserved for future use)

## Install

```bash
npm install
npm run build
```

## Run

```bash
node dist/index.js
```

## Development

```bash
npm run dev
npm run typecheck
```

## Browser setup

### Brave

```powershell
"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" --remote-debugging-port=9222
```

### Chrome

```powershell
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

## Environment variables

- `MCP_BROWSER_LOG_LEVEL` — log level (`debug` / `info` / `warn` / `error`)
- `MCP_BROWSER_ALLOW_ATTACH` — allow attach mode (default `1`, set `0` to disable)
- `MCP_BROWSER_ALLOW_LAUNCH` — allow launch mode (default `1`, set `0` to disable)
- `MCP_BROWSER_ALLOW_EVAL` — enable `browser_eval` (default `0`)
- `MCP_BROWSER_ALLOW_PRIVATE_NETWORKS` — allow navigate / PDF fetch to localhost / private IPs (default `0`)
- `MCP_BROWSER_ALLOW_REMOTE_ATTACH` — allow `browser_connect` to non-loopback hosts (default `0`)
- `MCP_BROWSER_ALLOW_CROSS_ORIGIN_COOKIES` — drop the cookie domain restriction in attach mode (default `0`)
- `MCP_BROWSER_ALLOWED_EXECUTABLES` — `browser_launch` `executablePath` allowlist (path-delimited; `;` on Windows, `:` on POSIX — `path.delimiter`)
- `MCP_BROWSER_ALLOWED_PROFILE_ROOTS` — allowed roots for `profileMode='profile-path'` (default: temp dir)
- `MCP_BROWSER_ALLOWED_READ_ROOTS` — `browser_pdf_extract` filePath allowed roots (default: downloads + temp)
- `MCP_BROWSER_ALLOW_FILE_UPLOAD` — reserved for future file-upload support (currently unimplemented)
- `MCP_BROWSER_ALLOWED_UPLOAD_ROOTS` — reserved (paired with the above)
- `MCP_BROWSER_DOWNLOAD_DIR` — download directory
- `MCP_BROWSER_SCREENSHOT_DIR` — screenshot directory (default `~/.mcp-browser-local/screenshots`)
- `MCP_BROWSER_TEMP_DIR` — temp directory
- `MCP_BROWSER_DEFAULT_TIMEOUT_MS` — default per-command timeout (default `15000`)
- `MCP_BROWSER_MAX_SNAPSHOT_ELEMENTS` — `browser_snapshot` element cap (default `80`)
- `MCP_BROWSER_MAX_TEXT_CHARS` — `browser_get_text` char cap (default `12000`)
- `MCP_BROWSER_MAX_HTML_CHARS` — `browser_get_html` char cap (default `20000`)
- `MCP_BROWSER_MAX_EVAL_RESULT_CHARS` — `browser_eval` result size cap (default `4000`)
- `MCP_BROWSER_MAX_EVAL_RESULT_ITEMS` — `browser_eval` result item cap (default `100`)
- `MCP_BROWSER_MAX_EVAL_EXPRESSION_CHARS` — `browser_eval` expression length cap (default `10240`)
- `MCP_BROWSER_MAX_ELEMENT_REFS` — global elementRef cap (default `5000`, FIFO eviction)
- `MCP_BROWSER_MAX_TABS_PER_SESSION` — tabs per session cap (default `64`)
- `MCP_BROWSER_MAX_SESSIONS` — concurrent session cap (default `16`)
- `MCP_BROWSER_MAX_NOTES_PER_TAB` — notes per tab cap (default `200`)
- `MCP_BROWSER_MAX_PDF_BYTES` — PDF byte cap (default `200MiB`)
- `MCP_BROWSER_MAX_PDF_PAGES` — PDF page cap (default `200`)

## Codex configuration example

```json
{
  "mcpServers": {
    "browser-local": {
      "command": "node",
      "args": ["C:\\Users\\user\\mcp-browser-local\\dist\\index.js"]
    }
  }
}
```

## Claude Code configuration example

```json
{
  "mcpServers": {
    "browser-local": {
      "command": "node",
      "args": ["C:\\Users\\user\\mcp-browser-local\\dist\\index.js"]
    }
  }
}
```

## Notes

- In attach mode, download location is managed by the existing browser configuration, not by this MCP.
- `browser_snapshot` is the intended first read tool. It returns semantic structure plus short-lived `elementRef` values.
- `elementRef` values are valid for the same document and may become stale after navigation or major rerenders.
- The default PDF workflow is: `browser_pdf_open` -> `browser_pdf_viewer_state` -> `browser_pdf_next_page` / `browser_pdf_prev_page` -> `browser_pdf_extract`.
- `browser_pdf_open` reuses the current tab by default. Pass `newTab: true` only when isolation is worth the extra tab.
- Tabs opened by MCP are tracked and closed automatically on `browser_disconnect`.
- Use `browser_list_managed_tabs` and `browser_note_tab` to inspect or annotate the tabs MCP touched.

## Changelog

### 0.1.2 (R4)

- Security: NAT64 `64:ff9b::/96` prefix decoded and checked against private-IPv4 rules (S1).
- Security: reserved TLDs `.test`, `.example`, `.invalid` added to blocklist (S2).
- Security: PDF redirect loop now uses per-hop `AbortController` derived from a total deadline instead of a shared signal (S3).
- Security: `scrollPage` numeric injection guard via `Number()` coercion (S4).
- Security: `browser_set_cookies` eTLD+1 check now applies to `url`-only cookies as well as `domain` cookies (S5).
- Security: `evaluateExpression` normalization extended with `//` comment stripping and `\xXX` hex decode (S6).
- Bug: `goBack` / `goForward` lifecycle listener leak fixed — `wait.cancel()` now called unconditionally in `finally` (B1).
- Bug: `waitForLifecycle` fallback no longer registers a duplicate listener on exception; checks `typeof emitter.on === "function"` (B2).
- Bug: `evaluateExpression` inner `normalized` variable renamed to `resultJson` to avoid shadowing (B3).
- Bug: `browser_pdf_open` with `newTab: true` now awaits navigation before reading PDF viewer state (B4).
- Bug: `browser_disconnect` `markTabClosed` moved inside the success branch of `waitForTabToDisappear` (B5).
- Bug: `setActiveTab` cap check now runs before `activeTabId` is updated (B6).
- Bug: `resolveByText` sets `data-mcp-resolved` attribute and returns an attribute selector for precise element disambiguation (B7).
- UX: `browser_set_checked` description clarifies events fire only when state changes (U1).
- UX: `browser_wait_for_network_idle` `idleMs` schema adds `minimum: 1` (U2).
- UX: `browser_scroll` delta description changed from "clamped" to "validated" (U3).
- UX: `browser_select_option` `values` description clarifies value-priority fallback to label (U4).
- UX: `browser_reload` accepts optional `timeoutMs` parameter (U8).
- UX: `browser_eval` Zod schema enforces `min(1)` / `max(maxEvalExpressionChars)` (U9).
- Docs: feature bullet updated with hover / select_option / set_checked / wait_for_network_idle (U5).
- Docs: `MCP_BROWSER_ALLOWED_EXECUTABLES` clarified with `path.delimiter` note (U7).

### 0.1.1

- Tolerate object / array arguments that Claude Code and similar LLM clients send as JSON strings. Tools now auto-parse stringified payloads before zod validation instead of rejecting them.
- Affected tools: `browser_launch` (windowSize), `browser_get_text` / `browser_get_html` / `browser_click` / `browser_type` (target), `browser_set_cookies` (cookies), `browser_storage_set` (entries), `browser_pdf_extract` (pages).
- R3 added: `browser_hover`, `browser_select_option`, `browser_set_checked`, `browser_wait_for_network_idle`; coercion extended to `browser_select_option` (values), `browser_hover` / `browser_set_checked` (target).
