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

The endpoint is available at `http://localhost:3000/mcp`. Set `HOST` or `PORT` to change the bind address or port. `MCP_PUBLIC_URL` must be the externally reachable origin used in OAuth metadata.

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

## OAuth and DCR

The MCP endpoint requires an OAuth bearer token. It publishes protected-resource and authorization-server metadata, supports RFC 7591 Dynamic Client Registration, and uses authorization code flow with S256 PKCE.

Test login:

- Username: `hoa`
- Password: `123456`

Registrations, authorization codes, and tokens are held in memory and reset whenever the process restarts. This fixed login is only for isolated testing.

OAuth requires HTTPS for non-localhost clients. For a remote deployment, terminate TLS at a reverse proxy and set the public origin before starting Compose:

```bash
MCP_PUBLIC_URL=https://mcp.example.com docker compose up --build -d
```

Then configure the MCP client with `https://mcp.example.com/mcp`. An OAuth-capable client will discover the metadata, register itself through DCR, and open the login page automatically.

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

## Docker

Build and start the remote server:

```bash
docker compose up --build -d
```

For localhost testing, the MCP URL is:

```text
http://localhost:3000/mcp
```

Stop it with:

```bash
docker compose down
```
