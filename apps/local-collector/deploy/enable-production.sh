#!/usr/bin/env bash
# Enable the local-collector intake on production (ADR-0017), in the documented order.
# Run from a checkout of `main` that contains ADR-0017, with CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID set
# (the same credentials used to deploy data-foundry-recalls) and ADMIN_TOKEN (the Worker's admin secret).
#
#   apps/local-collector/deploy/enable-production.sh            # dry run: checks only, changes nothing
#   apps/local-collector/deploy/enable-production.sh --apply    # bookmark, migrate, deploy, mint, verify
#
# It never changes SALES_OPEN, prices, hostnames or existing tables (migration 0004 only adds tables).
# EXTRACTED_IDENTIFIERS_OPEN is left as committed in wrangler.toml; open it only when the held-out bar in
# apps/local-collector/benchmark/QUALITY_BAR.md is met for the extractor version the collector runs.
set -euo pipefail

APPLY=0
[[ "${1:-}" == "--apply" ]] && APPLY=1
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
WORKER="$ROOT/apps/recalls-worker"
API="https://api.data.aroqon.com"
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN}" "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID}" "${ADMIN_TOKEN:?set ADMIN_TOKEN}"

cd "$ROOT"
branch="$(git rev-parse --abbrev-ref HEAD)"
[[ "$branch" == "main" ]] || { echo "Run from main (on $branch)." >&2; exit 1; }
[[ -z "$(git status --porcelain)" ]] || { echo "The working tree is not clean." >&2; exit 1; }
grep -q '^COLLECTOR_INTAKE_OPEN = "1"' "$WORKER/wrangler.toml" || echo "Note: COLLECTOR_INTAKE_OPEN is not \"1\" in wrangler.toml; set it in this commit or the intake stays closed (503)."
[[ -f "$WORKER/migrations/0004_extraction_intake.sql" ]] || { echo "Migration 0004 is missing: this checkout predates ADR-0017." >&2; exit 1; }

echo "== Checks (pnpm test for the Worker and the collector policy)"
pnpm exec vitest run apps/recalls-worker packages/product-recall-structuring tooling/test/local-collector.test.ts
pnpm -s collector:policy:check

cd "$WORKER"
echo "== D1 migration state"
npx wrangler d1 migrations list data-foundry-recalls --remote

if [[ $APPLY -eq 0 ]]; then
  echo "Dry run complete. Re-run with --apply to bookmark, migrate, deploy and mint the collector credential."
  exit 0
fi

echo "== Time Travel bookmark (restore point)"
npx wrangler d1 time-travel info data-foundry-recalls | tee "/tmp/df-bookmark-$(date -u +%Y%m%dT%H%M%SZ).txt"

echo "== Apply migration 0004 (adds tables only)"
npx wrangler d1 migrations apply data-foundry-recalls --remote

echo "== Deploy data-foundry-recalls"
npx wrangler deploy

echo "== Verify the live API root names each dataset's registry key"
curl -fsS "$API/" | grep -q '"registry"' || { echo "The API root does not show registry keys; deploy not live yet?" >&2; exit 1; }

echo "== Mint the collector's ingestion credential (shown once; store it only in the collector: set-secret ingest-token)"
curl -fsS -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$API/admin/ingest-credentials?label=owner-windows-collector&sources=cpsc-recalls"
echo
echo "== Intake probe (without a credential, an open and healthy intake answers 401)"
code="$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/v1/intake/product-recalls/identifiers")"
if [[ "$code" == "503" ]]; then
  echo "Deployed, but the intake is closed (503): COLLECTOR_INTAKE_OPEN is not \"1\". Set it in wrangler.toml and deploy again." >&2
  exit 2
elif [[ "$code" != "401" ]]; then
  echo "The intake probe answered $code, not 401: the deploy is not verified." >&2
  exit 1
fi
echo "Intake open and refusing unauthenticated submissions (401). Record the Worker version and bookmark in PROGRESS.md."
