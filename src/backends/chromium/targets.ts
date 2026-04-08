import CDP from "chrome-remote-interface";
import { ToolError } from "../../core/errors.js";
import type { BrowserEndpoint, BrowserTargetSummary } from "../../types/session.js";

export async function listTargets(endpoint: BrowserEndpoint): Promise<BrowserTargetSummary[]> {
  const targets = await CDP.List({ host: endpoint.host, port: endpoint.port });
  return targets
    .filter((target) => target.type === "page")
    .map((target) => ({
      tabId: target.id,
      title: target.title,
      url: target.url,
      type: target.type,
      active: target.type === "page"
    }));
}

export async function newTab(endpoint: BrowserEndpoint, url = "about:blank"): Promise<BrowserTargetSummary> {
  const target = await CDP.New({ host: endpoint.host, port: endpoint.port, url });
  return {
    tabId: target.id,
    title: target.title,
    url: target.url,
    type: target.type,
    active: true
  };
}

export async function activateTab(endpoint: BrowserEndpoint, tabId: string): Promise<void> {
  try {
    await CDP.Activate({ host: endpoint.host, port: endpoint.port, id: tabId });
  } catch (error) {
    throw new ToolError("TAB_NOT_FOUND", `Tab ${tabId} could not be activated`, false, {
      tabId,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function closeTab(endpoint: BrowserEndpoint, tabId: string): Promise<void> {
  try {
    await CDP.Close({ host: endpoint.host, port: endpoint.port, id: tabId });
  } catch (error) {
    throw new ToolError("TAB_NOT_FOUND", `Tab ${tabId} could not be closed`, false, {
      tabId,
      cause: error instanceof Error ? error.message : String(error)
    });
  }
}
