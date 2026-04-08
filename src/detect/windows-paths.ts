import os from "node:os";
import path from "node:path";
import type { BrowserKind } from "../types/common.js";

type BrowserPathConfig = {
  browser: BrowserKind;
  candidates: string[];
  profileRoots: string[];
  channel: "stable" | "beta" | "dev" | "nightly" | "unknown";
};

const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local");
const programFiles = process.env.ProgramFiles ?? "C:\\Program Files";
const programFilesX86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

export const windowsBrowserConfigs: BrowserPathConfig[] = [
  {
    browser: "brave",
    channel: "stable",
    candidates: [
      path.join(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      path.join(programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")
    ],
    profileRoots: [path.join(localAppData, "BraveSoftware", "Brave-Browser", "User Data")]
  },
  {
    browser: "chrome",
    channel: "stable",
    candidates: [
      path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe")
    ],
    profileRoots: [path.join(localAppData, "Google", "Chrome", "User Data")]
  },
  {
    browser: "edge",
    channel: "stable",
    candidates: [
      path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")
    ],
    profileRoots: [path.join(localAppData, "Microsoft", "Edge", "User Data")]
  },
  {
    browser: "chromium",
    channel: "unknown",
    candidates: [path.join(programFiles, "Chromium", "Application", "chrome.exe")],
    profileRoots: [path.join(localAppData, "Chromium", "User Data")]
  }
];
