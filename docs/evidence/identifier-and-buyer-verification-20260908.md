# Identifier, buyer experience and selected evidence verification

Date: 2026-09-08. Local implementation evidence in the revenue-platform worktree.
This does not attest deployed Workers, a real dataset, approved source rights,
a marketplace listing, policy approval or a paid customer. Production HVAC stays
DRAFT and its listing remains null; the second laboratory vertical is test-only.

## Behavior

The vertical alias operation chain now supplies normalized ingestion candidates,
resolution, exact lookup and exact search through one shared interpreter. Compiled
edge, web and MCP metadata carry the same versioned specification. Authoritative
current alias claims, source scope and surface rights still decide visibility.
The synthetic second vertical covers different fields, filters, relationships,
prefix rules, structural separators, collisions and claim withdrawal.

The customer site uses `/hvac`; `/data/hvac` paths receive 308 redirects with
queries preserved. Parent and industry pages explain buyer value and coverage.
All declared filters appear with human labels, active filter bounds, and search
pagination. Parameterized views stay noindex. Buyer routes retain the existing
vertical publication/rights gate. Proposed pricing and pending legal/support
pages make no live offer claim. Optional approved policy/contact configuration
can replace individual drafts; available status requires all approvals plus a
validated RapidAPI listing URL. Configuration cannot verify legal approval or
listing existence independently; those remain reviewed operating decisions.

REST facts optionally include selected evidence from the bound explainFact on
the same read snapshot and selection instant. Selected fact ID, property and
publisher intersection prevent neighbor attribution. Web evidence panels and MCP
use the shared attribution projection, including immutable artifact IDs/hashes,
locators and retrieved/observed timestamps. Exact quotations require their own
surface permission. Credential-bearing/signed URLs and unsafe schemes are
suppressed in structured evidence and generated customer narratives; no evidence
URL is fetched by these renderers. Internal storage paths and reviewer identities
are not added to the wire contract. OpenAPI artifacts describe the additive field.

## Local checks

Commands executed from `C:\Users\Adam\data-foundry-worktrees\revenue-platform-20260908`:

- `corepack pnpm exec vitest run packages/normalization packages/query-model services/ingest-worker/test/mapping-compiler.test.ts services/ingest-worker/test/identifier-ops.test.ts packages/canonical-store/test/alias-currentness.test.ts tooling/test/vertical-runtime-artifact.test.ts apps/edge/test/composition.test.ts --maxWorkers=2` — 404 tests passed in 29 files before buyer work. Added explicit competing-source collision coverage subsequently passed the 9-test configured identifier suite.
- `corepack pnpm exec vitest run apps/api apps/mcp tests/contract/surface-parity.test.ts tooling/test/vertical-runtime-artifact.test.ts apps/web/test/product.test.ts --maxWorkers=2` — 318 tests passed in 24 files. Includes reviewer privacy, rights refusal, API/MCP parity, snapshot discipline, corrected route-key telemetry and the shared serializer boundary.
- `corepack pnpm exec vitest run apps/api/test/boundary.test.ts apps/mcp/test/query-layer-boundary.test.ts apps/api/test/routes.test.ts apps/web/test/product.test.ts apps/web/test/app.test.ts services/ingest-worker/test/mapping-compiler.test.ts verticals/hvac/tests/vertical-config.test.ts --maxWorkers=2` — 191 tests passed in 7 files.
- `corepack pnpm exec vitest run packages/query-model/test/public-evidence.test.ts tests/contract/surface-parity.test.ts --maxWorkers=2` — 11 tests passed, including signed URL suppression in a real bound explanation and its generated narrative.
- `corepack pnpm typecheck` — passed after the final signed-evidence fixture type correction.
- Full `apps/web` suite passed during the buyer implementation, including DRAFT refusal, PUBLIC_WEB/SEARCH_INDEX non-implication and request freshness. Later product, route and rendering changes were checked with their focused suites and browser.
- Ingestion `pipeline-output-kind.test.ts` — 28 tests passed after updating the meaningful diagnostic expectation for earlier identifier rejection; existing alias evidence assertions remain.
- `corepack pnpm openapi:check`, `verticals:compile:check`, `mcp:compile:check`, `web:compile:check` — all generated artifacts current. Recompile ingestion metadata after any subsequent vertical config change.

## Browser and executable examples

Browser plugin was not available; used the installed Playwright CLI fallback in
an isolated `df-buyer-qa` Chrome session. The loopback-only fixture server used
real migrated PGlite, synthetic rights and 55 synthetic equipment models. It read
the actual generated web metadata with ACTIVE status changed only in process.
No hosted service, production key or provider was used.

Observed in the browser:

