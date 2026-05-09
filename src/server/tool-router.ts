import fs from "node:fs/promises";
import { z } from "zod";
import type { ServerContext } from "./context.js";
import { listInstallations } from "../detect/installations.js";
import { listRunningBrowsers } from "../detect/running.js";
import { ToolError } from "../core/errors.js";
import { assertPathUnderAllowedRoots, assertSafeNavUrl, effectiveDomain, isLoopbackHost } from "../core/security.js";
import { coerceArray, coerceObject, runTool } from "../tools/helpers.js";
import { detectEndpointFromPort, detectEndpointFromRunningBrowser } from "../backends/chromium/attach.js";
import { launchChromium } from "../backends/chromium/launch.js";
import { activateTab, closeTab, listTargets, newTab } from "../backends/chromium/targets.js";
import {
  click,
  evaluateExpression,
  getCookies,
  getCurrentUrl,
  getHtml,
  getPdfViewerState,
  getStorage,
  getText,
  goBack,
  goForward,
  hover,
  listTabsForSession,
  navigate,
  pdfNextPage,
  pdfPrevPage,
  pressKey,
  reload,
  scrollPage,
  selectOption,
  setChecked,
  setCookies,
  setStorage,
  snapshotPage,
  takeScreenshot,
  typeText,
  waitForCondition,
  waitForNetworkIdle
} from "../backends/chromium/page.js";
import { extractPdf } from "../backends/chromium/pdf.js";

const browserEnum = z.enum(["brave", "chrome", "edge", "chromium"]);

// B8: typed helper instead of repeated `as Record<string, unknown>` casts.
function toRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

// B28: shared "normalize raw args + coerce a single field" prelude.
function normalizeArgs(rawArgs: unknown, coercions?: Record<string, "object" | "array">): Record<string, unknown> {
  const normalized = { ...toRecord(rawArgs) };
  if (coercions) {
    for (const [key, kind] of Object.entries(coercions)) {
      if (kind === "object") {
        const coerced = coerceObject(normalized[key]);
        if (coerced !== undefined) normalized[key] = coerced;
      } else {
        const coerced = coerceArray(normalized[key]);
        if (coerced !== undefined) normalized[key] = coerced;
      }
    }
  }
  return normalized;
}

function resolveTabId(context: ServerContext, sessionId: string, tabId?: string): string {
  const session = context.sessions.getSession(sessionId);
  const resolved = tabId ?? session.activeTabId;
  if (!resolved) {
    throw new ToolError("TAB_NOT_FOUND", "No tabId was provided and the session has no active tab");
  }
  return resolved;
}

// B21: ensure dirs once at startup, not per-request.
let directoriesEnsured: WeakSet<ServerContext> | undefined;
async function ensureDirectories(context: ServerContext): Promise<void> {
  if (!directoriesEnsured) directoriesEnsured = new WeakSet();
  if (directoriesEnsured.has(context)) return;
  await Promise.all([
    fs.mkdir(context.config.downloadsDir, { recursive: true }),
    fs.mkdir(context.config.screenshotDir, { recursive: true }),
    fs.mkdir(context.config.tempDir, { recursive: true })
  ]);
  directoriesEnsured.add(context);
}

// S6: validate that an executable path is allowed.
// S7: do NOT echo the allowlist or known installation list back in details — that
// leaks file-system layout information to whatever caller (LLM client) hit the error.
async function assertExecutableAllowed(executablePath: string, allowedExecutables: string[]): Promise<void> {
  const installations = await listInstallations();
  const known = new Set(installations.map((i) => i.executablePath.toLowerCase()));
  if (known.has(executablePath.toLowerCase())) return;
  const allow = new Set(allowedExecutables.map((p) => p.toLowerCase()));
  if (allow.has(executablePath.toLowerCase())) return;
  throw new ToolError("INVALID_ARGUMENT", `executablePath is not on the allowlist: ${executablePath}`);
}

