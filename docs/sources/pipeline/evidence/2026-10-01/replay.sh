#!/usr/bin/env bash
# Re-run this round's assessments from the preserved inputs and compare with the
# committed results. Needs CLOUDFLARE_ACCOUNT_ID and a Cloudflare token with R2
# read access (wrangler), python3 and jq.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
BUCKET=$(jq -r .archive.bucket "$HERE/inputs.json")
KEY=$(jq -r .archive.key "$HERE/inputs.json")
SHA=$(jq -r .archive.sha256 "$HERE/inputs.json")
(cd "$HERE/../../../../../apps/recalls-worker" && npx wrangler r2 object get "$BUCKET/$KEY" --file "$WORK/snapshot.tar.gz" --remote >/dev/null)
echo "$SHA  $WORK/snapshot.tar.gz" | sha256sum -c -
mkdir "$WORK/inputs" && tar -C "$WORK/inputs" -xzf "$WORK/snapshot.tar.gz"
status=0
while read -r script result; do
  (cd "$WORK/inputs" && python3 "$HERE/$script") > "$WORK/out.txt" 2>&1
  if diff -q "$WORK/out.txt" "$HERE/$result" >/dev/null; then echo "ok   $script"; else echo "DIFF $script"; status=1; fi
done < <(jq -r '.replay[] | "\(.[0]) \(.[1])"' "$HERE/inputs.json")
exit $status
