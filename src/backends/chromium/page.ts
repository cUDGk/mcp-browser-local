import fs from "node:fs/promises";
import path from "node:path";
import type { ServerConfig } from "../../config.js";
import { ToolError } from "../../core/errors.js";
import type { SessionManager } from "../../core/session-manager.js";
import type { BrowserSession, BrowserTargetSummary } from "../../types/session.js";
import type { PageSnapshot } from "../../types/snapshot.js";
import type { BoundingBox } from "../../types/common.js";
import { createTabClient } from "./cdp-client.js";
import { listTargets } from "./targets.js";

type TargetQuery = {
  elementRef?: string;
  selector?: string;
  textQuery?: string;
  frameId?: string;
};

type ResolvedNode = {
  frameId: string;
  loaderId: string;
  backendNodeId: number;
  selectorHints: string[];
  role?: string;
  name?: string;
  textHint?: string;
};

type RuntimeJsonResult = {
  type?: string;
  value?: unknown;
};

async function withTab<T>(session: BrowserSession, tabId: string, fn: (client: Awaited<ReturnType<typeof createTabClient>>) => Promise<T>): Promise<T> {
  const client = await createTabClient(session.endpoint, tabId);
  try {
    await Promise.all([client.Page.enable(), client.DOM.enable(), client.Runtime.enable(), client.Network.enable()]);
    return await fn(client);
  } finally {
    await client.close();
  }
}

export async function listTabsForSession(session: BrowserSession): Promise<BrowserTargetSummary[]> {
  return listTargets(session.endpoint);
}

export async function navigate(session: BrowserSession, tabId: string, url: string, waitUntil: "domcontentloaded" | "load" = "load", timeoutMs = 15000): Promise<{ url: string; title: string }> {
  return withTab(session, tabId, async (client) => {
    const wait = waitForLifecycle(client, waitUntil, timeoutMs);
    await client.Page.navigate({ url });
    await wait;
    return getPageInfo(client);
  });
}

export async function goBack(session: BrowserSession, tabId: string): Promise<{ url: string; title: string }> {
  return withTab(session, tabId, async (client) => {
    const wait = waitForLifecycle(client, "load", 15000);
    await client.Runtime.evaluate({ expression: "history.back()", returnByValue: true });
    await wait;
    return getPageInfo(client);
  });
}

export async function goForward(session: BrowserSession, tabId: string): Promise<{ url: string; title: string }> {
  return withTab(session, tabId, async (client) => {
    const wait = waitForLifecycle(client, "load", 15000);
    await client.Runtime.evaluate({ expression: "history.forward()", returnByValue: true });
    await wait;
    return getPageInfo(client);
  });
}

export async function reload(session: BrowserSession, tabId: string): Promise<{ url: string; title: string }> {
  return withTab(session, tabId, async (client) => {
    const wait = waitForLifecycle(client, "load", 15000);
    await client.Page.reload({ ignoreCache: false });
    await wait;
    return getPageInfo(client);
  });
}

