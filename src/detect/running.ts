import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { RunningBrowser } from "../types/session.js";
import type { BrowserKind } from "../types/common.js";

const execFileAsync = promisify(execFile);

const knownExecutables = new Map<string, BrowserKind>([
  ["brave.exe", "brave"],
  ["chrome.exe", "chrome"],
  ["msedge.exe", "edge"],
  ["chromium.exe", "chromium"]
]);

type ProcessRow = {
  Id: number;
  ProcessName?: string;
  Path?: string;
};

type ListeningPortRow = {
  LocalAddress?: string;
  OwningProcess?: number;
};

export async function listRunningBrowsers(): Promise<RunningBrowser[]> {
  const processes = await listBrowserProcesses();
  if (processes.length === 0) {
    return [];
  }

  const portsByProcessId = await listListeningPortsByProcess(processes.map((item) => item.Id));
  const debuggingPorts = await detectDebuggingPorts(portsByProcessId);

  return processes.flatMap((row) => {
    const executablePath = row.Path ?? row.ProcessName;
    if (!executablePath) {
      return [];
    }

    const executableName = path.basename(executablePath).toLowerCase();
    const browser = knownExecutables.get(executableName.endsWith(".exe") ? executableName : `${executableName}.exe`);
    if (!browser) {
      return [];
    }

    const debuggingPort = debuggingPorts.get(row.Id);
    const attachable = Number.isFinite(debuggingPort);

    return [{
      processId: row.Id,
      browser,
      executablePath,
      commandLine: undefined,
      attachable,
      reason: attachable ? "remote-debugging-port detected" : "remote debugging not enabled",
      debuggingPort
    } satisfies RunningBrowser];
  });
}

async function listBrowserProcesses(): Promise<ProcessRow[]> {
  const psScript = [
    "$ErrorActionPreference='Stop';",
    "$names = @(\"brave\", \"chrome\", \"msedge\", \"chromium\");",
    "Get-Process | Where-Object { $names -contains $_.ProcessName }",
    "| Select-Object Id,ProcessName,Path",
    "| ConvertTo-Json -Depth 3"
  ].join(" ");

  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", psScript], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 2
  });

  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function listListeningPortsByProcess(processIds: number[]): Promise<Map<number, number[]>> {
  const pidSet = new Set(processIds);
  const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 4
  });

  const portsByProcess = new Map<number, number[]>();

  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.includes("LISTENING")) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) {
      continue;
    }

    const localAddress = parts[1];
    const state = parts[3];
    const owningProcess = Number.parseInt(parts[4] ?? "", 10);
    if (state !== "LISTENING" || !pidSet.has(owningProcess)) {
      continue;
    }

    const port = parsePort(localAddress);
    if (!port) {
      continue;
    }

    const ports = portsByProcess.get(owningProcess) ?? [];
    if (!ports.includes(port)) {
      ports.push(port);
      portsByProcess.set(owningProcess, ports);
    }
  }

  return portsByProcess;
}

function parsePort(localAddress: string): number | undefined {
  const ipv6Match = localAddress.match(/\]:([0-9]+)$/);
  if (ipv6Match) {
    return Number.parseInt(ipv6Match[1] ?? "", 10);
  }

  const index = localAddress.lastIndexOf(":");
  if (index < 0) {
    return undefined;
  }

  const value = Number.parseInt(localAddress.slice(index + 1), 10);
  return Number.isFinite(value) ? value : undefined;
}

async function detectDebuggingPorts(portsByProcessId: Map<number, number[]>): Promise<Map<number, number>> {
  const detected = new Map<number, number>();

  for (const [processId, ports] of portsByProcessId) {
    for (const port of ports) {
      if (await isDebuggingEndpoint(port)) {
        detected.set(processId, port);
        break;
      }
    }
  }

  return detected;
}

async function isDebuggingEndpoint(port: number): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 500);

  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: controller.signal });
    if (!response.ok) {
      return false;
    }

    const data = await response.json() as { webSocketDebuggerUrl?: unknown };
    return typeof data.webSocketDebuggerUrl === "string";
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

