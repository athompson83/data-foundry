#!/usr/bin/env bash
# Download one allowlisted source snapshot (tooling/snapshots/plans.json), record every file's URL, bytes, SHA-256
# and retrieval time in manifest.json, and pack it as <out>/snapshot.tar.gz. Credential-free: it only reads open,
# free endpoints, one at a time with a pause between requests. The upload to R2 is the workflow's job.
# Usage: tooling/scripts/snapshot-source.sh <source-key> <out-dir>
set -euo pipefail
key="${1:?source key}"; out="${2:?output directory}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
plan="$root/tooling/snapshots/plans.json"
[[ "$key" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || { echo "invalid source key: $key" >&2; exit 2; }
record="$(jq -r --arg k "$key" '.sources[$k].rights_record // empty' "$plan")"
[[ -n "$record" ]] || { echo "$key is not in $plan" >&2; exit 2; }
[[ -f "$root/$record" ]] || { echo "rights record $record is missing; refusing to acquire" >&2; exit 2; }
ua="DataFoundryBot/1.0 (+https://data.aroqon.com; research snapshot)"
work="$out/$key"; rm -rf "$work"; mkdir -p "$work"
entries=()
fetch() { curl -fsS --retry 5 --retry-all-errors --retry-delay 15 --max-time 1800 -A "$ua" -o "$2" "$1"; }
while IFS=$'\t' read -r name url page order; do
  [[ "$url" == https://* ]] || { echo "refusing non-https URL for $name" >&2; exit 2; }
  [[ "$name" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid file name $name" >&2; exit 2; }
  retrieved="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if [[ -n "$page" ]]; then
    # Paged CSV ($limit/$offset over a stable order): keep the first header, append each page's rows, stop on an
    # empty page. A dropped connection retries one page, never the whole file.
    [[ "$page" =~ ^[0-9]+$ && "$order" =~ ^[a-z_]+$ ]] || { echo "invalid paging for $name" >&2; exit 2; }
    offset=0; : > "$work/$name"
    while :; do
      fetch "${url}?\$limit=${page}&\$offset=${offset}&\$order=${order}" "$work/.page"
      rows=$(( $(wc -l < "$work/.page") - 1 ))
      if [[ "$offset" == 0 ]]; then cat "$work/.page" > "$work/$name"; else tail -n +2 "$work/.page" >> "$work/$name"; fi
      echo "  $name: offset $offset, $rows lines"
      (( rows > 0 )) || break
      offset=$(( offset + page )); sleep 2
    done
    rm -f "$work/.page"
  else
    fetch "$url" "$work/$name"
  fi
  bytes="$(stat -c %s "$work/$name")"; sha="$(sha256sum "$work/$name" | cut -d' ' -f1)"
  entries+=("$(jq -n --arg n "$name" --arg u "$url" --arg r "$retrieved" --argjson b "$bytes" --arg s "$sha" '{path:$n,url:$u,retrieved_at:$r,bytes:$b,sha256:$s}')")
  echo "$name: $bytes bytes, sha256 $sha"
  sleep 2
done < <(jq -r --arg k "$key" '.sources[$k].files[] | [.name, .url, (.page_size // "" | tostring), (.order // "")] | @tsv' "$plan")
printf '%s\n' "${entries[@]}" | jq -s --arg k "$key" --arg r "$record" '{source: $k, rights_record: $r, files: .}' > "$work/manifest.json"
tar -C "$out" -czf "$out/snapshot.tar.gz" "$key"
echo "snapshot.tar.gz: $(stat -c %s "$out/snapshot.tar.gz") bytes, sha256 $(sha256sum "$out/snapshot.tar.gz" | cut -d' ' -f1)"
