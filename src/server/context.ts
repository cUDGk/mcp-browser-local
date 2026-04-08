import type { ServerConfig } from "../config.js";
import { Logger } from "../core/logger.js";
import { SessionManager } from "../core/session-manager.js";

export type ServerContext = {
  config: ServerConfig;
  logger: Logger;
  sessions: SessionManager;
};

export function createServerContext(config: ServerConfig): ServerContext {
  return {
    config,
    logger: new Logger(config),
    sessions: new SessionManager()
  };
}
