# ADR-0013 — Disposition of the private-canary provider resources

**Status:** Accepted as an engineering disposition, 2026-09-18. Reversible; requires no provider mutation to take effect. The Product Owner may override it by directing deletion.

**Relates to:** ADR-0006 (Cloudflare deployment), ADR-0012 (capability hostnames and the `UA-005` gate), the [Cloudflare runbook](../owner-actions/cloudflare-deployment.md), the [2026-09-18 reconciliation record](../evidence/ua002-hosted-execution-reconciliation-20260918.md), and checklist items `BETA-002`, `BETA-003`, `PROD-002`, `REV-006`.

## Context

The route-less private canary passed on 2026-09-18 and was independently reconciled. It left the following resources in the canonical Cloudflare account, all created for that proof and all read back from the provider:

- seven route-less Workers: `data-foundry-private-canary-edge`, `-web`, `-usage-consumer`, `-acquisition-worker`, `-ingestion-worker`, `-mcp-hvac`, and the harness `data-foundry-private-canary`;
- five dedicated 14-day queues: `data-foundry-private-canary-usage-events`, its DLQ, `data-foundry-private-canary-events`, `data-foundry-private-canary-dlq`, `data-foundry-private-canary-quarantine`;
- six cache-disabled `verify-full` Hyperdrives, one per runtime role, bound to the uploaded Supabase Root 2021 CA;
- the receipt bucket `data-foundry-private-canary-receipts` and the retained receipt object for cycle `475e622a-a1bf-48a5-9d2b-52126281bff4`.

The runbook wrote the Worker identities as *temporary* and said cleanup "removes only those temporary identities" once evidence is retained. The reconciliation deliberately deleted nothing and carried the disposition to Part 2. The Part 1 session ended waiting on exactly this decision.

Two facts drive the choice:

1. **`REV-006` requires exact current-SHA provider canaries before public cutover**, and every later commit creates a new release SHA that needs fresh exact-SHA checks. The canary is therefore not a one-off proof; it is the pre-cutover gate that will run again, at least once per release candidate that reaches the provider.
2. **Only the seven Workers are canary-specific.** The six Hyperdrives are the ordinary production bindings (the ordinary manifests receive the same six IDs). The receipt bucket and object are evidence. Deleting the Workers and queues saves nothing measurable: a route-less Worker with no traffic and an empty queue with no messages have no request, message or storage cost under the account's usage model.

## Decision

1. **Retain the seven private-canary Workers and the five private-canary queues as standing pre-cutover validation infrastructure.** They stop being "temporary identities awaiting cleanup" and become the fixed, isolated canary topology that every release candidate must pass on before `UA-005`. Their names, bindings and queue topology remain exactly those of the tracked `wrangler.private-canary.toml` templates and `apps/private-canary/wrangler.toml`; a change to those templates is a change to this topology and needs the same fail-closed checks as before.
2. **Retain the six Hyperdrives, the CA certificate, the receipt bucket and the receipt object.** The Hyperdrives are production bindings. The receipt is evidence and must not be deleted; later cycles add objects under their own run ids and never overwrite an earlier receipt.
3. **The cleanup step in the runbook is redefined as *rollback*, not routine closeout.** Deleting or disabling the private-canary Worker identities remains the documented way to stop a misbehaving canary without touching ordinary Worker configuration; it is no longer the expected end of a successful cycle.
4. **Before every re-run at a new release SHA, the seven canary Workers are redeployed from that SHA's manifests**, so that the deployed bundles byte-match the candidate the way the 2026-09-18 bundles matched `5580484`. A canary that passes on stale bundles proves nothing about the candidate.
5. **The retained topology is verified from the provider, not assumed.** `pnpm cloudflare:readback:check --phase private-canary` reads back queue retention, backlog, producers, consumers and dead-letter targets, Worker zone routes, custom domains and `workers.dev` / preview flags, and requires them to match the tracked manifests and the still-unexecuted `UA-005` gate. This closes the two read-back gaps the reconciliation recorded (retention/depth; routes/subdomain flags), which `wrangler` and the connector could not observe.

## Consequences

- The canary Workers must never be given a route, custom domain, `workers.dev` subdomain, preview URL, Cron, raw-artifact bucket or real-source configuration. The read-back check fails on any of these.
- A reduced canary profile must still never be deployed under an ordinary Worker name; the ordinary six Workers are deployed from the ordinary templates only (`PROD-002`), initially route-less (`--phase ordinary-route-less`), and receive routes only under `UA-005`.
- The quarantine and both dead-letter queues are expected to be empty after a healthy cycle; a non-zero backlog is an investigation, never a purge.
- The retained receipt object and bucket are not to be lifecycle-expired; no retention rule may be added to that bucket without a separate decision.
- Nothing in this ADR authorizes a public hostname, a route, DNS, or ordinary Worker deployment. It settles only what happens to what already exists.

## Alternatives considered

- **Delete the seven Workers and five queues now, recreate per cycle.** Rejected: no cost saving, and each recreation is a fresh provider mutation with its own evidence burden and a fresh chance of naming or binding drift. The 2026-09-18 evidence chain (queue IDs, Worker version IDs, bundle digests) is more useful attached to a stable topology.
- **Delete only the Workers, keep the queues.** Rejected for the same reason; the service bindings from the harness to the six targets are part of the proof and are cheapest to keep intact.
- **Promote the canary Workers into the ordinary Workers.** Rejected: the reduced profiles deliberately lack Cron, R2, ordinary queues and vertical configuration, and the runbook already forbids deploying a reduced profile under an ordinary name.
