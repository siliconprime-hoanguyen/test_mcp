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

The public endpoint is `https://test-mcp.codehub.io/mcp`. The container listens on every host interface at port 3000, and requests are accepted with any incoming `Host` header. OAuth metadata always uses the canonical public hostname.

Point a remote-capable MCP host at the URL:

```json
{
  "mcpServers": {
    "ticket-mock": {
      "url": "https://test-mcp.codehub.io/mcp"
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

OAuth requires HTTPS for non-localhost clients. Terminate TLS for `test-mcp.codehub.io` at a reverse proxy and forward requests to port 3000:

```bash
docker compose up --build -d
```

Then configure the MCP client with `https://test-mcp.codehub.io/mcp`. An OAuth-capable client will discover the metadata, register itself through DCR, and open the login page automatically.

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

The MCP URL is:

```text
https://test-mcp.codehub.io/mcp
```

Stop it with:

```bash
docker compose down
```
