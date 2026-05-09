import fs from "node:fs/promises";
import path from "node:path";
import { isIP } from "node:net";
import { promises as dns } from "node:dns";
import type { ServerConfig } from "../config.js";
import { ToolError } from "./errors.js";

const PRIVATE_IPV4_PATTERNS: RegExp[] = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  // Carrier-grade NAT 100.64.0.0/10 — also covers Tailscale's CGNAT range
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./
];

const PRIVATE_IPV4_172 = /^172\.(1[6-9]|2\d|3[01])\./;

function checkIp(ip: string): void {
  for (const pattern of PRIVATE_IPV4_PATTERNS) {
    if (pattern.test(ip)) {
      throw new ToolError("INVALID_ARGUMENT", `blocked private ipv4: ${ip}`);
    }
  }
  if (PRIVATE_IPV4_172.test(ip)) {
    throw new ToolError("INVALID_ARGUMENT", `blocked private ipv4: ${ip}`);
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower.startsWith("fe80:") || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("::ffff:")) {
    throw new ToolError("INVALID_ARGUMENT", `blocked private ipv6: ${ip}`);
  }
  // S1: IPv4-mapped IPv6 fully-expanded form, e.g. 0:0:0:0:0:ffff:7f00:1
  if (/^(?:0+:){5}(?:0*:)?ffff:/i.test(lower)) {
    throw new ToolError("INVALID_ARGUMENT", `blocked private ipv6: ${ip}`);
  }
  // S1: NAT64 well-known prefix 64:ff9b::/96 — decode embedded IPv4 and re-check.
  if (/^64:ff9b::/i.test(lower)) {
    const v4part = lower.replace(/^64:ff9b::(?:0+:)?/i, "");
    const hexPair = v4part.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
    if (hexPair) {
      const hi = parseInt(hexPair[1]!, 16); const lo = parseInt(hexPair[2]!, 16);
      const v4 = [(hi>>8)&0xff, hi&0xff, (lo>>8)&0xff, lo&0xff].join(".");
      checkIp(v4);
    } else if (/^\d+\.\d+\.\d+\.\d+$/.test(v4part)) {
      checkIp(v4part);
    }
  }
}

/**
 * S1: Reject URLs that point at non-public destinations.
 * SSRF / file:// / chrome:// / private-network protection.
 *
 * Set MCP_BROWSER_ALLOW_PRIVATE_NETWORKS=1 to bypass (e.g. for localhost testing).
 */
export async function assertSafeNavUrl(url: string, config: ServerConfig): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ToolError("INVALID_ARGUMENT", `invalid URL: ${url}`);
  }
  if (config.allowPrivateNetworks) {
    return;
  }
  if (parsed.protocol === "about:") {
    return;
  }
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new ToolError("INVALID_ARGUMENT", `scheme not allowed: ${parsed.protocol}`);
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  if (!host) {
    throw new ToolError("INVALID_ARGUMENT", "missing host");
  }
  const lowerHost = host.toLowerCase();
  // Block RFC-reserved / link-local hostnames that always resolve to private addresses.
  const blockedTlds = [".localhost", ".internal", ".local", ".corp", ".home.arpa", ".intranet", ".lan", ".private", ".test", ".example", ".invalid"];
  if (lowerHost === "localhost" || blockedTlds.some((tld) => lowerHost === tld.slice(1) || lowerHost.endsWith(tld))) {
    throw new ToolError("INVALID_ARGUMENT", `blocked host: ${host}`);
  }
  // S2: reject non-canonical IP notation (hex, octal/leading-zero) before isIP/DNS so they can't slip past the v4 check.
  if (/^0x[\da-f]+$/i.test(lowerHost) || /^0\d+(\.\d+)*$/.test(lowerHost)) {
    throw new ToolError("INVALID_ARGUMENT", `non-canonical IP notation blocked: ${host}`);
  }
  const v = isIP(host);
  if (v) {
    checkIp(host);
    return;
  }
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(host, { all: true });
  } catch (error) {
    throw new ToolError("INVALID_ARGUMENT", `cannot resolve host: ${host}`, false, {
      cause: error instanceof Error ? error.message : String(error)
    });
  }
  for (const a of addresses) {
    checkIp(a.address);
  }
}

