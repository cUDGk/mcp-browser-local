import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import type { ServerConfig } from "../config.js";
import { ToolError } from "./errors.js";
import { Logger } from "./logger.js";
import type { BrowserSession, ElementRefRecord, ManagedPdfState, ManagedTabRecord } from "../types/session.js";

type ManagedSession = BrowserSession & {
  childProcess?: ChildProcess;
  consoleLogs: Array<Record<string, unknown>>;
  networkLogs: Array<Record<string, unknown>>;
  managedTabs: Map<string, ManagedTabRecord>;
};

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  // Use insertion-ordered Map so we can FIFO-evict element refs (S9).
  private readonly elementRefs = new Map<string, ElementRefRecord>();
  private readonly logger: Logger;
  private readonly config: ServerConfig;

  constructor(config: ServerConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
  }

  createSession(session: Omit<ManagedSession, "sessionId" | "createdAt" | "consoleLogs" | "networkLogs">): ManagedSession {
    // S9: cap concurrent sessions.
    if (this.sessions.size >= this.config.maxSessions) {
      throw new ToolError("RESOURCE_LIMIT", `session count exceeds cap (${this.config.maxSessions})`);
    }
    const managed: ManagedSession = {
      ...session,
      sessionId: `s_${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      consoleLogs: [],
      networkLogs: [],
      managedTabs: session.managedTabs ?? new Map()
    };
    this.sessions.set(managed.sessionId, managed);
    return managed;
  }

  listSessions(): BrowserSession[] {
    return [...this.sessions.values()].map(({ childProcess: _childProcess, consoleLogs: _consoleLogs, networkLogs: _networkLogs, managedTabs: _managedTabs, ...session }) => session);
  }

  getSession(sessionId: string): ManagedSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new ToolError("SESSION_NOT_FOUND", `Session ${sessionId} was not found`);
    }
    return session;
  }

  // B11: tear down child + temp profile dir on session removal.
  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    if (session.childProcess && !session.childProcess.killed) {
      const pid = session.childProcess.pid;
      try {
        if (process.platform === "win32" && pid) {
          await new Promise<void>((resolve) => {
            execFile("taskkill.exe", ["/T", "/F", "/PID", String(pid)], { windowsHide: true }, () => resolve());
          });
        } else {
          session.childProcess.kill("SIGTERM");
          // B1: on POSIX, kill() returns synchronously but the child may still hold the
          // profile dir for a beat. Wait (with deadline) for "exit" so the rm below sees
          // a quiescent file tree.
          await new Promise<void>((resolve) => {
            const t = setTimeout(resolve, 3000);
            session.childProcess!.once("exit", () => {
              clearTimeout(t);
              resolve();
            });
          });
        }
      } catch (error) {
        this.logger.warn("failed to kill browser child", {
          sessionId,
          cause: error instanceof Error ? error.message : String(error)
        });
      }
    }
    // Remove temp profile dir if it lives under our tempDir.
    // S9: resolve real paths on both sides — a symlink under tempDir pointing at $HOME
    // would otherwise let us recursively rm the user's home directory.
    if (session.profileMode === "isolated" && session.profilePath) {
      try {
        const realProfile = await fs.realpath(path.resolve(session.profilePath));
        const realTemp = await fs.realpath(path.resolve(this.config.tempDir));
        const isWin = process.platform === "win32";
        const rel = path.relative(isWin ? realTemp.toLowerCase() : realTemp, isWin ? realProfile.toLowerCase() : realProfile);
        if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
          await fs.rm(realProfile, { recursive: true, force: true });
        } else {
          this.logger.warn("skipping profile cleanup: not under tempDir", {
            sessionId,
            profilePath: realProfile
          });
        }
      } catch (error) {
        // realpath() failure (missing path / permission denied) means we can't
        // safely confirm containment — skip the rm rather than fall back to an
        // unresolved path.
        this.logger.warn("failed to remove profile temp dir", {
          sessionId,
          profilePath: session.profilePath,
          cause: error instanceof Error ? error.message : String(error)
        });
      }
    }
    this.sessions.delete(sessionId);
    for (const [key, elementRef] of this.elementRefs.entries()) {
      if (elementRef.sessionId === sessionId) {
        this.elementRefs.delete(key);
      }
    }
  }

  setActiveTab(sessionId: string, tabId: string): void {
    const session = this.getSession(sessionId);
    if (!session.managedTabs.has(tabId)) {
      // S9: cap tabs per session — check BEFORE setting activeTabId so we don't
      // advance the pointer when the cap check would reject the new tab.
      if (session.managedTabs.size >= this.config.maxTabsPerSession) {
        throw new ToolError("RESOURCE_LIMIT", `tab count exceeds cap (${this.config.maxTabsPerSession})`);
      }
      session.managedTabs.set(tabId, {
        tabId,
        createdAt: new Date().toISOString(),
        openedByMcp: false,
        notes: []
      });
    }
    session.activeTabId = tabId;
  }

  registerTab(sessionId: string, tabId: string, openedByMcp: boolean, note?: string, url?: string): ManagedTabRecord {
    const session = this.getSession(sessionId);
    const existing = session.managedTabs.get(tabId);
    if (!existing && session.managedTabs.size >= this.config.maxTabsPerSession) {
      throw new ToolError("RESOURCE_LIMIT", `tab count exceeds cap (${this.config.maxTabsPerSession})`);
    }
    const record: ManagedTabRecord = existing ?? {
      tabId,
      createdAt: new Date().toISOString(),
      openedByMcp,
      notes: []
    };
    record.openedByMcp = record.openedByMcp || openedByMcp;
    if (url !== undefined) {
      record.lastKnownUrl = url;
    }
    if (note) {
      this.pushNote(record, note);
    }
    session.managedTabs.set(tabId, record);
    return record;
  }

  // S9: ring-buffer notes per tab.
  private pushNote(record: ManagedTabRecord, note: string): void {
    record.notes.push(note);
    const cap = this.config.maxNotesPerTab;
    if (record.notes.length > cap) {
      record.notes.splice(0, record.notes.length - cap);
    }
  }

  addTabNote(sessionId: string, tabId: string, note: string): ManagedTabRecord {
    const session = this.getSession(sessionId);
    const record = session.managedTabs.get(tabId) ?? this.registerTab(sessionId, tabId, false);
    this.pushNote(record, note);
    session.managedTabs.set(tabId, record);
    return record;
  }

  // B27: only update lastKnownUrl when the URL is non-empty.
  updateTabUrl(sessionId: string, tabId: string, url: string): void {
    if (!url) return;
    const record = this.registerTab(sessionId, tabId, false);
    record.lastKnownUrl = url;
  }

  updatePdfState(sessionId: string, tabId: string, state: Partial<ManagedPdfState>): ManagedPdfState {
    const record = this.registerTab(sessionId, tabId, false);
    const nextState: ManagedPdfState = {
      sourceUrl: state.sourceUrl ?? record.pdfState?.sourceUrl,
      currentPage: state.currentPage ?? record.pdfState?.currentPage,
      pageCount: state.pageCount ?? record.pdfState?.pageCount,
      zoomPercent: state.zoomPercent ?? record.pdfState?.zoomPercent,
      lastUpdatedAt: new Date().toISOString()
    };
    record.pdfState = nextState;
    return nextState;
  }

  getPdfState(sessionId: string, tabId: string): ManagedPdfState | undefined {
    return this.getSession(sessionId).managedTabs.get(tabId)?.pdfState;
  }

  listManagedTabs(sessionId: string): ManagedTabRecord[] {
    const session = this.getSession(sessionId);
    return [...session.managedTabs.values()];
  }

  markTabClosed(sessionId: string, tabId: string): void {
    const session = this.getSession(sessionId);
    const record = session.managedTabs.get(tabId);
    if (record) {
      record.closedAt = new Date().toISOString();
    }
  }

  registerElementRef(ref: Omit<ElementRefRecord, "elementRef" | "createdAt">): ElementRefRecord {
    // S9: FIFO-evict oldest elementRef when over cap.
    while (this.elementRefs.size >= this.config.maxElementRefs) {
      const oldestKey = this.elementRefs.keys().next().value;
      if (oldestKey === undefined) break;
      this.elementRefs.delete(oldestKey);
    }
    const elementRef: ElementRefRecord = {
      ...ref,
      elementRef: `e_${crypto.randomUUID()}`,
      createdAt: new Date().toISOString()
    };
    this.elementRefs.set(elementRef.elementRef, elementRef);
    return elementRef;
  }

  getElementRef(elementRef: string): ElementRefRecord {
    const record = this.elementRefs.get(elementRef);
    if (!record) {
      throw new ToolError("ELEMENT_REF_STALE", `Element reference ${elementRef} is no longer valid`);
    }
    return record;
  }

  clearTabRefs(sessionId: string, tabId: string): void {
    for (const [key, record] of this.elementRefs.entries()) {
      if (record.sessionId === sessionId && record.tabId === tabId) {
        this.elementRefs.delete(key);
      }
    }
  }

  listSessionIds(): string[] {
    return [...this.sessions.keys()];
  }
}
