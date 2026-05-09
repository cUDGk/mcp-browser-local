import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { ToolError } from "../core/errors.js";
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

type TcpConnectionRow = {
  LocalAddress?: string;
  LocalPort?: number;
  OwningProcess?: number;
  State?: string | number;
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
    const attachable = debuggingPort !== undefined && Number.isFinite(debuggingPort);

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

  return parseJsonRows<ProcessRow>(stdout);
}

// B20: prefer Get-NetTCPConnection (structured) over netstat parsing.
async function listListeningPortsByProcess(processIds: number[]): Promise<Map<number, number[]>> {
  const pidSet = new Set(processIds);
  const portsByProcess = new Map<number, number[]>();

  const psScript = [
    "$ErrorActionPreference='Stop';",
    "Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue",
    "| Select-Object LocalAddress,LocalPort,OwningProcess,State",
    "| ConvertTo-Json -Depth 3"
  ].join(" ");

  let rows: TcpConnectionRow[] = [];
  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-Command", psScript], {
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 4
    });
    rows = parseJsonRows<TcpConnectionRow>(stdout);
  } catch {
    // Fallback to netstat if Get-NetTCPConnection fails (e.g. Server Core, restricted env).
    return parsePortsFromNetstat(pidSet);
  }

  for (const row of rows) {
    if (row.OwningProcess === undefined || row.LocalPort === undefined) {
      continue;
    }
    if (!pidSet.has(row.OwningProcess)) {
      continue;
    }
    // Reject out-of-range port values from PowerShell output.
    if (!validPort(row.LocalPort)) {
      continue;
    }
    const ports = portsByProcess.get(row.OwningProcess) ?? [];
    if (!ports.includes(row.LocalPort)) {
      ports.push(row.LocalPort);
      portsByProcess.set(row.OwningProcess, ports);
    }
  }

  return portsByProcess;
}

async function parsePortsFromNetstat(pidSet: Set<number>): Promise<Map<number, number[]>> {
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

    const port = localAddress ? parsePort(localAddress) : undefined;
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
  if (ipv6Match && ipv6Match[1]) {
    return validPort(Number.parseInt(ipv6Match[1], 10));
  }

  const index = localAddress.lastIndexOf(":");
  if (index < 0) {
    return undefined;
  }

  return validPort(Number.parseInt(localAddress.slice(index + 1), 10));
}

/** Return the port only if it is a valid TCP port number (1-65535). */
function validPort(value: number): number | undefined {
  return Number.isInteger(value) && value >= 1 && value <= 65535 ? value : undefined;
}

// B19: don't crash if PowerShell returns malformed JSON.
function parseJsonRows<T>(stdout: string): T[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new ToolError("INTERNAL_ERROR", "Failed to parse PowerShell JSON output", false, {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  if (Array.isArray(parsed)) return parsed as T[];
  if (parsed && typeof parsed === "object") return [parsed as T];
  return [];
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
