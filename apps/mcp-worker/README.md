# MCP Worker

Cloudflare Streamable HTTP adapter for the transport-free six-tool contract in
`apps/mcp`. This app is a composition root and protocol boundary only: it opens
canonical Postgres through Hyperdrive, constructs the shared QueryModel, and
registers the existing generic tools with `@modelcontextprotocol/server@2.0.0`.
It owns no fact selection, entity resolution, rights implication, or vertical-
specific tool behavior.

## Protocol and access contract

- Endpoint: `POST /mcp`.
- Current protocol: MCP `2026-07-28` per-request Streamable HTTP.
- Compatibility: claimless legacy traffic is limited to `initialize`; legacy
  tools/list, tools/call, GET, DELETE, and standalone SSE are not supported.
  Modern `initialize` is rejected because current discovery is
  `server/discover`.
- Modern requests require JSON content, both JSON and SSE in `Accept`, the
  exact protocol envelope/header, `Mcp-Method`, and `Mcp-Name` where required.
  Request methods require a JSON-RPC id. Only the SDK's closed modern
  `notifications/*` set is accepted without one, and notifications carrying an
  id are rejected before the SDK.
- The Host header must resolve to `MCP_HOSTNAME`. A present Origin must be one
  exact member of `MCP_ALLOWED_ORIGINS`; native clients may omit Origin.
- Authentication is a revocable Data Foundry bearer key with one vertical and
  the exact `MCP/NONE` classification. Direct and RapidAPI keys fail closed.
  This custom key is not an MCP OAuth token; no authorization server is claimed.

The cached deployment holds one driver/store/base QueryModel per warm isolate,
while `apps/mcp` binds a fresh `MCP` surface context on every tool call. A later
source kill switch, rights/terms revocation, or review expiry therefore applies
on the next request without reopening the database pool.

## Analytics and privacy

The Worker awaits `USAGE_EVENTS_QUEUE.send` acceptance before returning a
metered response. The consumer persists later and idempotently. Events are
analytics-only `MCP/NONE` with `rows_served = 0` and one fixed route key:

- `mcp.server_discover`
- `mcp.tools_list`
- `mcp.tools_call`
- `mcp.protocol_failure`

Tool names, arguments, JSON-RPC ids, entity ids, raw targets, bodies, response
payloads, and plaintext credentials never enter the event. Queue rejection
returns a fixed 503 and logs only a server-created event id and route key.

## Runtime artifacts and local verification

`verticals/<slug>/mcp.yaml` selects server metadata and must declare the exact
six executable tools. `pnpm mcp:compile` combines it with compiled query policy
and the public SEO URL prefix into `generated/<slug>.runtime.json`; the Worker
does not read YAML or the filesystem at runtime.

```bash
pnpm mcp:compile:check
pnpm --filter @data-foundry/mcp-worker typecheck
pnpm --filter @data-foundry/mcp-worker test
pnpm cloudflare:topology:check
pnpm cloudflare:artifacts:check
```

Production additionally requires a Hyperdrive binding, the shared usage Queue,
`VERTICAL_SLUG`, live-key namespace, `MCP_HOSTNAME`,
`MCP_ALLOWED_ORIGINS`, and `PUBLIC_ORIGIN`. Live account ids, routes, Hyperdrive
ids, database URLs, and secrets remain outside this repository; follow
`docs/owner-actions/cloudflare-deployment.md` for exact owner-side deployment.
