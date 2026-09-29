#!/usr/bin/env bash
# Enable the local-collector intake on production (ADR-0017), in the documented order. Deploys themselves go
# through the `Deploy recalls Worker` workflow only (docs/owner-actions/recalls-operations.md, "Deploying"); that
# workflow refuses a pending D1 migration, so migration 0004 is applied here first, under a bookmark.
#
# Run from a clean checkout of `main` that contains ADR-0017, with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
# set (D1 edit on the recalls account) and, for --finish, ADMIN_TOKEN (the Worker's admin secret).
#
#   apps/local-collector/deploy/enable-production.sh             # dry run: checks only, changes nothing
#   apps/local-collector/deploy/enable-production.sh --migrate   # 1. bookmark, then apply migration 0004
#   (2. dispatch Actions -> Deploy recalls Worker on main with the merge commit SHA, and approve it)
#   apps/local-collector/deploy/enable-production.sh --finish    # 3. verify the deploy, mint the credential, probe
#
# Migration 0004 only adds tables, so the Worker already live keeps serving unchanged after --migrate.
# It never changes SALES_OPEN, prices, hostnames or existing tables. The gates are left as committed in
# wrangler.toml; open EXTRACTED_IDENTIFIERS_OPEN only when the held-out bar in
# apps/local-collector/benchmark/QUALITY_BAR.md is met for the extractor build the collector runs.
set -euo pipefail

MODE="${1:-}"
[[ -z "$MODE" || "$MODE" == "--migrate" || "$MODE" == "--finish" ]] || { echo "Usage: $0 [--migrate|--finish]" >&2; exit 64; }
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKER="$ROOT/apps/recalls-worker"
API="https://api.data.aroqon.com"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}" "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}"

cd "$ROOT"
branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" == "main" ]] || { echo "Run from main (on $branch)." >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "The working tree is not clean." >&2; exit 1; }
[[ -f "$WORKER/migrations/0004_extraction_intake.sql" ]] || { echo "Migration 0004 is missing: this checkout predates ADR-0017." >&2; exit 1; }
grep -q '^COLLECTOR_INTAKE_OPEN = "1"' "$WORKER/wrangler.toml" || echo "Note: COLLECTOR_INTAKE_OPEN is not \"1\" in wrangler.toml; until a reviewed change sets it and is deployed, the intake stays closed (503)."

echo "== Checks (the Worker, the acceptance rules and the collector policy)"
pnpm exec vitest run apps/recalls-worker packages/product-recall-structuring tooling/test/local-collector.test.ts
pnpm -s collector:policy:check

cd "$WORKER"
echo "== D1 migration state"
npx wrangler d1 migrations list data-foundry-recalls --remote

if [[ -z "$MODE" ]]; then
  echo "Dry run complete. Next: --migrate, then the Deploy recalls Worker workflow, then --finish."
  exit 0
fi

if [[ "$MODE" == "--migrate" ]]; then
  echo "== Time Travel bookmark (restore point)"
  npx wrangler d1 time-travel info data-foundry-recalls | tee "/tmp/df-bookmark-$(date -u +%Y%m%dT%H%M%SZ).txt"
  echo "== Apply migration 0004 (adds tables only)"
  npx wrangler d1 migrations apply data-foundry-recalls --remote
  echo "Migrated. Now dispatch Actions -> Deploy recalls Worker on main (confirm = deploy-recalls, expected_sha = $(git rev-parse HEAD)), approve it, then run --finish."
  exit 0
fi

: "${ADMIN_TOKEN:?set ADMIN_TOKEN}"
echo "== Verify the deployed Worker carries ADR-0017 (the API root names each dataset's registry key)"
curl -fsS "$API/" | grep -q '"registry"' || { echo "The API root does not show registry keys: the Deploy recalls Worker workflow has not deployed this commit yet." >&2; exit 1; }

echo "== Intake probe (without a credential, an open and healthy intake answers 401)"
code="$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v1/intake/product-recalls/identifiers")"
if [[ "$code" == "503" ]]; then
  echo "Deployed, but the intake is closed (503): COLLECTOR_INTAKE_OPEN is not \"1\". Set it in a reviewed change and deploy it through the workflow." >&2
  exit 2
elif [[ "$code" != "401" ]]; then
  echo "The intake probe answered $code, not 401: the deploy is not verified." >&2
  exit 1
fi
echo "Intake open and refusing unauthenticated submissions (401)."
# Minted only after the probe passes, so a closed or unhealthy intake never leaves an unused live credential behind.
echo "== Mint the collector's ingestion credential (shown once; store it only in the collector: set-secret ingest-token)"
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/ingest-credentials?label=owner-windows-collector&sources=cpsc-recalls"
echo
echo "Record the Worker version and bookmark in PROGRESS.md."
