import CDP from "chrome-remote-interface";
import type { BrowserEndpoint } from "../../types/session.js";

export type BrowserClient = Awaited<ReturnType<typeof CDP>>;
export type TabClient = Awaited<ReturnType<typeof CDP>>;

export async function createBrowserClient(endpoint: BrowserEndpoint): Promise<BrowserClient> {
  return CDP({
    host: endpoint.host,
    port: endpoint.port
  });
}

export async function createTabClient(endpoint: BrowserEndpoint, target: string): Promise<TabClient> {
  return CDP({
    host: endpoint.host,
    port: endpoint.port,
    target
  });
}
