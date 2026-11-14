#!/usr/bin/env bash
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
p(){ out=$(curl -sS -m 40 -A "$UA" -L -w '\n%{http_code}' "$2" 2>&1); code=$(echo "$out"|tail -1); body=$(echo "$out"|sed '$d'); echo "$1 | $code | ${#body} | $(echo "$body"|tr '\n' ' '|head -c 200)"; }
p accc "https://www.productsafety.gov.au/recalls"
p fsis "https://www.fsis.usda.gov/fsis/api/recall/v/1"
p safety-gate "https://ec.europa.eu/safety-gate-alerts/public/api/notification/carousel/?language=en"
p nz-mbie "https://www.productsafety.govt.nz/recalls"
p fsa-uk "https://data.food.gov.uk/food-alerts/id?_limit=2"
p fsanz "https://www.foodstandards.gov.au/food-recalls"
p tc-vrdb "https://data.tc.gc.ca/v1.3/api/eng/vehicle-recall-database/recall?format=json&limit=1"
p rappelconso "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/rappelconso-v2-gtin-espaces/records?limit=1"
p rappelconso-count "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/rappelconso-v2-gtin-espaces/records?limit=0"
