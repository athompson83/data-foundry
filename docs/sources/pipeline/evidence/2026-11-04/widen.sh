#!/bin/bash
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
for u in https://www.productsafety.gov.au/rss/feed.xml/psa_recall https://www.fsis.usda.gov/fsis/api/recall/v/1 https://www.recalls.govt.nz/ "https://www.gov.uk/api/search.json?filter_format=product_safety_alert_report_recall&count=1" "https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en" "https://api.nhtsa.gov/recalls/recallsByVehicle?make=ford&model=f-150&modelYear=2022" "https://www.cpsc.gov/Recalls/CPSC-Recalls-Application-Program-Interface-API-Information" "https://www.consumerreports.org/" "https://data.gov.sg/api/action/package_search?q=recall&rows=1" "https://www.mhlw.go.jp/" ; do
 printf '%s | ' "$u"; curl -sS -m 40 -A "$UA" -o /tmp/w_body -w '%{http_code} %{size_download} %{content_type}' -L "$u" 2>&1 | tail -1; echo
done
