import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { createHttpServer } from "../src/http.js";

test("serves get_list_tickets over Streamable HTTP", async (context) => {
  const server = createHttpServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  context.after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const { port } = server.address() as AddressInfo;
  const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "get_list_tickets",
        arguments: { number_of_tickets: 2, delay_ms: 0 },
      },
    }),
  });

  assert.equal(response.status, 200);
  const responseText = await response.text();
  const rpcJson = response.headers.get("content-type")?.startsWith("text/event-stream")
    ? responseText.match(/^data: (.+)$/m)?.[1]
    : responseText;
  assert.ok(rpcJson);

  const rpcResponse = JSON.parse(rpcJson) as {
    result: { content: Array<{ type: string; text: string }> };
  };
  const result = JSON.parse(rpcResponse.result.content[0].text) as { count: number };
  assert.equal(result.count, 2);
});
