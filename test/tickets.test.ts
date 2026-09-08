import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { getListTickets } from "../src/tickets.js";

test("returns 10 tickets with 2 KiB details by default", async () => {
  const result = await getListTickets();

  assert.equal(result.count, 10);
  assert.equal(result.delay_ms, 0);
  assert.equal(result.tickets.length, 10);
  for (const ticket of result.tickets) {
    assert.equal(Buffer.byteLength(ticket.detail, "utf8"), 2_048);
  }
});

test("returns the requested number of tickets", async () => {
  const result = await getListTickets({ number_of_tickets: 3 });

  assert.equal(result.count, 3);
  assert.deepEqual(
    result.tickets.map((ticket) => ticket.id),
    ["TICKET-0001", "TICKET-0002", "TICKET-0003"],
  );
});

test("waits for the requested delay", async () => {
  const startedAt = performance.now();
  const result = await getListTickets({ number_of_tickets: 0, delay_ms: 40 });

  assert.ok(performance.now() - startedAt >= 30);
  assert.equal(result.delay_ms, 40);
  assert.deepEqual(result.tickets, []);
});
