import fs from "node:fs/promises";
import { z } from "zod";
import type { ServerContext } from "./context.js";
import { listInstallations } from "../detect/installations.js";
import { listRunningBrowsers } from "../detect/running.js";
import { ToolError } from "../core/errors.js";
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
  listTabsForSession,
  navigate,
  pdfNextPage,
  pdfPrevPage,
  pressKey,
  reload,
  scrollPage,
  setCookies,
  setStorage,
  snapshotPage,
  takeScreenshot,
  typeText,
  waitForCondition
} from "../backends/chromium/page.js";
import { extractPdf } from "../backends/chromium/pdf.js";

const browserEnum = z.enum(["brave", "chrome", "edge", "chromium"]);

function resolveTabId(context: ServerContext, sessionId: string, tabId?: string): string {
  const session = context.sessions.getSession(sessionId);
  const resolved = tabId ?? session.activeTabId;
  if (!resolved) {
    throw new ToolError("TAB_NOT_FOUND", "No tabId was provided and the session has no active tab");
  }
  return resolved;
}

async function ensureDirectories(context: ServerContext): Promise<void> {
  await Promise.all([
    fs.mkdir(context.config.downloadsDir, { recursive: true }),
    fs.mkdir(context.config.screenshotDir, { recursive: true }),
    fs.mkdir(context.config.tempDir, { recursive: true })
  ]);
}

