import { createHttpServer } from "./http.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3_000);
const publicUrl = new URL(process.env.MCP_PUBLIC_URL ?? `http://localhost:${port}`);
const oauthClientStorePath = process.env.MCP_OAUTH_CLIENT_STORE_PATH;

createHttpServer({ publicUrl, oauthClientStorePath }).listen(port, host, () => {
  console.log(`ticket-mock-mcp is listening on ${new URL("/mcp", publicUrl).href}`);
});