export async function waitForCondition(session: BrowserSession, tabId: string, condition: { selector?: string; text?: string; urlIncludes?: string }, timeoutMs = 15000): Promise<{ matched: string }> {
  return withTab(session, tabId, async (client) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (condition.selector) {
        const result = await evaluateJson(client, `Boolean(document.querySelector(${JSON.stringify(condition.selector)}))`);
        if (result.value === true) {
          return { matched: "selector" };
        }
      }
      if (condition.text) {
        const result = await evaluateJson(client, `document.body?.innerText?.includes(${JSON.stringify(condition.text)}) ?? false`);
        if (result.value === true) {
          return { matched: "text" };
        }
      }
      if (condition.urlIncludes) {
        const info = await getPageInfo(client);
        if (info.url.includes(condition.urlIncludes)) {
          return { matched: "urlIncludes" };
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    throw new ToolError("WAIT_TIMEOUT", `Condition did not match within ${timeoutMs}ms`, true, condition);
  });
}

export async function snapshotPage(sessionManager: SessionManager, session: BrowserSession, tabId: string, config: ServerConfig): Promise<PageSnapshot> {
  sessionManager.clearTabRefs(session.sessionId, tabId);
  return withTab(session, tabId, async (client) => {
    const pageInfo = await getPageInfo(client);
    const viewport = await client.Page.getLayoutMetrics();
    const snapshotResult = await evaluateJson(
      client,
      `(() => {
        const interactiveSelector = 'a,button,input,select,textarea,[role="button"],[role="link"],[role="textbox"],[tabindex]';
        const interactive = Array.from(document.querySelectorAll(interactiveSelector)).slice(0, ${config.maxSnapshotElements});
        const headings = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).slice(0, 20).map((el) => ({
          level: Number(el.tagName[1]),
          text: (el.innerText || '').trim().slice(0, 500)
        })).filter((item) => item.text);
        const textSummary = (document.body?.innerText || '')
          .split(/\\n+/)
          .map((part) => part.trim())
          .filter(Boolean)
          .slice(0, 20);
        return {
          textSummary,
          headings,
          elements: interactive.map((el) => {
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            const visible = style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
            const selectorHints = [];
            if (el.id) selectorHints.push('#' + el.id);
            selectorHints.push(el.tagName.toLowerCase());
            if (el.getAttribute('name')) selectorHints.push(el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]');
            if (el.getAttribute('type')) selectorHints.push(el.tagName.toLowerCase() + '[type="' + el.getAttribute('type') + '"]');
            return {
              kind: el.tagName.toLowerCase(),
              role: el.getAttribute('role') || undefined,
              name: el.getAttribute('aria-label') || el.getAttribute('name') || undefined,
              text: (el.innerText || el.textContent || '').trim().slice(0, 300),
              visible,
              enabled: !('disabled' in el) || !el.disabled,
              bbox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
              selectorHints
            };
          })
        };
      })()`
    );

    const raw = snapshotResult.value as {
      textSummary: string[];
      headings: Array<{ level: number; text: string }>;
      elements: Array<{
        kind: string;
        role?: string;
        name?: string;
        text?: string;
        visible: boolean;
        enabled: boolean;
        bbox?: BoundingBox;
        selectorHints: string[];
      }>;
    };

    const documentResult = await client.DOM.getDocument({ depth: -1 });
    const frameId = documentResult.root.frameId ?? "main";
    const loaderId = "current";
    const elements = raw.elements.map((element) => {
      const ref = sessionManager.registerElementRef({
        sessionId: session.sessionId,
        tabId,
        frameId,
        loaderId,
        selectorHints: element.selectorHints,
        textHint: element.text,
        role: element.role,
        name: element.name
      });
      return {
        ref: ref.elementRef,
        kind: element.kind,
        role: element.role,
        name: element.name,
        text: element.text,
        selectorHints: element.selectorHints,
        visible: element.visible,
        enabled: element.enabled,
        frameId,
        bbox: element.bbox
      };
    });

    return {
      url: pageInfo.url,
      title: pageInfo.title,
      viewport: {
        width: Math.round(viewport.layoutViewport.clientWidth),
        height: Math.round(viewport.layoutViewport.clientHeight)
      },
      mainFrame: {
        textSummary: raw.textSummary
      },
      headings: raw.headings,
      elements
    };
  });
}

export async function getText(session: BrowserSession, tabId: string, target: TargetQuery | undefined, maxChars: number): Promise<{ text: string }> {
  return withTab(session, tabId, async (client) => {
    const selector = target?.selector ? JSON.stringify(target.selector) : "null";
    const result = await evaluateJson(
      client,
      `(() => {
        const root = ${selector} ? document.querySelector(${selector}) : document.body;
        if (!root) return null;
        return (root.innerText || root.textContent || '').slice(0, ${maxChars});
      })()`
    );

    if (typeof result.value !== "string") {
      throw new ToolError("ELEMENT_NOT_FOUND", "No matching scope was found for text extraction");
    }

    return { text: result.value };
  });
}

export async function getHtml(session: BrowserSession, tabId: string, target: TargetQuery | undefined, maxChars: number, mode: "outerHTML" | "innerHTML"): Promise<{ html: string }> {
  return withTab(session, tabId, async (client) => {
    if (!target?.selector) {
      throw new ToolError("INVALID_ARGUMENT", "browser_get_html requires target.selector");
    }

    const result = await evaluateJson(
      client,
      `(() => {
        const el = document.querySelector(${JSON.stringify(target.selector)});
        if (!el) return null;
        return String(el.${mode}).slice(0, ${maxChars});
      })()`
    );

    if (typeof result.value !== "string") {
      throw new ToolError("ELEMENT_NOT_FOUND", "No matching scope was found for HTML extraction");
    }

    return { html: result.value };
  });
}

export async function evaluateExpression(session: BrowserSession, tabId: string, expression: string, config: ServerConfig): Promise<{ value: unknown }> {
  if (!config.allowEval) {
    throw new ToolError("EVAL_DISABLED", "Evaluation is disabled by server configuration");
  }

  return withTab(session, tabId, async (client) => {
    const result = await evaluateJson(client, expression);
    const normalized = JSON.stringify(result.value);
    if ((normalized?.length ?? 0) > config.maxEvalResultChars) {
      throw new ToolError("INVALID_ARGUMENT", "Evaluation result exceeded the configured size limit");
    }
    return { value: result.value };
  });
}

export async function click(sessionManager: SessionManager, session: BrowserSession, tabId: string, target: TargetQuery): Promise<{ clicked: true }> {
  return withTab(session, tabId, async (client) => {
    const resolved = await resolveTarget(sessionManager, client, session.sessionId, tabId, target);
    const box = await getBoxCenter(client, resolved.backendNodeId);
    await client.Input.dispatchMouseEvent({ type: "mouseMoved", x: box.x, y: box.y });
    await client.Input.dispatchMouseEvent({ type: "mousePressed", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await client.Input.dispatchMouseEvent({ type: "mouseReleased", x: box.x, y: box.y, button: "left", clickCount: 1 });
    return { clicked: true };
  });
}

export async function typeText(sessionManager: SessionManager, session: BrowserSession, tabId: string, target: TargetQuery, text: string, clearFirst: boolean): Promise<{ typed: true }> {
  return withTab(session, tabId, async (client) => {
    const resolved = await resolveTarget(sessionManager, client, session.sessionId, tabId, target);
    const { object } = await client.DOM.resolveNode({ backendNodeId: resolved.backendNodeId });
    if (!object.objectId) {
      throw new ToolError("ELEMENT_NOT_INTERACTABLE", "Could not resolve target node to a DOM object");
    }

    await client.Runtime.callFunctionOn({
      objectId: object.objectId,
      functionDeclaration: `function(clearFirst, text) {
        this.focus();
        if (clearFirst && 'value' in this) this.value = '';
        if ('value' in this) {
          this.value = (this.value || '') + text;
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }`,
      arguments: [{ value: clearFirst }, { value: text }],
      awaitPromise: true,
      returnByValue: true
    });
    return { typed: true };
  });
}

export async function pressKey(session: BrowserSession, tabId: string, key: string): Promise<{ pressed: true }> {
  return withTab(session, tabId, async (client) => {
    const keyDef = resolveKeyDefinition(key);
    await dispatchKey(client, keyDef);
    return { pressed: true };
  });
}

export async function getCurrentUrl(session: BrowserSession, tabId: string): Promise<string> {
  return withTab(session, tabId, async (client) => {
    const info = await getPageInfo(client);
    return info.url;
  });
}

export async function getPdfViewerState(session: BrowserSession, tabId: string): Promise<{
  isPdfViewer: boolean;
  currentPage?: number;
  pageCount?: number;
  zoomPercent?: number;
  viewerUrl: string;
}> {
  return withTab(session, tabId, async (client) => {
    const info = await getPageInfo(client);
    const result = await evaluateJson(
      client,
      `(() => {
        const walk = (root, predicate) => {
          if (!root) return null;
          const stack = [root];
          while (stack.length) {
            const node = stack.pop();
            if (!(node instanceof Element || node instanceof Document || node instanceof ShadowRoot)) {
              continue;
            }
            if (node instanceof Element && predicate(node)) {
              return node;
            }
            const children = [];
            if ('children' in node && node.children) {
              children.push(...Array.from(node.children));
            }
            for (const child of children) {
              stack.push(child);
              if (child.shadowRoot) {
                stack.push(child.shadowRoot);
              }
            }
          }
          return null;
        };

        const byId = (id) => walk(document, (el) => el.id === id);
        const byLabel = (term) => walk(document, (el) => {
          const label = [el.id, el.getAttribute('aria-label'), el.getAttribute('title'), el.getAttribute('placeholder'), el.className].filter(Boolean).join(' ').toLowerCase();
          return label.includes(term);
        });

        const viewer = walk(document, (el) => el.tagName.toLowerCase() === 'pdf-viewer');
        const pageInput = byId('page-number') || byId('pageNumber') || byLabel('page number');
        const pagesEl = byId('page-count') || byId('pageCount') || byId('pageIndicator') || byLabel('page count') || byLabel('pagelength');
        const zoomEl = byId('zoom-toolbar') || byId('zoom-input') || byLabel('zoom');
        const hasEmbed = Boolean(document.querySelector('embed[type="application/pdf"], iframe[src*=".pdf"], pdf-viewer, viewer-toolbar')) || Boolean(viewer);

        const currentPageRaw = pageInput ? (pageInput.value ?? pageInput.textContent ?? '') : '';
        const pageCountRaw = pagesEl ? (pagesEl.value ?? pagesEl.textContent ?? '') : '';
        const pageIndicatorText = [currentPageRaw, pageCountRaw].filter(Boolean).join(' ');
        const zoomRaw = zoomEl ? (zoomEl.value ?? zoomEl.textContent ?? '') : '';
        const parseNumber = (value) => {
          const match = String(value).match(/\\d+/);
          return match ? Number(match[0]) : undefined;
        };
        const parsePageCount = (value) => {
          const match = String(value).match(/(?:\\/|of)\\s*(\\d+)/i);
          return match ? Number(match[1]) : parseNumber(value);
        };
        const fragmentPage = new URL(location.href).hash.match(/[?#&]page=(\\d+)/i)?.[1];
        const pluginPage = viewer && 'pageNo' in viewer ? Number(viewer.pageNo) : undefined;
        const pluginPages = viewer && 'docLength' in viewer ? Number(viewer.docLength) : undefined;

        return {
          isPdfViewer: hasEmbed || String(location.href).toLowerCase().includes('.pdf'),
          currentPage: pluginPage ?? parseNumber(currentPageRaw) ?? parseNumber(pageIndicatorText) ?? (fragmentPage ? Number(fragmentPage) : undefined),
          pageCount: pluginPages ?? parsePageCount(pageCountRaw) ?? parsePageCount(pageIndicatorText),
          zoomPercent: parseNumber(zoomRaw)
        };
      })()`
    );

    const value = (result.value ?? {}) as {
      isPdfViewer?: boolean;
      currentPage?: number;
      pageCount?: number;
      zoomPercent?: number;
    };

    return {
      isPdfViewer: value.isPdfViewer ?? false,
      currentPage: value.currentPage,
      pageCount: value.pageCount,
      zoomPercent: value.zoomPercent,
      viewerUrl: info.url
    };
  });
}

export async function pdfNextPage(session: BrowserSession, tabId: string): Promise<{ advanced: boolean; currentPage?: number; pageCount?: number }> {
  return withTab(session, tabId, async (client) => {
    await advancePdfViewer(client, "next");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const state = await getPdfViewerState(session, tabId);
    return {
      advanced: true,
      currentPage: state.currentPage,
      pageCount: state.pageCount
    };
  });
}

export async function pdfPrevPage(session: BrowserSession, tabId: string): Promise<{ advanced: boolean; currentPage?: number; pageCount?: number }> {
  return withTab(session, tabId, async (client) => {
    await advancePdfViewer(client, "prev");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const state = await getPdfViewerState(session, tabId);
    return {
      advanced: true,
      currentPage: state.currentPage,
      pageCount: state.pageCount
    };
  });
}

export async function scrollPage(session: BrowserSession, tabId: string, deltaX: number, deltaY: number): Promise<{ scrolled: true }> {
  return withTab(session, tabId, async (client) => {
    await client.Runtime.evaluate({
      expression: `window.scrollBy(${deltaX}, ${deltaY});`,
      awaitPromise: false,
      returnByValue: true
    });
    return { scrolled: true };
  });
}

export async function takeScreenshot(session: BrowserSession, tabId: string, screenshotDir: string, nameHint?: string): Promise<{ path: string; format: "png" }> {
  return withTab(session, tabId, async (client) => {
    await fs.mkdir(screenshotDir, { recursive: true });
    const result = await client.Page.captureScreenshot({ format: "png", fromSurface: true });
    const filename = `${nameHint ?? "screenshot"}-${Date.now()}.png`;
    const filePath = path.join(screenshotDir, filename);
    await fs.writeFile(filePath, Buffer.from(result.data, "base64"));
    return { path: filePath, format: "png" };
  });
}

export async function getCookies(session: BrowserSession, tabId: string): Promise<{ cookies: unknown[] }> {
  return withTab(session, tabId, async (client) => {
    const result = await client.Network.getCookies({});
    return { cookies: result.cookies };
  });
}

export async function setCookies(session: BrowserSession, tabId: string, cookies: Array<Record<string, unknown>>): Promise<{ set: number }> {
  return withTab(session, tabId, async (client) => {
    let count = 0;
    for (const cookie of cookies) {
      const result = await client.Network.setCookie(cookie as never);
      if (result.success) {
        count += 1;
      }
    }
    return { set: count };
  });
}

export async function getStorage(session: BrowserSession, tabId: string, kind: "localStorage" | "sessionStorage"): Promise<{ entries: Record<string, string> }> {
  return withTab(session, tabId, async (client) => {
    const result = await evaluateJson(client, `Object.fromEntries(Object.entries(${kind}).map(([key, value]) => [key, String(value)]))`);
    return { entries: (result.value as Record<string, string>) ?? {} };
  });
}

export async function setStorage(session: BrowserSession, tabId: string, kind: "localStorage" | "sessionStorage", entries: Record<string, string>): Promise<{ set: number }> {
  return withTab(session, tabId, async (client) => {
    await client.Runtime.evaluate({
      expression: `(() => {
        const entries = ${JSON.stringify(entries)};
        for (const [key, value] of Object.entries(entries)) {
          ${kind}.setItem(key, value);
        }
      })()`,
      awaitPromise: true,
      returnByValue: true
    });
    return { set: Object.keys(entries).length };
  });
}

async function getPageInfo(client: Awaited<ReturnType<typeof createTabClient>>): Promise<{ url: string; title: string }> {
  const result = await evaluateJson(client, `({ url: location.href, title: document.title })`);
  const value = (result.value ?? {}) as { url?: string; title?: string };
  return {
    url: value.url ?? "",
    title: value.title ?? ""
  };
}

async function waitForLifecycle(client: Awaited<ReturnType<typeof createTabClient>>, waitUntil: "domcontentloaded" | "load", timeoutMs: number): Promise<void> {
  const eventName = waitUntil === "domcontentloaded" ? "domContentEventFired" : "loadEventFired";
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new ToolError("NAVIGATION_TIMEOUT", `Navigation did not reach ${waitUntil} within ${timeoutMs}ms`, true)), timeoutMs);
    const handler = () => {
      clearTimeout(timeout);
      resolve();
    };
    if (eventName === "domContentEventFired") {
      client.Page.domContentEventFired(handler);
    } else {
      client.Page.loadEventFired(handler);
    }
  });
}

