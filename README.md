# Ticket mock MCP

A minimal remote MCP server for Node.js 24 and TypeScript. It exposes one tool over Streamable HTTP:

- `get_list_tickets`

Every ticket has a `detail` field containing exactly 2,048 UTF-8 bytes. The full ticket object is slightly larger because it also includes metadata.

## Install and run

```bash
npm install
npm run build
npm start
```

The endpoint is available at `http://localhost:3000/mcp`. Set `HOST` or `PORT` to change the bind address or port.

Point a remote-capable MCP host at the URL:

```json
{
  "mcpServers": {
    "ticket-mock": {
      "url": "http://your-server:3000/mcp"
    }
  }
}
```

## Tool payload

Both fields are optional:

```json
{
  "number_of_tickets": 25,
  "delay_ms": 500
}
```

| Field | Default | Accepted range |
| --- | ---: | ---: |
| `number_of_tickets` | `10` | `0` to `10000` |
| `delay_ms` | `0` | `0` to `300000` |

An empty payload uses both defaults:

```json
{}
```

## Verify

```bash
npm run check
```

This mock endpoint has no authentication and should only be exposed on a trusted test network or behind an authenticated gateway.

## Docker

Build and start the remote server:

```bash
docker compose up --build -d
```

The remote MCP URL is then:

```text
http://your-server:3000/mcp
```

Stop it with:

```bash
docker compose down
```
