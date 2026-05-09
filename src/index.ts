import { loadConfig } from "./config.js";
import { createServerContext } from "./server/context.js";
import { startServer } from "./server/create-server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const context = createServerContext(config);
  context.logger.info("Starting mcp-browser-local");
  await startServer(context);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  // B24: hard-exit so the orchestrator sees a non-zero status.
  process.exit(1);
});
