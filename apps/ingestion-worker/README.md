# Artifact ingestion Worker

This is the sixth Cloudflare Worker, using the distinct `df_ingestion` role and
cache-disabled Hyperdrive. It consumes the dedicated `data-foundry-ingestion`
Queue, with `data-foundry-ingestion-dlq` configured for failed platform retries.
The five-minute Cron recovers durable outbox entries when enqueue or an isolate
fails. No public route, provider credential, fixture reader, or live-source
activation belongs in this Worker.

Acquisition completion writes `ingestion_deliveries` in the same database
transaction as the successful run and artifact manifest. Queue messages contain
exactly `{ "version": 1, "deliveryId": "<opaque UUID>" }`. Acceptance is
checkpointed only after Queue acceptance, so a crash can duplicate a message
but cannot lose its database work. The identity is acquisition run, processing
runtime digest, and work kind. Explicit replay creates a distinct delivery for
retained artifacts under a new compiled runtime.

The processing runtime identity includes a deterministic implementation digest,
not just vertical configuration. The compiler hashes LF-normalized production
TypeScript, canonical SQL migrations, dependency lock/package manifests, and
its own compiler/input-selection code in stable path order. Generated artifacts,
tests, fixtures, documentation, offline wrappers, and unsupported HTML/PDF
providers are excluded. The generated input manifest makes this boundary
reviewable; `pnpm ingestion:check` refuses drift after a processing bug fix even
when no YAML changed. Runtime Workers never read implementation files or Git.

Processing claims use a server-clock lease and opaque fencing token. Active
duplicates do no work; expired leases are reclaimed on the existing delivery.
An incompatible consumer version does not consume a processing attempt. R2
objects are admitted by reported size before reading and then checked against
the immutable content address, artifact row, retrieval key, exact run-derived
receipt identity, acquisition scope, and byte hash. Each verified artifact has
an immutable durable checkpoint. Current source approval and stored rights are
required again before R2 access and canonical publication.

After a later runtime request publishes the exact same artifact manifest and
covers its verification time, queued or expired older-runtime work retires as
`REFUSED/RUNTIME_MISMATCH`; its retained row and artifacts remain available.
Published history and active leases are untouched. An active owner rechecks
replacement publication under its own fence before committing. An outstanding
304 is recreated under a successful replacement processing runtime and must
pass normal verification before its old event can retire. Changed-artifact
incremental history is not automatically declared complete; explicit audited
operator retirement is required for work made obsolete by newer acquisition.

The production pipeline shares normalization, deterministic entity resolution,
immutable evidence, source-record revisions, relationship writing, and fact
selection with the offline factory. Its composition root imports compiled
configuration and the explicit JSON/CSV extractor registry. It reads stored
source/vertical governance and cannot replace it from YAML. All canonical writes,
complete-snapshot omission retirement, fact promotion, legacy job completion,
and delivery publication commit under one owned transaction; a final lease or
rights failure rolls the transaction back. Source locks prevent delayed
incremental work from replacing a newer published acquisition. Retained-byte
runtime replay advances an explicit processing generation while preserving the
original source observation time.

A `NOT_MODIFIED` delivery refers to the exact prior fetched artifact manifest.
It cannot certify an unpublished or failed manifest; missing processing is
queued first. Verification preserves the original processing/publication times
and uses the actual validating acquisition time. Entity verification advances
only where every active fact is supported by current finalized records in that
manifest and current normalization/derivation rights admit it. Immutable facts,
artifacts, and provider observation dates are not rewritten.

The first runtime is deliberately bounded: at most 16 artifacts, 1 MiB per
artifact, 4 MiB total, 1,000 extracted records, and 10,000 fact promotion or
verification candidates. It processes one bounded manifest per transaction;
record-level streaming across larger datasets is not implemented. Exceeding a
limit refuses the delivery before accepting a partial source snapshot. JSON and
Each supported source has exactly one acquisition target. The compiler refuses
multi-target sources until explicit target-to-stream partitions exist; source
snapshot ordering cannot safely treat independent targets as complete snapshots.
CSV support currently covers only the existing fictional catalog and fictional
AHRI fixtures. The real AHRI source is not registered or authorized by this
runtime. HTML/PDF are listed as unsupported, and ENERGY STAR remains deferred.

Compile with `pnpm ingestion:compile`; verify drift with `pnpm ingestion:check`.
The emitted Worker artifact check rejects filesystem/fixture loaders and PDF
runtimes. Bind `HYPERDRIVE`, `RAW_ARTIFACTS`, and `INGESTION_QUEUE`, and set
`DEPLOYMENT_ENVIRONMENT`, `VERTICAL_SLUG`, and `RAW_ARTIFACTS_BUCKET_NAME` in the
exact deployment manifest. Apply migration 0029 and the role grant policy before
running an acquisition Worker that emits the new outbox.

Local tests use synthetic reviewed rights, retained fixture bytes, and a real
Postgres-compatible database. They do not prove hosted rights, live provider
acquisition, Hyperdrive credentials, queue retention, deployment, or revenue.

The same Cron can monitor acquisition failures, work older than 30 minutes,
unpublished acquisitions older than 30 minutes, failed/refused jobs, and active
rights deadlines within 72 hours. It reads database state and records only five
closed incident codes, saturated counts, and timestamps in migration 0031. Each
failure/recovery transition creates one durable alert event. Repeated unchanged
observations create no mail; superseded pending events are cancelled. Pending,
failed, and unknown events remain available for operator inspection.

Email is disabled by default (`OPS_ALERTS_ENABLED="false"`). Enabling it requires
an onboarded sender, verified fixed destination, `OPS_ALERT_FROM`, `OPS_ALERT_TO`,
and an `OPS_EMAIL` Cloudflare Email Service `send_email` binding restricted by
`destination_address` and `allowed_sender_addresses`. No addresses or provider
responses are persisted in the database. Mail contains only closed codes,
counts, transitions, and observation timestamps. Only a provider response with
`messageId` records acceptance; acceptance does not establish inbox delivery.
There is no documented provider idempotency key, so every event receives at
most one attempt. Timeout, ambiguous provider failure, or a crash after sending
is retained as UNKNOWN and never automatically resent. Operators must inspect
such outcomes before authorizing any new notification.

Cloudflare Queue/DLQ, storage, request-error, spend, and independent monitor
availability alerts remain external setup and verification gates. A disabled
email configuration or local mocked sink tests do not prove alert readiness.
