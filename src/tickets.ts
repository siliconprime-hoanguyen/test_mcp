import * as z from "zod/v4";

export const TICKET_DETAIL_BYTES = 2_048;

export const ticketListInputSchema = z.object({
  number_of_tickets: z
    .number()
    .int()
    .min(0)
    .max(10_000)
    .default(10)
    .describe("Number of mock tickets to return. Defaults to 10."),
  delay_ms: z
    .number()
    .int()
    .min(0)
    .max(300_000)
    .default(0)
    .describe("Milliseconds to wait before returning. Defaults to 0."),
});

export const ticketSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.enum(["open", "pending", "closed"]),
  priority: z.enum(["low", "medium", "high"]),
  requester_email: z.string(),
  created_at: z.string(),
  detail: z.string(),
});

export const ticketListResultSchema = z.object({
  count: z.number().int().nonnegative(),
  delay_ms: z.number().int().nonnegative(),
  ticket_detail_bytes: z.literal(TICKET_DETAIL_BYTES),
  tickets: z.array(ticketSchema),
});

export type TicketListInput = z.input<typeof ticketListInputSchema>;
export type TicketListResult = z.output<typeof ticketListResultSchema>;

function createDetail(ticketNumber: number): string {
  const seed =
    `Mock ticket ${ticketNumber}: Customer reports an intermittent issue. ` +
    "Steps, diagnostics, expected behavior, and follow-up notes are included for payload testing. ";

  return seed.repeat(Math.ceil(TICKET_DETAIL_BYTES / seed.length)).slice(0, TICKET_DETAIL_BYTES);
}

function createTicket(index: number): TicketListResult["tickets"][number] {
  const ticketNumber = index + 1;
  const statuses = ["open", "pending", "closed"] as const;
  const priorities = ["low", "medium", "high"] as const;

  return {
    id: `TICKET-${ticketNumber.toString().padStart(4, "0")}`,
    title: `Mock support ticket ${ticketNumber}`,
    status: statuses[index % statuses.length],
    priority: priorities[index % priorities.length],
    requester_email: `requester${ticketNumber}@example.test`,
    created_at: new Date(Date.UTC(2026, 0, 1, 0, ticketNumber)).toISOString(),
    detail: createDetail(ticketNumber),
  };
}

export async function getListTickets(input: TicketListInput = {}): Promise<TicketListResult> {
  const { number_of_tickets, delay_ms } = ticketListInputSchema.parse(input);

  if (delay_ms > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, delay_ms));
  }

  return {
    count: number_of_tickets,
    delay_ms,
    ticket_detail_bytes: TICKET_DETAIL_BYTES,
    tickets: Array.from({ length: number_of_tickets }, (_, index) => createTicket(index)),
  };
}
