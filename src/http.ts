import { createServer as createNodeServer, type Server } from "node:http";

import { toNodeHandler } from "@modelcontextprotocol/node";
import {
  createMcpHandler,
  getOAuthProtectedResourceMetadataUrl,
  McpServer,
  oauthMetadataResponse,
  requireBearerAuth,
} from "@modelcontextprotocol/server";

import { MockOAuthServer } from "./oauth.js";
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

export interface HttpServerOptions {
  publicUrl?: URL;
  username?: string;
  password?: string;
}

export function createHttpServer(options: HttpServerOptions = {}): Server {
  const oauth = new MockOAuthServer(options.username, options.password);
  const mcpHandler = createMcpHandler(createMcpServer);
  const nodeHandler = toNodeHandler({
    async fetch(request) {
      const requestUrl = new URL(request.url);
      const issuer = options.publicUrl ?? new URL(requestUrl.origin);
      const mcpUrl = new URL("/mcp", issuer);

      const oauthMetadata = oauth.metadata(issuer);
      const metadata = oauthMetadataResponse(request, {
        oauthMetadata,
        resourceServerUrl: mcpUrl,
        scopesSupported: ["mcp"],
        resourceName: "Ticket mock MCP",
        dangerouslyAllowInsecureIssuerUrl: isLocalhost(issuer),
      });
      if (metadata) return metadata;

      const oauthResponse = await oauth.handle(request, { issuer, mcpUrl });
      if (oauthResponse) return oauthResponse;
      if (requestUrl.pathname !== "/mcp") return new Response("Not found", { status: 404 });

      const requireAuth = requireBearerAuth({
        verifier: { verifyAccessToken: (token) => oauth.verifyAccessToken(token, mcpUrl) },
        requiredScopes: ["mcp"],
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl),
      });
      const authInfo = await requireAuth(request);
      if (authInfo instanceof Response) return authInfo;
      return mcpHandler.fetch(request, { authInfo });
    },
  });
  const server = createNodeServer((request, response) => {
    void nodeHandler(request, response);
  });

  server.on("close", () => void mcpHandler.close());
  return server;
}

function isLocalhost(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
