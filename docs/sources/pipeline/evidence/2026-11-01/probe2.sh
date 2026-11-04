#!/usr/bin/env bash
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
p(){ n="$1"; shift; out=$(curl -sS -m 40 -L -A "$UA" -o /tmp/probe2.$$ -w "%{http_code} %{size_download} %{content_type}" "$@" 2>&1); echo "== $n :: $out"; head -c ${HEADC:-250} /tmp/probe2.$$ | tr '\n' ' '; echo; }
p lda-filings "https://lda.senate.gov/api/v1/filings/?filing_year=2026&page_size=1"
p lda-terms https://lda.senate.gov/api/redoc/v1/
p ca-lobbying-ckan "https://open.canada.ca/data/api/action/package_search?q=lobbying+registry&rows=3"
p eu-transparency "https://data.europa.eu/api/hub/search/search?q=transparency+register&limit=2"
p regs-dockets "https://api.regulations.gov/v4/dockets?filter[docketType]=Rulemaking&page[size]=5&api_key=DEMO_KEY"
p regs-docs-prop "https://api.regulations.gov/v4/documents?filter[documentType]=Proposed%20Rule&filter[postedDate][ge]=2026-10-01&page[size]=5&api_key=DEMO_KEY"
p fr-api "https://www.federalregister.gov/api/v1/documents.json?conditions[type][]=PRORULE&conditions[publication_date][gte]=2026-10-01&per_page=2"
p fdic-inst "https://api.fdic.gov/banks/institutions?limit=1"
p fdic-orders "https://orders.fdic.gov/"
p openfda-vet-fields "https://api.fda.gov/animalandveterinary/event.json?limit=1&search=receivedate:[20260101+TO+20261031]"
