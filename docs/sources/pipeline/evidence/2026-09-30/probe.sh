#!/usr/bin/env bash
# Reachability probe with the declared scout User-Agent. Usage: probe.sh name url
UA="DataFoundryScout/1.0 (data@mail.proviciency.com)"
while IFS='|' read -r name url; do
  [ -z "$name" ] && continue
  out=$(curl -sS -L -m 40 -A "$UA" -o /tmp/probe.$$ -w '%{http_code} %{content_type} %{size_download}' "$url" 2>&1 | tail -1)
  echo "$name | $out | $url"
done