export async function callTool(context: ServerContext, name: string, rawArgs: unknown) {
  await ensureDirectories(context);

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

        let browser = args.browser;
        let endpoint;
        let executablePath: string | undefined;
        let processId: number | undefined;

        if (args.port) {
          endpoint = await detectEndpointFromPort(args.port, args.host ?? "127.0.0.1");
        } else {
          const running = await listRunningBrowsers();
          const filtered = running.filter((item) => (!browser || item.browser === browser) && item.attachable);
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

        const tabs = await listTargets(endpoint);
        if (tabs[0]) {
          context.sessions.setActiveTab(session.sessionId, tabs[0].tabId);
        }
        for (const tab of tabs) {
          context.sessions.registerTab(session.sessionId, tab.tabId, false, undefined, tab.url);
        }

        return { session, tabs };
      });
    case "browser_launch":
      return runTool({}, async () => {
        if (!context.config.allowLaunch) {
          throw new ToolError("UNSUPPORTED_OPERATION", "Launch mode is disabled by configuration");
        }

        const normalized = { ...(rawArgs as Record<string, unknown> ?? {}) };
        normalized.windowSize = coerceObject(normalized.windowSize);
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

        let executablePath = args.executablePath;
        if (!executablePath) {
          executablePath = (await listInstallations()).find((item) => item.browser === args.browser)?.executablePath;
        }
        if (!executablePath) {
          throw new ToolError("BROWSER_NOT_FOUND", `No installation was found for ${args.browser}`);
        }

        const launch = await launchChromium({
          executablePath,
          profilePath: args.profileMode === "profile-path" ? args.profilePath : undefined,
          startupUrl: args.startupUrl,
          windowSize: args.windowSize,
          tempRoot: context.config.tempDir
        });

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

        const tabs = await listTargets(launch.endpoint);
        if (tabs[0]) {
          context.sessions.setActiveTab(session.sessionId, tabs[0].tabId);
        }
        for (const tab of tabs) {
          context.sessions.registerTab(session.sessionId, tab.tabId, false, undefined, tab.url);
        }

        return { session, tabs };
      });
    case "browser_disconnect":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string() }).parse(rawArgs ?? {});
        const session = context.sessions.getSession(args.sessionId);
        for (const tab of context.sessions.listManagedTabs(args.sessionId)) {
          if (tab.openedByMcp && !tab.closedAt) {
            await closeTab(session.endpoint, tab.tabId).catch(() => undefined);
            await waitForTabToDisappear(session.endpoint, tab.tabId).catch(() => undefined);
            context.sessions.markTabClosed(args.sessionId, tab.tabId);
          }
        }
        context.sessions.deleteSession(args.sessionId);
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
        const session = context.sessions.getSession(args.sessionId);
        const tab = await newTab(session.endpoint, args.url);
        context.sessions.setActiveTab(args.sessionId, tab.tabId);
        context.sessions.registerTab(args.sessionId, tab.tabId, true, "Opened by MCP", tab.url);
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
        const session = context.sessions.getSession(args.sessionId);
        await closeTab(session.endpoint, args.tabId);
        context.sessions.markTabClosed(args.sessionId, args.tabId);
        if (session.activeTabId === args.tabId) {
          session.activeTabId = undefined;
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
        const session = context.sessions.getSession(args.sessionId);
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const data = await navigate(session, tabId, args.url, args.waitUntil ?? "load", args.timeoutMs ?? context.config.defaultCommandTimeoutMs);
        context.sessions.setActiveTab(args.sessionId, tabId);
        context.sessions.updateTabUrl(args.sessionId, tabId, data.url);
        return data;
      });
    case "browser_go_back":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional() }).parse(rawArgs ?? {});
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const result = await goBack(context.sessions.getSession(args.sessionId), tabId);
        context.sessions.updateTabUrl(args.sessionId, tabId, result.url);
        return result;
      });
    case "browser_go_forward":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional() }).parse(rawArgs ?? {});
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const result = await goForward(context.sessions.getSession(args.sessionId), tabId);
        context.sessions.updateTabUrl(args.sessionId, tabId, result.url);
        return result;
      });
    case "browser_reload":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional() }).parse(rawArgs ?? {});
        const tabId = resolveTabId(context, args.sessionId, args.tabId);
        const result = await reload(context.sessions.getSession(args.sessionId), tabId);
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
        }).parse(rawArgs ?? {});
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
        const normalized = { ...(rawArgs as Record<string, unknown> ?? {}) };
        normalized.target = coerceObject(normalized.target);
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
        const normalized = { ...(rawArgs as Record<string, unknown> ?? {}) };
        const coercedTarget = coerceObject(normalized.target);
        if (coercedTarget !== undefined) normalized.target = coercedTarget;
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
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional(), expression: z.string() }).parse(rawArgs ?? {});
        return evaluateExpression(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.expression, context.config);
      });
    case "browser_click":
      return runTool({}, async () => {
        const normalized = { ...(rawArgs as Record<string, unknown> ?? {}) };
        const coercedTarget = coerceObject(normalized.target);
        if (coercedTarget !== undefined) normalized.target = coercedTarget;
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          target: z.object({ elementRef: z.string().optional(), selector: z.string().optional(), textQuery: z.string().optional() })
        }).parse(normalized);
        return click(context.sessions, context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.target);
      });
    case "browser_type":
      return runTool({}, async () => {
        const normalized = { ...(rawArgs as Record<string, unknown> ?? {}) };
        const coercedTarget = coerceObject(normalized.target);
        if (coercedTarget !== undefined) normalized.target = coercedTarget;
        const args = z.object({
          sessionId: z.string(),
          tabId: z.string().optional(),
          target: z.object({ elementRef: z.string().optional(), selector: z.string().optional(), textQuery: z.string().optional() }),
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
        const session = context.sessions.getSession(args.sessionId);
        if (args.newTab) {
          const tab = await newTab(session.endpoint, args.url);
          context.sessions.setActiveTab(args.sessionId, tab.tabId);
          context.sessions.registerTab(args.sessionId, tab.tabId, true, args.note ?? "Opened PDF by MCP", tab.url);
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
        const normalized = { ...(rawArgs as Record<string, unknown> ?? {}) };
        normalized.pages = coerceArray(normalized.pages);
        const args = z.object({
          sessionId: z.string().optional(),
          tabId: z.string().optional(),
          filePath: z.string().optional(),
          url: z.string().url().optional(),
          pages: z.array(z.number().int().positive()).optional(),
          maxCharsPerPage: z.number().int().positive().optional()
        }).parse(normalized);
        const resolvedUrl = args.url ?? (args.sessionId ? await getCurrentUrl(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId)) : undefined);
        const extracted = await extractPdf({
          filePath: args.filePath,
          url: resolvedUrl,
          pages: args.pages,
          maxCharsPerPage: args.maxCharsPerPage
        });
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
        const normalized = { ...(rawArgs as Record<string, unknown> ?? {}) };
        const coercedCookies = coerceArray(normalized.cookies);
        if (coercedCookies !== undefined) normalized.cookies = coercedCookies;
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional(), cookies: z.array(z.record(z.any())) }).parse(normalized);
        return setCookies(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.cookies);
      });
    case "browser_storage_get":
      return runTool({}, async () => {
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional(), kind: z.enum(["localStorage", "sessionStorage"]) }).parse(rawArgs ?? {});
        return getStorage(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.kind);
      });
    case "browser_storage_set":
      return runTool({}, async () => {
        const normalized = { ...(rawArgs as Record<string, unknown> ?? {}) };
        const coercedEntries = coerceObject(normalized.entries);
        if (coercedEntries !== undefined) normalized.entries = coercedEntries;
        const args = z.object({ sessionId: z.string(), tabId: z.string().optional(), kind: z.enum(["localStorage", "sessionStorage"]), entries: z.record(z.string()) }).parse(normalized);
        return setStorage(context.sessions.getSession(args.sessionId), resolveTabId(context, args.sessionId, args.tabId), args.kind, args.entries);
      });
    default:
      throw new ToolError("INVALID_ARGUMENT", `Unknown tool: ${name}`);
  }
}

async function waitForTabToDisappear(endpoint: Parameters<typeof listTargets>[0], tabId: string, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tabs = await listTargets(endpoint);
    if (!tabs.some((tab) => tab.tabId === tabId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
