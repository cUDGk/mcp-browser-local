import { createRequire } from "node:module";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "./context.js";
import { toolDefinitions } from "../tools/definitions.js";
import { runTool } from "../tools/helpers.js";
import { callTool } from "./tool-router.js";

// U12: pull the version from package.json instead of duplicating a literal.
// U16: surface why we fell back to "0.0.0" so a misconfigured build is debuggable;
// stderr keeps the stdio MCP transport (stdout) clean.
function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch (error) {
    process.stderr.write(`mcp-browser-local: failed to read package.json version, falling back to 0.0.0 (${error instanceof Error ? error.message : String(error)})\n`);
    return "0.0.0";
  }
}

export async function startServer(context: ServerContext): Promise<void> {
  const server = new Server(
    {
      name: "mcp-browser-local",
      version: readVersion()
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toolDefinitions.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    // B22: defense-in-depth — even if callTool throws, return a structured envelope.
    let result;
    try {
      result = await callTool(context, request.params.name, request.params.arguments ?? {});
    } catch (error) {
      result = await runTool({}, async () => {
        throw error;
      });
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2)
        }
      ],
      isError: !result.ok
    };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // B25: graceful shutdown — close all sessions on SIGINT/SIGTERM.
  // B7: process.exit is now the caller's responsibility so callers can `await` this.
  const shutdown = async (signal: string) => {
    context.logger.info(`shutdown signal received: ${signal}`);
    for (const sessionId of context.sessions.listSessionIds()) {
      try {
        await context.sessions.deleteSession(sessionId);
      } catch (error) {
        context.logger.warn("session cleanup failed during shutdown", {
          sessionId,
          cause: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };
  // B7: actually wait for shutdown() to finish (including child kills + temp dir cleanup)
  // before exiting, otherwise process.exit fires while sessions are still teardown-ing
  // and we leave zombie browsers + orphaned profile dirs behind.
  process.once("SIGINT", () => {
    shutdown("SIGINT").then(
      () => process.exit(0),
      (error) => {
        context.logger.warn("shutdown failed", {
          cause: error instanceof Error ? error.message : String(error)
        });
        process.exit(1);
      }
    );
  });
  process.once("SIGTERM", () => {
    shutdown("SIGTERM").then(
      () => process.exit(0),
      (error) => {
        context.logger.warn("shutdown failed", {
          cause: error instanceof Error ? error.message : String(error)
        });
        process.exit(1);
      }
    );
  });
}
