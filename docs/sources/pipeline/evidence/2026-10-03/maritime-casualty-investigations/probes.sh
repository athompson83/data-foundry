#!/usr/bin/env bash
# Reachability / terms probes for the PARKED members (run 2026-10-03). Each prints "HTTP-status size url".
UA='User-Agent: data-foundry-scout (data@mail.proviciency.com)'
for u in \
 https://www.tsb.gc.ca/sites/default/files/stats/MARSISdb_MDOTW_VW_OCCURRENCE_PUBLIC.csv \
 https://www.tsb.gc.ca/eng/rapports-reports/marine/index.html \
 https://open.canada.ca/data/api/action/package_show?id=ad8d1b73-df09-4521-9bdb-61c529328218 \
 https://www.atsb.gov.au/marine-investigations https://www.atsb.gov.au/ \
 https://www.turvallisuustutkinta.fi/en/information-about-webpage/ \
 'https://www.turvallisuustutkinta.fi/wp-json/wp/v2/tutkinta?per_page=1' \
 https://www.bsu-bund.de/EN/Service/Termsandconditions/Terms_and_conditions_node.html \
 https://www.bsu-bund.de/EN/Publications/Unfallberichte/Unfallberichte_node.html \
 https://onderzoeksraad.nl/en/wp-json/wp/v2/ https://onderzoeksraad.nl/en/home/disclaimer-2/ \
 https://msiu.gov.mt https://www.bea-mer.developpement-durable.gouv.fr/rapports-d-enquete \
 https://data.ntsb.gov/carol-main-public/api/Query/Main https://dmaib.com/reports/2023; do
  curl -sS -m 40 -L -H "$UA" -o /dev/null -w "%{http_code} %{size_download} $u\n" "$u" 2>&1 | tail -1; sleep 0.5; done