async function resolveTarget(sessionManager: SessionManager, client: Awaited<ReturnType<typeof createTabClient>>, sessionId: string, tabId: string, target: TargetQuery): Promise<ResolvedNode> {
  if (target.elementRef) {
    const record = sessionManager.getElementRef(target.elementRef);
    if (record.sessionId !== sessionId || record.tabId !== tabId) {
      throw new ToolError("ELEMENT_REF_STALE", "Element reference belongs to a different session or tab");
    }
    if (record.backendNodeId) {
      return {
        frameId: record.frameId,
        loaderId: record.loaderId,
        backendNodeId: record.backendNodeId,
        selectorHints: record.selectorHints,
        role: record.role,
        name: record.name,
        textHint: record.textHint
      };
    }
    if (record.selectorHints.length > 0) {
      return resolveBySelector(client, record.selectorHints[0]!, record.frameId);
    }
    throw new ToolError("ELEMENT_REF_STALE", "Element reference can no longer be resolved");
  }

  if (target.selector) {
    return resolveBySelector(client, target.selector, target.frameId);
  }

  if (target.textQuery) {
    return resolveByText(client, target.textQuery);
  }

  throw new ToolError("INVALID_ARGUMENT", "Target requires elementRef, selector, or textQuery");
}

async function resolveBySelector(client: Awaited<ReturnType<typeof createTabClient>>, selector: string, frameId?: string): Promise<ResolvedNode> {
  const root = await client.DOM.getDocument({ depth: -1 });
  const node = await client.DOM.querySelector({
    nodeId: root.root.nodeId,
    selector
  });
  if (!node.nodeId) {
    throw new ToolError("SELECTOR_NOT_FOUND", `Selector ${selector} did not match any element`);
  }
  const described = await client.DOM.describeNode({ nodeId: node.nodeId });
  return {
    frameId: frameId ?? described.node.frameId ?? "main",
    loaderId: "current",
    backendNodeId: described.node.backendNodeId,
    selectorHints: [selector]
  };
}

