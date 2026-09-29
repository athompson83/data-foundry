#!/usr/bin/env bash
# Screening probe: one request per URL with the declared User-Agent. Prints status, bytes, content-type, final URL.
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
while read -r label url; do
  [ -z "$label" ] && continue
  out=$(curl -sS -m 40 -L -A "$UA" -o /tmp/probe.$$ -w '%{http_code} %{size_download} %{content_type}' "$url" 2>&1 | tail -1)
  echo "$label | $out | $url"
  rm -f /tmp/probe.$$
done
