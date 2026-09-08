import {
  createServer as createNodeServer,
  type Server,
  type ServerResponse,
} from "node:http";

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
  oauthClientStorePath?: string;
  logger?: (entry: HttpRequestLog) => void;
}

export interface HttpRequestLog {
  event: "http_request";
  method: string;
  path: string;
  status: number;
  responseBytes: number;
  durationMs: number;
}

export function createHttpServer(options: HttpServerOptions = {}): Server {
  const oauth = new MockOAuthServer(options.username, options.password, options.oauthClientStorePath);
  const mcpHandler = createMcpHandler(createMcpServer);
  const logger = options.logger ?? ((entry: HttpRequestLog) => console.log(JSON.stringify(entry)));
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
    const startedAt = process.hrtime.bigint();
    const responseSize = countResponseBytes(response);
    let logged = false;
    const logRequest = () => {
      if (logged) return;
      logged = true;
      logger({
        event: "http_request",
        method: request.method ?? "UNKNOWN",
        path: new URL(request.url ?? "/", "http://localhost").pathname,
        status: response.statusCode,
        responseBytes: responseSize(),
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1_000_000,
      });
    };
    response.once("finish", logRequest);
    response.once("close", logRequest);
    void nodeHandler(request, response);
  });

  server.on("close", () => void mcpHandler.close());
  return server;
}

function countResponseBytes(response: ServerResponse): () => number {
  let bytes = 0;
  const write = response.write;
  const end = response.end;

  response.write = function (this: ServerResponse, chunk: unknown, ...args: unknown[]) {
    bytes += chunkSize(chunk, args[0]);
    return Reflect.apply(write, this, [chunk, ...args]);
  } as typeof response.write;
  response.end = function (this: ServerResponse, chunk?: unknown, ...args: unknown[]) {
    bytes += chunkSize(chunk, args[0]);
    return Reflect.apply(end, this, [chunk, ...args]);
  } as typeof response.end;

  return () => bytes;
}

function chunkSize(chunk: unknown, encoding: unknown): number {
  if (typeof chunk === "string") {
    return Buffer.byteLength(chunk, typeof encoding === "string" ? (encoding as BufferEncoding) : undefined);
  }
  return ArrayBuffer.isView(chunk) ? chunk.byteLength : 0;
}

function isLocalhost(url: URL): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
}
