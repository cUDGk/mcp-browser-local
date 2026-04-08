# mcp-browser-local

Local Chromium MCP server for `Codex` and `Claude Code`.

This server is designed for desktop browser use, not just headless automation. It supports:

- attach to a running `Brave`, `Chrome`, `Edge`, or `Chromium` instance when remote debugging is enabled
- launch an isolated or explicit profile-path browser session
- lightweight semantic page snapshots instead of full HTML dumps
- basic page automation: tabs, navigation, click, type, keypress, scroll, scoped text/HTML, screenshots
- PDF extraction from local files, URLs, or the current tab
- PDF viewer helpers for open, state inspection, and next/previous page navigation
- managed-tab tracking with notes and automatic cleanup for tabs opened by MCP

## Safety model

- `default profile` is `attach only`
- `launch + browser-default` is intentionally not supported
- attach mode only works when the browser was started with `--remote-debugging-port=<port>`
- `browser_eval` is disabled by default
- file upload is disabled by default

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

- `MCP_BROWSER_LOG_LEVEL`
- `MCP_BROWSER_ALLOW_ATTACH`
- `MCP_BROWSER_ALLOW_LAUNCH`
- `MCP_BROWSER_ALLOW_EVAL`
- `MCP_BROWSER_ALLOW_FILE_UPLOAD`
- `MCP_BROWSER_ALLOWED_UPLOAD_ROOTS`
- `MCP_BROWSER_DOWNLOAD_DIR`
- `MCP_BROWSER_SCREENSHOT_DIR`
- `MCP_BROWSER_TEMP_DIR`

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
