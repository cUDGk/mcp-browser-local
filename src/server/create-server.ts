import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ServerContext } from "./context.js";
import { toolDefinitions } from "../tools/definitions.js";
import { callTool } from "./tool-router.js";

export async function startServer(context: ServerContext): Promise<void> {
  const server = new Server(
    {
      name: "mcp-browser-local",
      version: "0.1.1"
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
    const result = await callTool(context, request.params.name, request.params.arguments ?? {});
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
}
