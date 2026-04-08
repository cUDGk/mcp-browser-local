import fs from "node:fs/promises";
import { listRunningBrowsers } from "./running.js";
import { windowsBrowserConfigs } from "./windows-paths.js";
import type { BrowserInstallation } from "../types/session.js";

export async function listInstallations(): Promise<BrowserInstallation[]> {
  const running = await listRunningBrowsers();
  const installs: BrowserInstallation[] = [];

  for (const config of windowsBrowserConfigs) {
    const executablePath = await firstExisting(config.candidates);
    if (!executablePath) {
      continue;
    }

    installs.push({
      browser: config.browser,
      executablePath,
      channel: config.channel,
      detectedProfileRoots: config.profileRoots,
      runningProcesses: running.filter((item) => item.browser === config.browser).map((item) => item.processId),
      attachCandidates: running.filter((item) => item.browser === config.browser && item.attachable).map((item) => item.processId)
    });
  }

  return installs;
}

async function firstExisting(candidates: string[]): Promise<string | undefined> {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {}
  }

  return undefined;
}