- Desktop landing at 1360px: clear offer, coverage limits, links and no overflow.
- Actual next-page interaction: 55 total, five rows on page 2, correct previous
  link and no next link.
- Mobile at 390px: actual Refrigerant selection and form submission returned one
  matching model; filter state remained visible and robots stayed noindex.
- Exact model match badge leads results; opening equipment and its evidence
  panel shows selected fact, artifact ID/hash, locator and timestamps.
- The initially cramped mobile table was repaired into stacked fact rows and
  re-rendered. Final evidence screenshot has readable property/value labels.
- Mobile pricing shows four proposed plans, no fabricated marketplace link and
  pending operating terms. Console reported zero errors and zero warnings.

Local artifacts (outside the repository):
`C:\Users\Adam\AppData\Local\Temp\df-buyer-qa\landing-desktop.png`,
`pricing-mobile.png`, `evidence-mobile.png`, `example-output.json`.
The screenshot entities and zero-filled test hashes are synthetic fixture data.

Both `node examples/hvac-lookup.ts DF-QA-001` and
`python examples/hvac_lookup.py DF-QA-001` were run against the actual local API.
Their parsed output matched, including two specifications and selected evidence.
Both unmatched-model runs stopped with exit 1 and no result payload. All four
runs asserted absence of the synthetic credential in stdout/stderr. Credentials
were supplied only through environment variables; examples refuse redirects.

## Independent operator review

Reviewed the operator CLI/audit and production logging changes. Reproduced and
fixed uppercase UUID replay conflicts by normalizing UUIDs before lock/comparison.
Reproduced audit TRUNCATE bypass and added a statement trigger. Bounded status
now includes incidents, alert outcome counts and the latest 100 alert rows, with
truncation indicators and no contacts, provider IDs, tokens or arbitrary errors.
UNKNOWN delivery remains visible without an automatic resend operation.
`corepack pnpm exec vitest run tooling/test/operations.test.ts --maxWorkers=1`
passed 10 tests covering these behaviors and transactional account closure.
Migration 0030 changed during review; parent integration must regenerate and
re-run any migration packet/native role proof whose input hash changed.

## Independent ingestion review

Reviewed acquisition completion and its transactional outbox, delivery claiming,
checkpointing and publication, the ingestion Worker composition and runner,
compiled runtime boundaries, and migration 0029. The acquisition composition
checks the paired acquisition digest before dispatch. Explicit retained-byte
reprocessing can select a new processing runtime without mutating prior delivery
identity. Queue bodies carry only the version and opaque delivery ID.

The review traced manifest bounds, receipt identity and content-hash checks,
lease fencing before and after publication, current stored rights before reads
and at publication, stale source ordering, and the 304 verification path. No
additional actionable defect was found in this bounded review. It is local code
review and regression evidence, not a deployed queue/R2/Hyperdrive certification.

`corepack pnpm exec vitest run apps/ingestion-worker/test/runner.test.ts --maxWorkers=1`
passed all 21 tests in 70.61 seconds after this independent review. The scoped
`git diff --check` passed (exit 0; only Windows CRLF normalization warnings).

The isolated browser session and synthetic loopback fixture server were stopped
after verification. Final mobile evidence view measured 390px viewport and 390px
document width, with zero browser console errors or warnings.

## Explicit obsolete-delivery retirement follow-up

Added RETIRE_DELIVERY for an operator-reviewed replacement when newer acquired
bytes cannot automatically prove that every old incremental part is covered.
The intent requires a normalized replacementDeliveryId exclusively for this
action and records it as operator_actions.result_id. Exact request replay
includes this replacement identity. The original delivery is locked before a
database-clock expiry check; only QUEUED or expired PROCESSING is eligible.
Replacement must be PUBLISHED, use a different runtime, and have the same source
and target with a later acquisition fresh_at. Existing artifacts, checkpoints,
publication clocks and terminal history remain intact. Retirement and audit
insertion are atomic.

`corepack pnpm exec vitest run tooling/test/operations-retirement.test.ts tooling/test/operations.test.ts --maxWorkers=1`
passed 23 tests in 6.70 seconds. Fixtures used fully migrated PGlite, real
scheduled acquisition and delivery storage, and synthetic transport. They
covered changed artifact IDs, queued/expired eligibility, active lease and
terminal-history refusal, replacement scope/time/runtime checks, exact replay,
artifact/checkpoint preservation and audit-failure rollback. `corepack pnpm
typecheck` passed. An actual CLI dry-run with synthetic UUIDs returned both
normalized IDs with dryRun=true and targetEligibilityChecked=false, without
opening a database. Migration 0030 changed and integration must refresh its
exact-input migration/native proof.
