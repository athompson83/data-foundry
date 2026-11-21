#!/bin/bash
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
p(){ printf '%s ' "$1"; curl -sS -m 40 -A "$UA" -o /tmp/p3.out -w '%{http_code} %{size_download}\n' "$1" || echo FAIL; }
# lobbying disclosures
p "https://lda.senate.gov/api/v1/filings/?page_size=1"
p "https://lda.gov/api/v1/filings/?page_size=1"
p "https://lobbycanada.gc.ca/app/secure/ocl/lrs/do/guest?lang=eng"
p "https://open.canada.ca/data/api/action/package_show?id=a35cf382-690c-4221-a971-cf0fd189a46f"
p "https://data.parliament.uk/"
p "https://ec.europa.eu/transparencyregister/public/consultation/statistics.do"
p "https://data.europa.eu/api/hub/search/search?q=transparency%20register&limit=1"
# historic places
p "https://www.nps.gov/subjects/nationalregister/database-research.htm"
p "https://services.arcgis.com/tOmF4uLJZtAqgVqn/arcgis/rest/services/NRIS_Public_View/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json"
p "https://opendata.arcgis.com/api/v3/datasets?q=national%20register%20historic%20places&page%5Bsize%5D=1"
p "https://historicengland.org.uk/listing/the-list/data-downloads/"
p "https://services-eu1.arcgis.com/ZOdPfBS3aqqDYPUQ/arcgis/rest/services/National_Heritage_List_for_England_NHLE_v02_VIEW/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json"
p "https://www.historicplaces.ca/en/rep-reg/place-lieu.aspx?id=1"
p "https://parks.canada.ca/culture/designation/lieu-place"
p "https://catalogue.data.gov.bc.ca/api/3/action/package_search?q=heritage&rows=1"
p "https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q12418&props=claims&format=json"
# shipwrecks
p "https://nauticalcharts.noaa.gov/data/wrecks-and-obstructions.html"
p "https://www.ngdc.noaa.gov/mgg/wrecks/"
# regs
p "https://api.regulations.gov/v4/dockets?page[size]=5&api_key=DEMO_KEY"
p "https://www.federalregister.gov/api/v1/public-inspection-documents/current.json"
p "https://www.govinfo.gov/wssearch/getContentDetail?packageId=CHRG-118hhrg1"
p "https://api.congress.gov/v3/bill?api_key=DEMO_KEY&limit=1"
