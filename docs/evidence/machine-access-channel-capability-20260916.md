# Paid machine-access channel capability — 2026-09-16

**Scope:** What a machine can actually be charged for today, per channel, read
from official provider documentation and from the tooling this session could
authenticate against. Replaces inference and marketing language with dated,
sourced observations.

**Redaction:** No account identifier, credential, connection string, price
agreement, or payout detail is recorded here.

**Status:** `CAPABILITY_SURVEY` — this is a channel-availability record, not a
deployment, entitlement, revenue, or rights certificate. No channel was
enrolled, enabled, configured, or charged.

## What this session could and could not authenticate

| Interface | State at 2026-09-16 | Consequence |
| --- | --- | --- |
| Supabase management connector | Authenticated (administrative role) | Live database state read directly; see below |
| GitHub | Authenticated | Repository and CI state read directly |
| Official provider documentation | Public | Cloudflare capability claims below are documentation-sourced |
| Cloudflare API/dashboard | **Not authorized in this session** | Zone settings, bot rules, plan level and any beta admission for this account are **unverified** |
| Stripe | **Not authorized in this session** | Product, price and payout state are **unverified** |
| Direct TLS Postgres | Unreachable (see below) | Hosted migration and grant work could not proceed |

## Implemented channel model, read from the release

`packages/api-keys/src/index.ts` at `af9fc68` defines exactly:

- `API_ACCESS_TIERS = ['API_FREE', 'API_PAID', 'RAPIDAPI', 'MCP']`
- `API_BILLING_SOURCES = ['DIRECT', 'RAPIDAPI', 'NONE']`

So the repository implements two chargeable machine channels — a direct paid
API billed `DIRECT`, and a marketplace channel billed `RAPIDAPI` — plus an MCP
tier that carries no billing source of its own. **There is no paid-crawler
access tier, rights surface, or billing source in the model.** Any crawler
charging today would therefore happen entirely at the Cloudflare edge, above
the application's own entitlement and metering.

## Channel-by-channel capability

### Direct paid API — `API_PAID` / `DIRECT`

- Available without any third-party enrollment, marketplace agreement, or beta
  admission. Scoped keys are issued by `pnpm credentials:provision`; usage is
  metered and aggregated invoice-eligible by the merged usage path.
- Missing for a live sale: the deployment itself, an approved real source, a
  published price, and an invoicing/collection decision. None of these is a
  provider dependency.
- **This is the shortest supported path to a paid machine request.** An agent
  operating under a customer's key is valid machine consumption; autonomous
  agent checkout is not a prerequisite for revenue.

### RapidAPI — `RAPIDAPI` / `RAPIDAPI`

- Thin origin adapter and marketplace-origin authentication are merged and
  tested; direct-invoice exclusion is covered by test.
- Blocked on owner enrollment, marketplace agreements, payout configuration and
  plan setup (`UA-004`). Marketplace listing is commercial redistribution and
  additionally requires the exact `RAPIDAPI` rights bundle on the source.

### MCP / agent access — `MCP` / `NONE`

- The six-tool contract and Streamable HTTP Worker are implemented, with
  one-vertical custom-bearer auth.
- **MCP carries no payment mechanism.** Charging for agent retrieval means
  issuing the agent's operator a paid credential and metering it, not expecting
  the protocol to settle anything.

### Cloudflare Pay Per Crawl — provider-gated

Read 2026-09-16 from Cloudflare's official documentation (pages last updated
2026-04-23; changelog entry 2026-06-16).

- **Availability:** "Pay per crawl is currently in closed beta." Admission is by
  signup form or, for existing Enterprise customers, an account executive.
  There is no self-serve enablement. Whether this account has been admitted is
  **unverified** — the Cloudflare interface was not authorized in this session.
- **Identity:** a crawler is identified by **Web Bot Auth request signatures**
  plus registration on Cloudflare's verified-bots list. A `User-Agent` string
  does not identify a payer and must never be treated as one.
