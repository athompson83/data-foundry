#!/bin/bash
# Reachability probe, 2026-11-03. Declared UA; one request per URL; prints status, bytes, content-type.
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
while read -r name url; do
  out=$(curl -sS -m 40 -A "$UA" -o /tmp/probe_body -w '%{http_code} %{size_download} %{content_type}' -L "$url" 2>&1 | tail -1)
  echo "$name | $out | $(head -c 160 /tmp/probe_body 2>/dev/null | tr '\n\r' '  ')"
done <<'EOF'
nga-msi-navwarn https://msi.nga.mil/api/publications/broadcast-warn?output=json&status=active
usgs-nas-species https://nas.er.usgs.gov/api/v2/species?genus=Dreissena
avalanche-org-map https://api.avalanche.org/v2/public/products/map-layer
avalanche-ca-areas https://api.avalanche.ca/forecasts/en/areas
hudoc-echr https://hudoc.echr.coe.int/app/query/results?query=contentsitename:ECHR%20AND%20(documentcollectionid2:%22JUDGMENTS%22)&select=itemid,docname,ecli,kpdate&sort=kpdate%20Descending&start=0&length=3
eurlex-cellar https://publications.europa.eu/webapi/rdf/sparql?query=SELECT%20%3Fs%20WHERE%20%7B%3Fs%20%3Fp%20%3Fo%7D%20LIMIT%201
epa-tri-envirofacts https://data.epa.gov/efservice/tri_facility/rows/0:2/JSON
cdc-han https://www.cdc.gov/han/rss.xml
accc-recalls https://www.productsafety.gov.au/recalls
fsis-api https://www.fsis.usda.gov/fsis/api/recall/v/1
scc-decisions https://decisions.scc-csc.ca/scc-csc/en/rss/
ecdc-cdtr https://www.ecdc.europa.eu/en/publications-data/communicable-disease-threats-report
nws-afd https://api.weather.gov/products/types/AFD
nz-recalls https://www.recalls.govt.nz/
uk-ukhsa-api https://www.gov.uk/api/search.json?filter_format=research_for_development_output&count=1
bsee-incidents https://www.data.bsee.gov/Main/HtmlPage.aspx
noaa-fisheries-bulletins https://www.fisheries.noaa.gov/api/v1/bulletins
cgc-navwarn https://www.notmar.gc.ca/
EOF
