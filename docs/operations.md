# Operating acquisition and publication

The production scheduler and ingestion Queue run without a developer command.
The CLI below is for investigation and deliberate recovery. It uses only
`DATA_FOUNDRY_OPERATOR_DATABASE_URL` through the approved direct TLS secret
interface, pins `data_foundry, pg_catalog, extensions`, and requires the controlled
`df_migration` direct identity. Do not put a connection string or API key in argv,
shell history, chat or a report. Provider containment and secure activation
conditions still apply before any hosted operation.

`pnpm exec tsx tooling/scripts/operations.ts status` returns bounded source IDs,
acquisition/verification/publication clocks, backlog ages, failed-job reason
codes, pending resolution IDs, incident generations and alert delivery status/counts.
The incident and alert lists are capped at 100 with explicit truncation flags;
no contact addresses, provider IDs, claim tokens or raw errors are returned.
`UNKNOWN` means provider acceptance could not be determined and must not trigger
an automatic resend. `PENDING`, `FAILED` and `ACCEPTED` remain distinct outcomes. These are operator results, not public
publication metadata. Acquisition success is distinct from canonical success.

For an intervention, prepare a new UUID request identity and an attributable
operator reference. Review the dry-run intent before adding `--apply`:

```text
pnpm exec tsx tooling/scripts/operations.ts action --action REPLAY_DELIVERY --target-id DELIVERY_UUID --request-id REQUEST_UUID --actor-ref ops.owner --reason-code RECOVERY
```

The dry run validates syntax only and explicitly does not attest target state.
Applying validates the live target and atomically records the closed action,
reason, operator reference and affected count. Repeating the exact request is
idempotent; changing its intent is refused. Audit history rejects UPDATE, DELETE and TRUNCATE. UUID casing is normalized before request locking and replay comparisons.
No runtime identity receives operator audit or account-control privileges.

| Action | Behavior |
| --- | --- |
| PAUSE_SOURCE | Engage the source kill switch; subsequent processing/delivery rights checks refuse access |
| RESUME_SOURCE | Clear the switch only for an already ACTIVE source; this does not approve it or grant rights |
| REPLAY_DELIVERY | Requeue a FAILED/REFUSED delivery and reset its attempt budget; rechecks runtime/artifacts/rights, never steals an active lease |
| RETIRE_DELIVERY | Explicitly retire QUEUED or expired PROCESSING work using `--replacement-delivery-id`; replacement must be PUBLISHED from the same source/target, with a later acquisition verification time and different processing runtime; active leases and completed history are refused |
| BACKFILL_RUN | Create idempotent processing work for a completed FETCHED acquisition and `--runtime-digest` from the reviewed compiled ingestion runtime; worker rejects an unknown digest |
| RETRACT_FACT | End and retract one currently open fact revision; preserve its evidence and correction audit, then verify query surfaces |
| REVOKE_KEY | Timestamp key revocation; retain its usage/accounting references |
| CLOSE_ACCOUNT | Close the account, revoke its keys and cancel its active allowance periods atomically; preserve billing references and contact data pending the separate approved retention/erasure policy |
| RENEW_ENTITLEMENT | Append the next consecutive allowance period with the same plan and included requests to an ACTIVE entitlement of an ACTIVE account (ADR-0014); refused once a later period already exists; the new period id is the result id |
| CANCEL_ENTITLEMENT | End one ACTIVE allowance period now; the edge refuses the tenant's direct keys from the next request unless another active period covers it |

For obsolete work whose replacement acquired different bytes, review both delivery
IDs before retiring the old work. Automatic recovery cannot infer that a newer
incremental artifact includes every old part. This command records that explicit
operator disposition without deleting raw artifacts or verification checkpoints:

```text
pnpm exec tsx tooling/scripts/operations.ts action --action RETIRE_DELIVERY --target-id OBSOLETE_DELIVERY_UUID --replacement-delivery-id PUBLISHED_REPLACEMENT_UUID --request-id REQUEST_UUID --actor-ref ops.owner --reason-code RECOVERY
```

The dry-run intent includes both IDs and remains syntax-only until `--apply`.
Retirement locks the original delivery and checks lease expiry on the database
clock. It marks eligible work REFUSED/RUNTIME_MISMATCH and records the normalized
replacement UUID in the append-only audit result_id. The replacement is part of
idempotent request identity; changing it under the same request UUID is refused.
This action does not grant rights, accept a snapshot, or advance publication or
verification timestamps. Published, failed and already refused history is kept.

If a correction needs a new factual value or entity merge, use evidence-backed
source reprocessing and reviewed resolution tooling. This CLI deliberately does
not accept arbitrary SQL, new fact values, merge instructions or rights claims.

## Initial alert thresholds and recovery

The ingestion scheduler can record durable failure/recovery transitions for
acquisition failures or claims stuck for 30 minutes, queued/processing work older
than 30 minutes, successful acquisitions unpublished after 30 minutes, failed
ingestion jobs and rights expiring or needing review within 72 hours. The
30-minute warning precedes the two-hour publication target. The next health
snapshot records recovery when the incident clears. Unchanged incident state
does not send repeated emails.

Alerts default to disabled. Activation requires a verified sender and recipient,
the exact restricted `OPS_EMAIL` binding, and `OPS_ALERTS_ENABLED=true` in the
reviewed deployment manifest. Only closed codes/counts/timestamps and fixed
recovery guidance enter messages. `ACCEPTED` means provider acceptance, not
verified inbox delivery. A timeout, crash or uncertain provider outcome becomes
`UNKNOWN` and is never automatically resent. Inspect provider metadata through
approved access before deciding recovery; the operator status exposes unknown
and failed deliveries. Do not silently clear them or claim delivery.

Provider monitoring must separately cover scheduler/Worker/database outages,
Queue backlog and DLQs, R2/storage failures, request error rates, canonical
verification age approaching 24 hours, capacity and month-to-date spend. A
database-backed monitor cannot report when its own database or Worker is down.
Configure and test that independent path before launch. No live monitor is
claimed by local email-binding tests.

At 70%, 85% and 100% of the $300 monthly operating envelope, review projected
spend. Keep source rate limits, finite work bounds and hard customer limits;
do not delete retained evidence merely to reduce a bill. Recurring source
checking does not require a Codex task or heartbeat automation.

These thresholds are operating objectives. The verified email destination,
provider monitor configuration, actual failure/recovery delivery, two real refresh
cycles, backup restore and measured cost evidence remain launch requirements.
The repository contains no approved retention/erasure period. Account closure
is implemented; it is not described as erasure or anonymisation. Record the
controller's policy before implementing its scheduled retention deadlines.