- **Mechanism:** a crawler without payment intent receives `HTTP 402` carrying a
  `crawler-price` response header (for example `crawler-price: USD 0.01`). A
  crawler signals intent with a `crawler-exact-price` or `crawler-max-price`
  request header. A successful charged response carries `crawler-charged`.
- **Settlement:** Cloudflare is the **Merchant of Record**. It records a billing
  event per authenticated, payment-intent request that returns a charged 2xx,
  aggregates them, charges the crawler and distributes earnings to the
  publisher. The crawler side connects Stripe; the publisher does not collect
  from the crawler directly.
- **Operational precedence, and the failure mode to avoid:** content blocked by
  WAF or Bot Management is blocked *before* the charge feature applies, and
  those rulesets override it. A request refused ahead of the charging flow
  earns nothing. Any future configuration must be verified against this
  precedence rather than assumed.
- **Since 2026-06-16** the price may be set dynamically from the origin, via a
  `crawler-price` response header or a Worker, and pay per crawl can be
  disabled by URI pattern through Configuration Rules. This is a change from the
  earlier internal assumption that pay per crawl is purely a zone setting with
  no Worker involvement: origin-priced crawling would let the existing
  rights-gated Worker decide, per path, whether a price is offered at all.

Sources, read 2026-09-16: Cloudflare AI Crawl Control documentation for
Pay Per Crawl (overview, "What is pay per crawl?", site-owner and AI-owner
guides, crawl-pages header reference, changelog).

## Live hosted database state (2026-09-16T13:42Z)

Read directly through the authenticated management connector:

| Check | Repository at `af9fc68` | Hosted target |
| --- | --- | --- |
| Migration ledger | `0001`–`0033` | `0001`–`0026` |
| Runtime roles | six, including `df_ingestion` | five; `df_ingestion` **does not exist** |
| Runtime role login | passwords owner-assigned at activation | all `NOLOGIN`, no password |
| Relation grants per query role | upgraded set, 286 expected | 25 each for `df_edge`, `df_web`, `df_mcp`, `df_acquisition` |
| Column grants | — | `df_edge` 11, `df_mcp` 11, `df_usage` 16 |
| `SECURITY DEFINER` functions | 0 | 0 |
| Shared `public` schema | untouched | 7 tables, ACL unchanged |
| Data | — | migration-seeded `api_route_keys` (14) and the ledger only |

The export for the pending work was built and validated this session against
that live ledger: 7 packets (`0027`–`0033`), 286 expected grants, 59 function
signatures, six roles.

## Why the hosted catch-up did not proceed

The runbook requires application migrations to run over direct TLS as the
controlled migration role, and states that the manifest's
`transactionContract.liveUseAuthorized: false` "do[es] not authorize connector
execution", and that if the direct-TLS transaction cannot be established one
must "stop rather than substituting a connector".

Direct TLS could not be established here, on three independent grounds
measured this session:

1. No migration credential is present in the environment.
2. The direct origin resolves **IPv6-only**, and this container has no IPv6
   stack (`Address family not supported by protocol`).
3. The IPv4 Supavisor endpoints time out on both 5432 and 6543; egress is
   restricted to an HTTPS proxy.

The September application of `0001`–`0026` used the connector under an explicit
owner preauthorization recorded in the runbook. No such authorization covers
`0027`–`0033`, and the current runbook text directs stopping rather than
substituting. The work therefore stops here and is reported as an owner action
rather than worked around.

## Consequences

- The shortest verified path to a paid machine request is the direct
  `API_PAID` API. It depends on deployment, an approved source and a price —
  not on any provider's beta admission.
- Crawler monetization stays a live workstream with one concrete external
  dependency: admission to the Pay Per Crawl closed beta. Its first
  implementation question is whether Data Foundry prices per path from the
  origin, which is now supported and which the rights model would govern.
- Charging a crawler is not expressible in the current access model. Adding a
  paid-crawler tier would touch the access-tier enum, the rights matrix and the
  migration set, and is an architectural decision rather than a routine change.
