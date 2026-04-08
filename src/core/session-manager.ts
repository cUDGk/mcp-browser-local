import crypto from "node:crypto";
import type { ChildProcess } from "node:child_process";
import { ToolError } from "./errors.js";
import type { BrowserSession, ElementRefRecord, ManagedPdfState, ManagedTabRecord } from "../types/session.js";

type ManagedSession = BrowserSession & {
  childProcess?: ChildProcess;
  consoleLogs: Array<Record<string, unknown>>;
  networkLogs: Array<Record<string, unknown>>;
  managedTabs: Map<string, ManagedTabRecord>;
};

export class SessionManager {
  private readonly sessions = new Map<string, ManagedSession>();
  private readonly elementRefs = new Map<string, ElementRefRecord>();

  createSession(session: Omit<ManagedSession, "sessionId" | "createdAt" | "consoleLogs" | "networkLogs">): ManagedSession {
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

  deleteSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    if (session.childProcess && !session.childProcess.killed) {
      session.childProcess.kill();
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
    session.activeTabId = tabId;
    if (!session.managedTabs.has(tabId)) {
      session.managedTabs.set(tabId, {
        tabId,
        createdAt: new Date().toISOString(),
        openedByMcp: false,
        notes: []
      });
    }
  }

  registerTab(sessionId: string, tabId: string, openedByMcp: boolean, note?: string, url?: string): ManagedTabRecord {
    const session = this.getSession(sessionId);
    const existing = session.managedTabs.get(tabId);
    const record: ManagedTabRecord = existing ?? {
      tabId,
      createdAt: new Date().toISOString(),
      openedByMcp,
      notes: []
    };
    record.openedByMcp = record.openedByMcp || openedByMcp;
    record.lastKnownUrl = url ?? record.lastKnownUrl;
    if (note) {
      record.notes.push(note);
    }
    session.managedTabs.set(tabId, record);
    return record;
  }

  addTabNote(sessionId: string, tabId: string, note: string): ManagedTabRecord {
    const session = this.getSession(sessionId);
    const record = session.managedTabs.get(tabId) ?? this.registerTab(sessionId, tabId, false);
    record.notes.push(note);
    session.managedTabs.set(tabId, record);
    return record;
  }

  updateTabUrl(sessionId: string, tabId: string, url: string): void {
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
}
