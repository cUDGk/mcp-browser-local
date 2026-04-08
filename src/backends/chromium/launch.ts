import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { ToolError } from "../../core/errors.js";
import type { BrowserEndpoint } from "../../types/session.js";

export type LaunchOptions = {
  executablePath: string;
  profilePath?: string;
  startupUrl?: string;
  windowSize?: {
    width: number;
    height: number;
  };
  tempRoot: string;
};

export async function launchChromium(options: LaunchOptions): Promise<{
  endpoint: BrowserEndpoint;
  process: ReturnType<typeof spawn>;
  profilePath: string;
}> {
  const port = await getFreePort();
  const profilePath = options.profilePath ?? path.join(options.tempRoot, `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await fs.mkdir(profilePath, { recursive: true });

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profilePath}`,
    "--no-first-run",
    "--no-default-browser-check"
  ];

  if (options.windowSize) {
    args.push(`--window-size=${options.windowSize.width},${options.windowSize.height}`);
  }

  args.push(options.startupUrl ?? "about:blank");

  const child = spawn(options.executablePath, args, {
    detached: false,
    windowsHide: false,
    stdio: "ignore"
  });

  const endpoint = await waitForPort(port);
  return {
    endpoint,
    process: child,
    profilePath
  };
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new ToolError("LAUNCH_FAILED", "Failed to allocate a debugging port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
    server.on("error", reject);
  });
}

async function waitForPort(port: number, timeoutMs = 10000): Promise<BrowserEndpoint> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", () => {
          socket.end();
          resolve();
        });
        socket.once("error", reject);
      });
      return { host: "127.0.0.1", port };
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new ToolError("LAUNCH_FAILED", `Chromium did not expose a debugging port within ${timeoutMs}ms`);
}
