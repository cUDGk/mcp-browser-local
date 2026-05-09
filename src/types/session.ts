import type { BrowserKind, ProfileMode, SessionMode } from "./common.js";

export type BrowserEndpoint = {
  host: string;
  port: number;
  browserWSEndpoint?: string;
};

export type BrowserSession = {
  sessionId: string;
  mode: SessionMode;
  browser: BrowserKind;
  executablePath?: string;
  endpoint: BrowserEndpoint;
  processId?: number;
  profileMode: ProfileMode;
  profilePath?: string;
  createdAt: string;
  activeTabId?: string;
  capabilities: {
    pdfExtract: boolean;
    downloadEvents: boolean;
    networkLogs: boolean;
    screenshots: boolean;
  };
};

export type ManagedPdfState = {
  sourceUrl?: string;
  currentPage?: number;
  pageCount?: number;
  zoomPercent?: number;
  lastUpdatedAt: string;
};

export type ManagedTabRecord = {
  tabId: string;
  createdAt: string;
  openedByMcp: boolean;
  closedAt?: string;
  notes: string[];
  lastKnownUrl?: string;
  pdfState?: ManagedPdfState;
};

export type RunningBrowser = {
  processId: number;
  browser: BrowserKind;
  executablePath: string;
  commandLine?: string;
  attachable: boolean;
  reason: string;
  debuggingPort?: number;
};

export type BrowserInstallation = {
  browser: BrowserKind;
  executablePath: string;
  channel: "stable" | "beta" | "dev" | "nightly" | "unknown";
  detectedProfileRoots: string[];
  runningProcesses: number[];
  attachCandidates: number[];
};

export type BrowserTargetSummary = {
  tabId: string;
  windowId?: number;
  title: string;
  url: string;
  type: string;
};

export type ElementRefRecord = {
  elementRef: string;
  sessionId: string;
  tabId: string;
  frameId: string;
  loaderId: string;
  backendNodeId?: number;
  selectorHints: string[];
  textHint?: string;
  role?: string;
  name?: string;
  createdAt: string;
};