export async function callTool(context: ServerContext, name: string, rawArgs: unknown) {
  // B22: top-level guard so a thrown error still returns a structured ToolFailure.
  try {
    await ensureDirectories(context);
    return await dispatchTool(context, name, rawArgs);
  } catch (error) {
    return runTool({}, async () => {
      throw error;
    });
  }
}

async function dispatchTool(context: ServerContext, name: string, rawArgs: unknown) {
  switch (name) {
    case "browser_list_installations":
      return runTool({}, async () => ({ installations: await listInstallations() }));
    case "browser_list_running":
      return runTool({}, async () => ({ browsers: await listRunningBrowsers() }));
    case "browser_connect":
      return runTool({}, async () => {
        if (!context.config.allowAttach) {
          throw new ToolError("UNSUPPORTED_OPERATION", "Attach mode is disabled by configuration");
        }

        const args = z.object({
          browser: browserEnum.optional(),
          host: z.string().optional(),
          port: z.number().int().positive().optional(),
          pickFirstAttachable: z.boolean().optional()
        }).parse(rawArgs ?? {});

        // S5: gate non-loopback attaches behind MCP_BROWSER_ALLOW_REMOTE_ATTACH=1.
        const host = args.host ?? "127.0.0.1";
        if (!isLoopbackHost(host) && !context.config.allowRemoteAttach) {
          throw new ToolError("INVALID_ARGUMENT", `non-loopback host ${host} requires MCP_BROWSER_ALLOW_REMOTE_ATTACH=1`);
        }

        let browser = args.browser;
        let endpoint;
        let executablePath: string | undefined;
        let processId: number | undefined;

        if (args.port) {
          endpoint = await detectEndpointFromPort(args.port, host);
        } else {
          const running = await listRunningBrowsers();
          // B7: stable order.
          const filtered = running
            .filter((item) => (!browser || item.browser === browser) && item.attachable)
            .sort((a, b) => a.processId - b.processId);
          if (filtered.length === 0) {
            throw new ToolError("BROWSER_NOT_ATTACHABLE", "No attachable running browser was found");
          }
          if (filtered.length > 1 && !args.pickFirstAttachable) {
            throw new ToolError("AMBIGUOUS_TARGET", "Multiple attachable browsers were found. Specify browser or set pickFirstAttachable=true.", false, {
              candidates: filtered.map((item) => ({ browser: item.browser, processId: item.processId, port: item.debuggingPort }))
            });
          }
          const target = filtered[0]!;
          browser = target.browser;
          executablePath = target.executablePath;
          processId = target.processId;
          endpoint = await detectEndpointFromRunningBrowser(target);
        }

        // B17: list tabs first so we can register them atomically with active-tab assignment.
        const tabs = await listTargets(endpoint);
        const session = context.sessions.createSession({
          mode: "attach",
          browser: browser ?? "chromium",
          endpoint,
          executablePath,
          processId,
          profileMode: "profile-path",
          managedTabs: new Map(),
          capabilities: {
            pdfExtract: true,
            downloadEvents: false,
            networkLogs: false,
            screenshots: true
          }
        });

        for (const tab of tabs) {
          context.sessions.registerTab(session.sessionId, tab.tabId, false, undefined, tab.url);
        }
        if (tabs[0]) {
          context.sessions.setActiveTab(session.sessionId, tabs[0].tabId);
        }

        return { session, tabs };
      });
    case "browser_launch":
      return runTool({}, async () => {
        if (!context.config.allowLaunch) {
          throw new ToolError("UNSUPPORTED_OPERATION", "Launch mode is disabled by configuration");
        }

        const normalized = normalizeArgs(rawArgs, { windowSize: "object" });
        const args = z.object({
          browser: browserEnum,
          executablePath: z.string().optional(),
          profileMode: z.enum(["isolated", "profile-path"]).default("isolated"),
          profilePath: z.string().optional(),
          startupUrl: z.string().optional(),
          windowSize: z.object({
            width: z.number().positive(),
            height: z.number().positive()
          }).optional()
        }).parse(normalized);

        // S6: enforce executablePath allowlist if user provided one.
        if (args.executablePath) {
          await assertExecutableAllowed(args.executablePath, context.config.allowedExecutables);
        }

        let executablePath = args.executablePath;
        if (!executablePath) {
          executablePath = (await listInstallations()).find((item) => item.browser === args.browser)?.executablePath;
        }
        if (!executablePath) {
          throw new ToolError("BROWSER_NOT_FOUND", `No installation was found for ${args.browser}`);
        }

        // S6: enforce profilePath under allowedProfileRoots when profileMode === "profile-path".
        // Use assertPathUnderAllowedRoots so realpath() resolves symlinks on both sides —
        // a bare path.relative() check would let a symlink under tempDir escape the root.
        let resolvedProfilePath = args.profileMode === "profile-path" ? args.profilePath : undefined;
        if (resolvedProfilePath) {
          try {
            resolvedProfilePath = await assertPathUnderAllowedRoots(resolvedProfilePath, context.config.allowedProfileRoots);
          } catch (error) {
            if (error instanceof ToolError) {
              throw new ToolError("INVALID_ARGUMENT", `profilePath must live under one of: ${context.config.allowedProfileRoots.join(", ")}`, false, error.details);
            }
            throw error;
          }
        }

        // S1: if a startup URL is provided, validate it before launch so we don't spawn first.
        if (args.startupUrl) {
          await assertSafeNavUrl(args.startupUrl, context.config);
        }

        const launch = await launchChromium({
          executablePath,
          profilePath: resolvedProfilePath,
          startupUrl: args.startupUrl,
          windowSize: args.windowSize,
          tempRoot: context.config.tempDir
        });

        const tabs = await listTargets(launch.endpoint);
        const session = context.sessions.createSession({
          mode: "launch",
          browser: args.browser,
          endpoint: launch.endpoint,
          executablePath,
          processId: launch.process.pid,
          profileMode: args.profileMode,
          profilePath: launch.profilePath,
          childProcess: launch.process,
          managedTabs: new Map(),
          capabilities: {
            pdfExtract: true,
            downloadEvents: false,
            networkLogs: false,
            screenshots: true
          }
        });

        for (const tab of tabs) {
          context.sessions.registerTab(session.sessionId, tab.tabId, false, undefined, tab.url);
        }
        if (tabs[0]) {
          context.sessions.setActiveTab(session.sessionId, tabs[0].tabId);
        }

        return { session, tabs };
      });
    case "browser_disconnect":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string() }).parse(rawArgs ?? {});
        const session = context.sessions.getSession(args.sessionId);
        for (const tab of context.sessions.listManagedTabs(args.sessionId)) {
          if (tab.openedByMcp && !tab.closedAt) {
            try {
              await closeTab(session.endpoint, tab.tabId);
            } catch (error) {
              // B10: log instead of swallowing — caller still gets a clean disconnect.
              context.logger.warn("failed to close MCP-opened tab during disconnect", {
                sessionId: args.sessionId,
                tabId: tab.tabId,
                cause: error instanceof Error ? error.message : String(error)
              });
            }
            try {
              await waitForTabToDisappear(session.endpoint, tab.tabId);
              context.sessions.markTabClosed(args.sessionId, tab.tabId);
            } catch (error) {
              context.logger.warn("tab did not disappear within deadline", {
                sessionId: args.sessionId,
                tabId: tab.tabId,
                cause: error instanceof Error ? error.message : String(error)
              });
            }
          }
        }
        await context.sessions.deleteSession(args.sessionId);
        return { disconnected: true };
      });
    case "browser_list_sessions":
      return runTool({}, async () => ({ sessions: context.sessions.listSessions() }));
    case "browser_get_session":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string() }).parse(rawArgs ?? {});
        return { session: context.sessions.getSession(args.sessionId) };
      });
    case "browser_list_managed_tabs":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string() }).parse(rawArgs ?? {});
        return { tabs: context.sessions.listManagedTabs(args.sessionId) };
      });
    case "browser_note_tab":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string(), note: z.string().min(1) }).parse(rawArgs ?? {});
        return { tab: context.sessions.addTabNote(args.sessionId, args.tabId, args.note) };
      });
    case "browser_list_tabs":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string() }).parse(rawArgs ?? {});
        return { tabs: await listTabsForSession(context.sessions.getSession(args.sessionId)) };
      });
    case "browser_new_tab":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), url: z.string().optional() }).parse(rawArgs ?? {});
        // S1: SSRF guard.
        if (args.url) await assertSafeNavUrl(args.url, context.config);
        const session = context.sessions.getSession(args.sessionId);
        const tab = await newTab(session.endpoint, args.url);
        context.sessions.registerTab(args.sessionId, tab.tabId, true, "Opened by MCP", tab.url);
        context.sessions.setActiveTab(args.sessionId, tab.tabId);
        return { tab };
      });
    case "browser_activate_tab":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string() }).parse(rawArgs ?? {});
        const session = context.sessions.getSession(args.sessionId);
        await activateTab(session.endpoint, args.tabId);
        context.sessions.setActiveTab(args.sessionId, args.tabId);
        context.sessions.registerTab(args.sessionId, args.tabId, false);
        return { activeTabId: args.tabId };
      });
    case "browser_close_tab":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string() }).parse(rawArgs ?? {});
        const sessionForClose = context.sessions.getSession(args.sessionId);
        await closeTab(sessionForClose.endpoint, args.tabId);
        context.sessions.markTabClosed(args.sessionId, args.tabId);
        // B6: re-fetch the session reference after the await — the stored object may have
        // been mutated (or reused) by another concurrent call while closeTab was in flight.
        const refreshed = context.sessions.getSession(args.sessionId);
        if (refreshed.activeTabId === args.tabId) {
          refreshed.activeTabId = undefined;
          // B5: if we just cleared the active tab, promote the most recently created
          // surviving managed tab so subsequent tool calls don't fail with TAB_NOT_FOUND.
          const survivors = context.sessions.listManagedTabs(args.sessionId)
            .filter((t) => !t.closedAt && t.tabId !== args.tabId)
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
          if (survivors[0]) {
            refreshed.activeTabId = survivors[0].tabId;
          }
        }
        return { closed: true };
      });
    case "browser_navigate":
      return runTool({}, async () => {
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          url: z.string(),
          waitUntil: z.enum(["domcontentloaded", "load"]).optional(),
          timeoutMs: z.number().int().positive().optional()
        }).parse(rawArgs ?? {});
        // S1: SSRF guard.
        await assertSafeNavUrl(args.url, context.config);
        const session = context.sessions.getSession(args.sessionId);
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const data = await navigate(session, tabId, args.url, args.waitUntil ?? "load", args.timeoutMs ?? context.config.defaultCommandTimeoutMs);
        context.sessions.setActiveTab(args.sessionId, tabId);
        context.sessions.updateTabUrl(args.sessionId, tabId, data.url);
        return data;
      });
    case "browser_go_back":
      return runTool({}, async () => {
        // U7: optional timeoutMs.
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          timeoutMs: z.number().int().positive().optional()
        }).parse(rawArgs ?? {});
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const result = await goBack(context.sessions.getSession(args.sessionId), tabId, args.timeoutMs ?? context.config.defaultCommandTimeoutMs);
        context.sessions.updateTabUrl(args.sessionId, tabId, result.url);
        return result;
      });
    case "browser_go_forward":
      return runTool({}, async () => {
        // U7: optional timeoutMs.
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          timeoutMs: z.number().int().positive().optional()
        }).parse(rawArgs ?? {});
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const result = await goForward(context.sessions.getSession(args.sessionId), tabId, args.timeoutMs ?? context.config.defaultCommandTimeoutMs);
        context.sessions.updateTabUrl(args.sessionId, tabId, result.url);
        return result;
      });
    case "browser_reload":
      return runTool({}, async () => {
        // U8: accept optional timeoutMs; thread through to reload().
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional(), timeoutMs: z.number().int().positive().optional() }).parse(rawArgs ?? {});
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const result = await reload(context.sessions.getSession(args.sessionId), tabId, args.timeoutMs ?? context.config.defaultCommandTimeoutMs);
        context.sessions.updateTabUrl(args.sessionId, tabId, result.url);
        return result;
      });
    case "browser_wait_for":
      return runTool({}, async () => {
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          selector: z.string().optional(),
          text: z.string().optional(),
          urlIncludes: z.string().optional(),
          timeoutMs: z.number().int().positive().optional()
        }).refine(
          (v) => v.selector !== undefined || v.text !== undefined || v.urlIncludes !== undefined,
          { message: "browser_wait_for requires at least one of: selector, text, urlIncludes" }
        ).parse(rawArgs ?? {});
        return waitForCondition(
          context.sessions.getSession(args.sessionId),
          resolveTabId(context, args.sessionId, args.tabId),
          { selector: args.selector, text: args.text, urlIncludes: args.urlIncludes },
          args.timeoutMs ?? context.config.defaultCommandTimeoutMs
        );
      });
    case "browser_snapshot":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional() }).parse(rawArgs ?? {});
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        context.sessions.addTabNote(args.sessionId, tabId, "Captured page snapshot");
        return snapshotPage(context.sessions, context.sessions.getSession(args.sessionId), tabId, context.config);
      });
    case "browser_get_text":
      return runTool({}, async () => {
        const normalized = normalizeArgs(rawArgs, { target: "object" });
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          target: z.object({ selector: z.string() }).optional(),
          maxChars: z.number().int().positive().optional()
        }).parse(normalized);
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        context.sessions.addTabNote(args.sessionId, tabId, "Extracted visible text");
        return getText(context.sessions.getSession(args.sessionId), tabId, args.target, args.maxChars ?? context.config.maxTextChars);
      });
    case "browser_get_html":
      return runTool({}, async () => {
        const normalized = normalizeArgs(rawArgs, { target: "object" });
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          target: z.object({ selector: z.string() }),
          mode: z.enum(["outerHTML", "innerHTML"]).default("outerHTML"),
          maxChars: z.number().int().positive().optional()
        }).parse(normalized);
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        context.sessions.addTabNote(args.sessionId, tabId, `Extracted HTML (${args.mode})`);
        return getHtml(context.sessions.getSession(args.sessionId), tabId, args.target, args.maxChars ?? context.config.maxHtmlChars, args.mode);
      });
    case "browser_eval":
      return runTool({}, async () => {
        // U9: enforce min(1) and max(maxEvalExpressionChars) at the Zod layer.
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional(), expression: z.string().min(1).max(context.config.maxEvalExpressionChars) }).parse(rawArgs ?? {});
        return evaluateExpression(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.expression, context.config);
      });
    case "browser_click":
      return runTool({}, async () => {
        const normalized = normalizeArgs(rawArgs, { target: "object" });
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          target: z.object({ elementRef: z.string().optional(), selector: z.string().optional(), textQuery: z.string().optional() }).refine(
            (t) => t.elementRef !== undefined || t.selector !== undefined || t.textQuery !== undefined,
            { message: "target requires one of: elementRef, selector, textQuery" }
          )
        }).parse(normalized);
        return click(context.sessions, context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.target);
      });
    case "browser_type":
      return runTool({}, async () => {
        const normalized = normalizeArgs(rawArgs, { target: "object" });
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          target: z.object({ elementRef: z.string().optional(), selector: z.string().optional(), textQuery: z.string().optional() }).refine(
            (t) => t.elementRef !== undefined || t.selector !== undefined || t.textQuery !== undefined,
            { message: "target requires one of: elementRef, selector, textQuery" }
          ),
          text: z.string(),
          clearFirst: z.boolean().default(true)
        }).parse(normalized);
        return typeText(context.sessions, context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.target, args.text, args.clearFirst);
      });
    case "browser_press_key":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional(), key: z.string() }).parse(rawArgs ?? {});
        return pressKey(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.key);
      });
    case "browser_scroll":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional(), deltaX: z.number().default(0), deltaY: z.number().default(600) }).parse(rawArgs ?? {});
        return scrollPage(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.deltaX, args.deltaY);
      });
    case "browser_take_screenshot":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional(), nameHint: z.string().optional() }).parse(rawArgs ?? {});
        return takeScreenshot(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), context.config.screenshotDir, args.nameHint);
      });
    case "browser_pdf_open":
      return runTool({}, async () => {
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          url: z.string().url(),
          newTab: z.boolean().default(false),
          waitUntil: z.enum(["domcontentloaded", "load"]).default("load"),
          timeoutMs: z.number().int().positive().optional(),
          note: z.string().optional()
        }).parse(rawArgs ?? {});
        // S1: SSRF guard.
        await assertSafeNavUrl(args.url, context.config);
        const session = context.sessions.getSession(args.sessionId);
        if (args.newTab) {
          const tab = await newTab(session.endpoint, args.url);
          context.sessions.registerTab(args.sessionId, tab.tabId, true, args.note ?? "Opened PDF by MCP", tab.url);
          context.sessions.setActiveTab(args.sessionId, tab.tabId);
          // B4: newTab returns immediately after the target is created; navigation may not
          // have completed yet. Navigate explicitly and wait for the lifecycle event before
          // reading the PDF viewer state.
          await navigate(session, tab.tabId, args.url, args.waitUntil, args.timeoutMs ?? context.config.defaultCommandTimeoutMs);
          const state = await getPdfViewerState(session, tab.tabId);
          context.sessions.updateTabUrl(args.sessionId, tab.tabId, state.viewerUrl);
          context.sessions.updatePdfState(args.sessionId, tab.tabId, {
            sourceUrl: state.viewerUrl,
            currentPage: state.currentPage ?? 1,
            pageCount: state.pageCount,
            zoomPercent: state.zoomPercent
          });
          return { tab, viewer: state };
        }

        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const navigation = await navigate(session, tabId, args.url, args.waitUntil, args.timeoutMs ?? context.config.defaultCommandTimeoutMs);
        context.sessions.setActiveTab(args.sessionId, tabId);
        context.sessions.registerTab(args.sessionId, tabId, false, args.note ?? "Reused tab for PDF navigation", navigation.url);
        const state = await getPdfViewerState(session, tabId);
        context.sessions.updateTabUrl(args.sessionId, tabId, state.viewerUrl);
        context.sessions.updatePdfState(args.sessionId, tabId, {
          sourceUrl: state.viewerUrl,
          currentPage: state.currentPage ?? 1,
          pageCount: state.pageCount,
          zoomPercent: state.zoomPercent
        });
        return { navigation, viewer: state };
      });
    case "browser_pdf_viewer_state":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional() }).parse(rawArgs ?? {});
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const state = await getPdfViewerState(context.sessions.getSession(args.sessionId), tabId);
        const cached = context.sessions.getPdfState(args.sessionId, tabId);
        const merged = {
          ...state,
          currentPage: state.currentPage ?? cached?.currentPage,
          pageCount: state.pageCount ?? cached?.pageCount,
          zoomPercent: state.zoomPercent ?? cached?.zoomPercent
        };
        context.sessions.updatePdfState(args.sessionId, tabId, {
          sourceUrl: merged.viewerUrl,
          currentPage: merged.currentPage,
          pageCount: merged.pageCount,
          zoomPercent: merged.zoomPercent
        });
        return merged;
      });
    case "browser_pdf_next_page":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional() }).parse(rawArgs ?? {});
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const previous = context.sessions.getPdfState(args.sessionId, tabId);
        const result = await pdfNextPage(context.sessions.getSession(args.sessionId), tabId);
        const currentPage = result.currentPage ?? (previous?.currentPage ? previous.currentPage + 1 : 2);
        const pageCount = result.pageCount ?? previous?.pageCount;
        context.sessions.updatePdfState(args.sessionId, tabId, { currentPage, pageCount });
        context.sessions.addTabNote(args.sessionId, tabId, `Advanced PDF to page ${currentPage ?? "unknown"}`);
        return { ...result, currentPage, pageCount };
      });
    case "browser_pdf_prev_page":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional() }).parse(rawArgs ?? {});
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const previous = context.sessions.getPdfState(args.sessionId, tabId);
        const result = await pdfPrevPage(context.sessions.getSession(args.sessionId), tabId);
        const currentPage = result.currentPage ?? (previous?.currentPage ? Math.max(1, previous.currentPage - 1) : 1);
        const pageCount = result.pageCount ?? previous?.pageCount;
        context.sessions.updatePdfState(args.sessionId, tabId, { currentPage, pageCount });
        context.sessions.addTabNote(args.sessionId, tabId, `Moved PDF back to page ${currentPage ?? "unknown"}`);
        return { ...result, currentPage, pageCount };
      });
    case "browser_pdf_extract":
      return runTool({}, async () => {
        const normalized = normalizeArgs(rawArgs, { pages: "array" });
        const args = z.object({
          sessionId: z.string().optional(),
          tabId: z.string().optional(),
          filePath: z.string().optional(),
          url: z.string().url().optional(),
          pages: z.array(z.number().int().positive()).optional(),
          maxCharsPerPage: z.number().int().positive().optional()
        }).parse(normalized);
        // B18: only fall back to current tab URL when neither filePath nor url was supplied.
        let resolvedUrl = args.url;
        if (!args.filePath && !args.url && args.sessionId) {
          resolvedUrl = await getCurrentUrl(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId));
        }
        const extracted = await extractPdf({
          filePath: args.filePath,
          url: resolvedUrl,
          pages: args.pages,
          maxCharsPerPage: args.maxCharsPerPage
        }, context.config);
        if (args.sessionId) {
          const tabId = resolveTabId(context, args.sessionId, args.tabId);
          context.sessions.addTabNote(args.sessionId, tabId, `Extracted PDF text${args.pages?.length ? ` for pages ${args.pages.join(",")}` : ""}`);
          context.sessions.updatePdfState(args.sessionId, tabId, {
            sourceUrl: resolvedUrl,
            pageCount: extracted.pageCount
          });
        }
        return extracted;
      });
    case "browser_get_cookies":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional() }).parse(rawArgs ?? {});
        return getCookies(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId));
      });
    case "browser_set_cookies":
      return runTool({}, async () => {
        const normalized = normalizeArgs(rawArgs, { cookies: "array" });
        const cookieSchema = z.object({
          name: z.string().min(1),
          value: z.string(),
          domain: z.string().optional(),
          path: z.string().optional(),
          expires: z.number().optional(),
          httpOnly: z.boolean().optional(),
          secure: z.boolean().optional(),
          sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
          url: z.string().url().optional()
        }).strict();
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          cookies: z.array(cookieSchema)
        }).parse(normalized);

        // S8: when in attach mode, restrict cookie domain to the current tab's eTLD+1.
        const session = context.sessions.getSession(args.sessionId);
        // B10: resolve the tab ID once and reuse it. Calling resolveTabId twice across
        // an await let activeTabId change between the URL check and the cookie write,
        // which could let cookies land on a different origin than the one we validated.
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        if (session.mode === "attach" && !context.config.allowCrossOriginCookies) {
          const currentUrl = await getCurrentUrl(session, tabId);
          let host = "";
          try {
            host = new URL(currentUrl).hostname;
          } catch {
            // ignore — empty host => disallow
          }
          const allowedDomain = host ? effectiveDomain(host) : "";
          for (const c of args.cookies) {
            // S5: when domain is absent but url is present, derive the host from the URL
            // and apply the same eTLD+1 check so a url-only cookie can't bypass the guard.
            const effectiveHost = c.domain
              ? c.domain.replace(/^\.+/, "").toLowerCase()
              : (() => { try { return new URL(c.url ?? "").hostname; } catch { return ""; } })();
            if (effectiveHost && allowedDomain && !effectiveHost.endsWith(allowedDomain)) {
              throw new ToolError("INVALID_ARGUMENT", `cookie target ${effectiveHost} is not within ${allowedDomain}; set MCP_BROWSER_ALLOW_CROSS_ORIGIN_COOKIES=1 to bypass`);
            }
          }
        }

        // U15: setCookies accepts the zod-inferred cookie array directly; no unsafe cast.
        return setCookies(session, tabId, args.cookies);
      });
    case "browser_storage_get":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional(), kind: z.enum(["localStorage", "sessionStorage"]) }).parse(rawArgs ?? {});
        return getStorage(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.kind);
      });
    case "browser_storage_set":
      return runTool({}, async () => {
        const normalized = normalizeArgs(rawArgs, { entries: "object" });
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional(), kind: z.enum(["localStorage", "sessionStorage"]), entries: z.record(z.string()) }).parse(normalized);
        return setStorage(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.kind, args.entries);
      });
    // U11: hover
    case "browser_hover":
      return runTool({}, async () => {
        const normalized = normalizeArgs(rawArgs, { target: "object" });
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          target: z.object({ elementRef: z.string().optional(), selector: z.string().optional(), textQuery: z.string().optional() }).refine(
            (t) => t.elementRef !== undefined || t.selector !== undefined || t.textQuery !== undefined,
            { message: "target requires one of: elementRef, selector, textQuery" }
          )
        }).parse(normalized);
        return hover(context.sessions, context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.target);
      });
    // U12: select_option
    case "browser_select_option":
      return runTool({}, async () => {
        const normalized = normalizeArgs(rawArgs, { target: "object", values: "array" });
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          target: z.object({ elementRef: z.string().optional(), selector: z.string().optional(), textQuery: z.string().optional() }).refine(
            (t) => t.elementRef !== undefined || t.selector !== undefined || t.textQuery !== undefined,
            { message: "target requires one of: elementRef, selector, textQuery" }
          ),
          values: z.array(z.string()).min(1)
        }).parse(normalized);
        return selectOption(context.sessions, context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.target, args.values);
      });
    // U13: set_checked
    case "browser_set_checked":
      return runTool({}, async () => {
        const normalized = normalizeArgs(rawArgs, { target: "object" });
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          target: z.object({ elementRef: z.string().optional(), selector: z.string().optional(), textQuery: z.string().optional() }).refine(
            (t) => t.elementRef !== undefined || t.selector !== undefined || t.textQuery !== undefined,
            { message: "target requires one of: elementRef, selector, textQuery" }
          ),
          checked: z.boolean()
        }).parse(normalized);
        return setChecked(context.sessions, context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.target, args.checked);
      });
    // U14: wait_for_network_idle
    case "browser_wait_for_network_idle":
      return runTool({}, async () => {
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          idleMs: z.number().int().positive().optional(),
          timeoutMs: z.number().int().positive().optional()
        }).parse(rawArgs ?? {});
        return waitForNetworkIdle(
          context.sessions.getSession(args.sessionId),
          resolveTabId(context, args.sessionId, args.tabId),
          { idleMs: args.idleMs, timeoutMs: args.timeoutMs ?? context.config.defaultCommandTimeoutMs }
        );
      });
    default:
      // B22: still wrap default in runTool so the caller gets a structured error envelope.
      return runTool({}, async () => {
        throw new ToolError("INVALID_ARGUMENT", `Unknown tool: ${name}`);
      });
  }
}

// B9: Promise.race against a real deadline so this can't hang forever.
async function waitForTabToDisappear(endpoint: Parameters<typeof listTargets>[0], tabId: string, timeoutMs = 3000): Promise<void> {
  const work = (async () => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const tabs = await listTargets(endpoint);
      if (!tabs.some((tab) => tab.tabId === tabId)) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new ToolError("TAB_NOT_FOUND", `tab ${tabId} did not disappear within ${timeoutMs}ms`);
  })();
  let timer: NodeJS.Timeout | undefined;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ToolError("TAB_NOT_FOUND", `tab ${tabId} did not disappear within ${timeoutMs}ms`)), timeoutMs + 1000);
  });
  try {
    await Promise.race([work, guard]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
