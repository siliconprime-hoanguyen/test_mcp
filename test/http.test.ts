import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createHttpServer } from "../src/http.js";

const MCP_REQUEST = {
  jsonrpc: "2.0",
  id: 1,
  method: "tools/call",
  params: {
    name: "get_list_tickets",
    arguments: { number_of_tickets: 2, delay_ms: 0 },
  },
};

test("completes DCR OAuth with PKCE before serving MCP", async (context) => {
  const server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  const mcpUrl = `${origin}/mcp`;
  const redirectUri = "http://127.0.0.1:9876/callback";

  const unauthorized = await callMcp(mcpUrl);
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get("www-authenticate") ?? "", /resource_metadata=/);

  const protectedResource = await fetch(`${origin}/.well-known/oauth-protected-resource/mcp`);
  assert.equal(protectedResource.status, 200);
  const resourceMetadata = (await protectedResource.json()) as {
    resource: string;
    authorization_servers: string[];
  };
  assert.equal(resourceMetadata.resource, mcpUrl);
  assert.deepEqual(resourceMetadata.authorization_servers, [origin]);

  const authorizationServer = await fetch(`${origin}/.well-known/oauth-authorization-server`);
  const oauthMetadata = (await authorizationServer.json()) as {
    registration_endpoint: string;
    authorization_endpoint: string;
    token_endpoint: string;
  };

  const registration = await fetch(oauthMetadata.registration_endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "ticket mock test",
      application_type: "native",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      token_endpoint_auth_method: "none",
    }),
  });
  assert.equal(registration.status, 201);
  const { client_id } = (await registration.json()) as { client_id: string };

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorizeUrl = new URL(oauthMetadata.authorization_endpoint);
  authorizeUrl.search = new URLSearchParams({
    response_type: "code",
    client_id,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "mcp",
    resource: mcpUrl,
    state: "test-state",
  }).toString();

  const loginPage = await fetch(authorizeUrl);
  assert.equal(loginPage.status, 200);
  const loginCsp = loginPage.headers.get("content-security-policy") ?? "";
  assert.doesNotMatch(loginCsp, /form-action/);
  assert.match(loginCsp, /default-src 'none'/);
  assert.match(loginCsp, /base-uri 'none'/);
  const requestId = (await loginPage.text()).match(/name="request_id" value="([^"]+)"/)?.[1];
  assert.ok(requestId);

  const rejectedLogin = await fetch(oauthMetadata.authorization_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request_id: requestId, username: "hoa", password: "wrong" }),
  });
  assert.equal(rejectedLogin.status, 401);

  const login = await fetch(oauthMetadata.authorization_endpoint, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ request_id: requestId, username: "hoa", password: "123456" }),
  });
  assert.equal(login.status, 302);
  const callback = new URL(login.headers.get("location") ?? "");
  assert.equal(callback.searchParams.get("state"), "test-state");
  assert.equal(callback.searchParams.get("iss"), origin);
  const code = callback.searchParams.get("code");
  assert.ok(code);

  const tokenResponse = await fetch(oauthMetadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: mcpUrl,
    }),
  });
  assert.equal(tokenResponse.status, 200);
  const token = (await tokenResponse.json()) as { access_token: string; refresh_token: string };
  assert.ok(token.access_token);
  assert.ok(token.refresh_token);

  const replayedCode = await fetch(oauthMetadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id,
      code,
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource: mcpUrl,
    }),
  });
  assert.equal(replayedCode.status, 400);

  const authorized = await callMcp(mcpUrl, token.access_token);
  assert.equal(authorized.status, 200);
  const responseText = await authorized.text();
  const rpcJson = authorized.headers.get("content-type")?.startsWith("text/event-stream")
    ? responseText.match(/^data: (.+)$/m)?.[1]
    : responseText;
  assert.ok(rpcJson);
  const rpcResponse = JSON.parse(rpcJson) as {
    result: { content: Array<{ type: string; text: string }> };
  };
  const result = JSON.parse(rpcResponse.result.content[0].text) as { count: number };
  assert.equal(result.count, 2);
});

test("accepts MCP requests with any Host header", async (context) => {
  const server = createHttpServer({ publicUrl: new URL("https://test-mcp.codehub.io") });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const { port } = server.address() as AddressInfo;
  const response = await callMcp(`http://127.0.0.1:${port}/mcp`, undefined, "arbitrary.example");

  assert.equal(response.status, 401);
  assert.match(
    response.headers.get("www-authenticate") ?? "",
    /resource_metadata="https:\/\/test-mcp\.codehub\.io\/\.well-known\/oauth-protected-resource\/mcp"/,
  );
});

function callMcp(url: string, token?: string, host?: string): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(host ? { host } : {}),
    },
    body: JSON.stringify(MCP_REQUEST),
  });
}
