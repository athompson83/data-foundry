#!/bin/sh
# Re-fetch the raw inputs used by screen.py/detail.py into raw/ (not committed: ~25MB).
UA='User-Agent: data-foundry-scout (data@mail.proviciency.com)'
mkdir -p raw; cd raw
curl -sS -H "$UA" -o fsa.json "https://data.food.gov.uk/food-alerts/id?_limit=5000"
curl -sS -H "$UA" -o hc.json "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json"
for e in food drug; do for s in 0 1000; do curl -sS -H "$UA" -o fda_${e}_$s.json "https://api.fda.gov/$e/enforcement.json?limit=1000&skip=$s&sort=report_date:desc"; sleep 1; done; done
curl -sS -H "$UA" -o fsanz_rss.xml https://www.foodstandards.gov.au/food-recalls-rss.xml
