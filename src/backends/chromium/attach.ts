import CDP from "chrome-remote-interface";
import { ToolError } from "../../core/errors.js";
import type { BrowserEndpoint, RunningBrowser } from "../../types/session.js";

export async function detectEndpointFromRunningBrowser(running: RunningBrowser): Promise<BrowserEndpoint> {
  if (!running.debuggingPort) {
    throw new ToolError("BROWSER_NOT_ATTACHABLE", `${running.browser} is not running with remote debugging enabled`);
  }

  try {
    const version = await CDP.Version({ host: "127.0.0.1", port: running.debuggingPort });
    return {
      host: "127.0.0.1",
      port: running.debuggingPort,
      browserWSEndpoint: version.webSocketDebuggerUrl
    };
  } catch (error) {
    throw new ToolError("ATTACH_FAILED", `Could not connect to debugging endpoint on port ${running.debuggingPort}`, true, {
      browser: running.browser,
      port: running.debuggingPort,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function detectEndpointFromPort(port: number, host = "127.0.0.1"): Promise<BrowserEndpoint> {
  try {
    const version = await CDP.Version({ host, port });
    return {
      host,
      port,
      browserWSEndpoint: version.webSocketDebuggerUrl
    };
  } catch (error) {
    throw new ToolError("DEBUGGING_ENDPOINT_NOT_FOUND", `No Chromium debugging endpoint was available at ${host}:${port}`, true, {
      host,
      port,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}