/**
 * S10: Restrict a path to live under one of the configured roots.
 * Resolves real paths on both sides to prevent symlink escapes.
 * On Windows the comparison is case-insensitive; on POSIX it's exact.
 */
export async function assertPathUnderAllowedRoots(
  filePath: string,
  roots: string[],
  errorCode: "UPLOAD_PATH_NOT_ALLOWED" | "INVALID_ARGUMENT" = "INVALID_ARGUMENT"
): Promise<string> {
  if (!roots.length) {
    throw new ToolError(errorCode, "No allowed roots are configured");
  }
  const absolute = path.resolve(filePath);
  let realPath: string;
  try {
    realPath = await fs.realpath(absolute);
  } catch {
    try {
      const dirReal = await fs.realpath(path.dirname(absolute));
      realPath = path.join(dirReal, path.basename(absolute));
    } catch {
      realPath = absolute;
    }
  }
  for (const root of roots) {
    const rootAbs = path.resolve(root);
    let realRoot: string;
    try {
      realRoot = await fs.realpath(rootAbs);
    } catch (error) {
      // S4: do not silently fall back to the unresolved root — that would let a
      // missing/symlinked root pass containment checks for any path matching the
      // unresolved literal. Treat realpath failure as a hard error.
      throw new ToolError(errorCode, `Cannot resolve allowed root: ${rootAbs}`, false, {
        cause: error instanceof Error ? error.message : String(error)
      });
    }
    const rel = path.relative(realRoot, realPath);
    const isWindows = process.platform === "win32";
    const normalizedRel = isWindows ? rel.toLowerCase() : rel;
    const escapes = normalizedRel.startsWith("..") || path.isAbsolute(rel);
    if (!escapes) {
      return realPath;
    }
    if (isWindows && realPath.toLowerCase() === realRoot.toLowerCase()) {
      return realPath;
    }
    if (!isWindows && realPath === realRoot) {
      return realPath;
    }
  }
  throw new ToolError(errorCode, `Path is outside allowed roots: ${absolute}`);
}

/**
 * S12: Sanitize a basename: strip path separators / control / non-ASCII trickery.
 */
export function sanitizeBasename(value: string, fallback = "screenshot"): string {
  const base = path.basename(value);
  const cleaned = base.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^[-.]+|[-.]+$/g, "");
  return cleaned || fallback;
}

/**
 * S5: Hosts considered loopback. Used to gate non-loopback CDP attach behind an env var.
 */
export function isLoopbackHost(host: string): boolean {
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower === "127.0.0.1" || lower === "::1" || lower === "[::1]") {
    return true;
  }
  return /^127\./.test(host);
}

// S3: minimal known two-label TLDs so e.g. example.co.jp doesn't collapse to "co.jp"
// and falsely match an attacker's evil.co.jp at the cookie domain check.
const KNOWN_TWO_LABEL_TLDS = new Set([
  "co.uk", "co.jp", "co.kr", "com.au", "com.br", "com.cn", "com.mx", "com.tw",
  "org.uk", "me.uk", "net.uk", "ac.uk", "gov.uk", "ltd.uk", "plc.uk", "sch.uk",
  "or.jp", "ne.jp", "ac.jp", "ed.jp", "go.jp"
]);

/**
 * S8: Compute eTLD+1 for cookie scoping. Conservative two-label heuristic with a
 * small known-two-label-TLD allowlist (S3) so cookies on .co.jp / .co.uk etc.
 * scope to label-3 instead of false-merging to the registry suffix.
 */
export function effectiveDomain(host: string): string {
  const lower = host.toLowerCase().replace(/^\.+/, "");
  if (isIP(lower)) return lower;
  const parts = lower.split(".").filter(Boolean);
  if (parts.length <= 2) return lower;
  const lastTwo = parts.slice(-2).join(".");
  if (KNOWN_TWO_LABEL_TLDS.has(lastTwo)) {
    return parts.slice(-3).join(".");
  }
  return lastTwo;
}

/**
 * S11: Escape JSON for safe inlining in JS source (Runtime.evaluate).
 * U+2028 and U+2029 are valid in JSON but break JS parsers.
 */
export function safeJsonForJs(value: unknown): string {
  return JSON.stringify(value)
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
