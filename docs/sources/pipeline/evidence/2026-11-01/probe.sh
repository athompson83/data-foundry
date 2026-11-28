#!/usr/bin/env bash
# Live reachability probes for the 2026-11-01 scout round. Declared UA per scout-routine.md.
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
p(){ n="$1"; shift; out=$(curl -sS -m 40 -A "$UA" -o /tmp/probe.$$ -w "%{http_code} %{size_download} %{content_type}" "$@" 2>&1); echo "== $n :: $out"; head -c ${HEADC:-300} /tmp/probe.$$ | tr '\n' ' '; echo; }
p grantsgov-search2 -X POST -H 'Content-Type: application/json' -d '{"rows":2,"oppStatuses":"posted|forecasted"}' https://api.grants.gov/v1/api/search2
p sedia-eu -X POST -H 'Content-Type: application/json' "https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA&text=***&pageSize=1&pageNumber=1" -d '{"bool":{"must":[{"terms":{"type":["1","2","8"]}},{"terms":{"status":["31094501","31094502"]}}]}}'
p uk-find-a-grant https://www.find-government-grants.service.gov.uk/grants
p samgov-cfda "https://sam.gov/api/prod/sgs/v1/search/?index=cfda&page=0&size=1&q=10.310&sort=-modifiedDate"
p usaspending-cfda https://api.usaspending.gov/api/v2/references/cfda/totals/10.310/
p usaspending-assistance-listing https://api.usaspending.gov/api/v2/references/assistance_listing/
p epa-eis-search "https://cdxapps.epa.gov/cdx-enepa-II/public/action/eis/search"
p iaac-registry "https://iaac-aeic.gc.ca/050/evaluations/"
p iaac-ckan "https://open.canada.ca/data/api/action/package_search?q=impact+assessment+registry&rows=3"
p vaers https://vaers.hhs.gov/data/datasets.html
p openfda-vet "https://api.fda.gov/animalandveterinary/event.json?limit=1"
p nbi https://www.fhwa.dot.gov/bridge/nbi/ascii.cfm
p ntrs "https://ntrs.nasa.gov/api/citations/search?q=hurricane&page.size=1"
p nhtsa-flat -I https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip
p nhtsa-api "https://api.nhtsa.gov/recalls/campaignNumber?campaignNumber=24E012"
p bsee https://www.data.bsee.gov/Main/Incidents.aspx
p regs-gov https://api.regulations.gov/v4/documents?api_key=DEMO_KEY
p ckan-datagov "https://catalog.data.gov/api/3/action/package_search?rows=1"
p ckan-ca "https://open.canada.ca/data/api/action/package_search?rows=1"
p ckan-uk "https://data.gov.uk/api/action/package_search?rows=1"
p ckan-eu "https://data.europa.eu/api/hub/search/search?limit=1"
