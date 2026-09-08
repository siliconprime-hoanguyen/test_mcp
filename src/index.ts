import { createHttpServer } from "./http.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 3_000);

createHttpServer().listen(port, host, () => {
  console.log(`ticket-mock-mcp is listening on http://${host}:${port}/mcp`);
});
