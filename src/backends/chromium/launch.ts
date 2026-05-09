import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
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
  process: ChildProcess;
  profilePath: string;
}> {
  const port = await getFreePort();
  // S13: cryptographic random suffix instead of Math.random.
  const profilePath = options.profilePath ?? path.join(options.tempRoot, `profile-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`);
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

  // S7: use `--` to ensure the URL isn't parsed as a flag.
  args.push("--", options.startupUrl ?? "about:blank");

  const child = spawn(options.executablePath, args, {
    detached: false,
    windowsHide: false,
    stdio: "ignore"
  });

  // B2: kill the child if waitForPort fails so we don't leak a zombie browser.
  try {
    const endpoint = await waitForPort(port);
    return {
      endpoint,
      process: child,
      profilePath
    };
  } catch (error) {
    try {
      if (!child.killed) child.kill("SIGKILL");
    } catch {
      // best-effort cleanup
    }
    throw error;
  }
}

async function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    let settled = false;
    // B9: any error path must reject() exactly once. Previously a synchronous throw
    // from server.close() would skip reject(), and the error variant wrapped reject
    // in `if (err)` inside the close callback — both paths could hang the caller.
    const fail = (err: Error) => {
      if (settled) return;
      settled = true;
      try {
        server.close(() => reject(err));
      } catch {
        reject(err);
      }
    };
    // B3: handle errors before/after listen.
    server.on("error", (err) => {
      fail(new ToolError("LAUNCH_FAILED", `Failed to allocate a debugging port: ${err.message}`));
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        fail(new ToolError("LAUNCH_FAILED", "Failed to allocate a debugging port"));
        return;
      }
      const { port } = address;
      server.close((err) => {
        if (settled) return;
        settled = true;
        if (err) reject(new ToolError("LAUNCH_FAILED", `Failed to allocate a debugging port: ${err.message}`));
        else resolve(port);
      });
    });
  });
}

async function waitForPort(port: number, timeoutMs = 10000): Promise<BrowserEndpoint> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const ok = await tryConnect(port);
      if (ok) {
        return { host: "127.0.0.1", port };
      }
    } catch {
      // ignore and retry
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw new ToolError("LAUNCH_FAILED", `Chromium did not expose a debugging port within ${timeoutMs}ms`);
}

// B4: ensure socket.destroy() runs on error to avoid leaking handles.
function tryConnect(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ port, host: "127.0.0.1" });
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
    socket.setTimeout(2000);
  });
}