async function resolveByText(client: Awaited<ReturnType<typeof createTabClient>>, textQuery: string): Promise<ResolvedNode> {
  const root = await client.DOM.getDocument({ depth: -1 });
  const result = await evaluateJson(
    client,
    `(() => {
      const candidates = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[role="link"]'));
      const target = candidates.find((el) => (el.innerText || el.textContent || '').includes(${JSON.stringify(textQuery)}));
      if (!target) return null;
      if (target.id) return '#' + target.id;
      return target.tagName.toLowerCase();
    })()`
  );
  if (typeof result.value !== "string") {
    throw new ToolError("ELEMENT_NOT_FOUND", `No visible element matched text query ${textQuery}`);
  }
  return resolveBySelector(client, result.value, root.root.frameId);
}

async function getBoxCenter(client: Awaited<ReturnType<typeof createTabClient>>, backendNodeId: number): Promise<{ x: number; y: number }> {
  const box = await client.DOM.getBoxModel({ backendNodeId });
  const quad = box.model.content;
  return {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4
  };
}

async function evaluateJson(client: Awaited<ReturnType<typeof createTabClient>>, expression: string): Promise<RuntimeJsonResult> {
  const result = await client.Runtime.evaluate({
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return result.result as RuntimeJsonResult;
}

async function advancePdfViewer(client: Awaited<ReturnType<typeof createTabClient>>, direction: "next" | "prev"): Promise<void> {
  const clicked = await evaluateJson(
    client,
    `(() => {
      const walk = (root, predicate) => {
        if (!root) return null;
        const stack = [root];
        while (stack.length) {
          const node = stack.pop();
          if (!(node instanceof Element || node instanceof Document || node instanceof ShadowRoot)) {
            continue;
          }
          if (node instanceof Element && predicate(node)) {
            return node;
          }
          const children = [];
          if ('children' in node && node.children) {
            children.push(...Array.from(node.children));
          }
          for (const child of children) {
            stack.push(child);
            if (child.shadowRoot) {
              stack.push(child.shadowRoot);
            }
          }
        }
        return null;
      };

      const terms = ${JSON.stringify(direction === "next" ? ["next", "next page"] : ["previous", "prev", "previous page"])}.map((part) => part.toLowerCase());
      const target = walk(document, (el) => {
        const text = [el.id, el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent].filter(Boolean).join(' ').toLowerCase();
        return el instanceof HTMLButtonElement && terms.some((term) => text.includes(term));
      });
      if (target instanceof HTMLElement) {
        target.click();
        return true;
      }
      return false;
    })()`
  );

  if (clicked.value === true) {
    return;
  }

  const fallbackKey = direction === "next" ? resolveKeyDefinition("PageDown") : resolveKeyDefinition("PageUp");
  await dispatchKey(client, fallbackKey);
}

async function dispatchKey(client: Awaited<ReturnType<typeof createTabClient>>, keyDef: { key: string; code: string; windowsVirtualKeyCode: number }): Promise<void> {
  await client.Input.dispatchKeyEvent({
    type: "keyDown",
    key: keyDef.key,
    code: keyDef.code,
    windowsVirtualKeyCode: keyDef.windowsVirtualKeyCode,
    nativeVirtualKeyCode: keyDef.windowsVirtualKeyCode
  });
  await client.Input.dispatchKeyEvent({
    type: "keyUp",
    key: keyDef.key,
    code: keyDef.code,
    windowsVirtualKeyCode: keyDef.windowsVirtualKeyCode,
    nativeVirtualKeyCode: keyDef.windowsVirtualKeyCode
  });
}

function resolveKeyDefinition(input: string): { key: string; code: string; windowsVirtualKeyCode: number } {
  const normalized = input.toLowerCase();
  const known: Record<string, { key: string; code: string; windowsVirtualKeyCode: number }> = {
    pagedown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
    pageup: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
    arrowright: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
    arrowleft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
    enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 },
    tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
    escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
    space: { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
    " ": { key: " ", code: "Space", windowsVirtualKeyCode: 32 },
    home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
    end: { key: "End", code: "End", windowsVirtualKeyCode: 35 }
  };

  if (known[normalized]) {
    return known[normalized];
  }

  if (input.length === 1) {
    return {
      key: input,
      code: `Key${input.toUpperCase()}`,
      windowsVirtualKeyCode: input.toUpperCase().charCodeAt(0)
    };
  }

  return {
    key: input,
    code: input,
    windowsVirtualKeyCode: 0
  };
}
