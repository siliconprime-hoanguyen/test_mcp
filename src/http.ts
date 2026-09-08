import { createServer as createNodeServer, type Server } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";

import { getListTickets, ticketListInputSchema } from "./tickets.js";

function createMcpServer(): McpServer {
  const server = new McpServer({ name: "ticket-mock-mcp", version: "1.0.0" });

  server.registerTool(
    "get_list_tickets",
    {
      title: "Get mock tickets",
      description: "Return configurable mock tickets with 2 KiB detail fields and an optional delay.",
      inputSchema: ticketListInputSchema,
    },
    async (input) => {
      const result = await getListTickets(input);

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );

  return server;
}

export function createHttpServer(): Server {
  const mcpHandler = createMcpHandler(createMcpServer);
  const nodeHandler = toNodeHandler(mcpHandler);
  const server = createNodeServer((request, response) => {
    void nodeHandler(request, response);
  });

  server.on("close", () => void mcpHandler.close());
  return server;
}
