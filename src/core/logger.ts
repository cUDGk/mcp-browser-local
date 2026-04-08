import type { ServerConfig } from "../config.js";

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
} as const;

export class Logger {
  constructor(private readonly config: ServerConfig) {}

  private shouldLog(level: keyof typeof levels): boolean {
    return levels[level] <= levels[this.config.logLevel];
  }

  log(level: keyof typeof levels, message: string, details?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const payload = details ? ` ${JSON.stringify(details)}` : "";
    process.stderr.write(`[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${payload}\n`);
  }

  error(message: string, details?: Record<string, unknown>): void {
    this.log("error", message, details);
  }

  warn(message: string, details?: Record<string, unknown>): void {
    this.log("warn", message, details);
  }

  info(message: string, details?: Record<string, unknown>): void {
    this.log("info", message, details);
  }

  debug(message: string, details?: Record<string, unknown>): void {
    this.log("debug", message, details);
  }
}
