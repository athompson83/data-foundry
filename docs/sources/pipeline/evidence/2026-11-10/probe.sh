#!/bin/bash
# Round 23 live probes. Declared UA; each line prints URL, HTTP code, bytes.
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
p(){ printf '%s ' "$1"; curl -sS -m 40 -A "$UA" -o /tmp/p.out -w '%{http_code} %{size_download}\n' "$1" || echo FAIL; }
# widening: recall agencies
p "https://www.productsafety.gov.au/recalls"
p "https://webgate.ec.europa.eu/safety-gate-alerts/public/api/notification/carousel/?language=en"
p "https://www.fsis.usda.gov/fsis/api/recall/v/1"
p "https://api.nhtsa.gov/recalls/recallsByVehicle?make=ford&model=f-150&modelYear=2020"
p "https://data.nhtsa.dot.gov/"
p "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart=2026-11-01"
p "https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json"
# new data types
p "https://api.fda.gov/drug/shortages.json?limit=1"
p "https://api.fda.gov/drug/ndc.json?limit=1"
p "https://clinicaltrials.gov/api/v2/studies?pageSize=1&countTotal=true"
p "https://api.fda.gov/device/event.json?limit=1"
p "https://api.fda.gov/drug/event.json?limit=1"
p "https://www.ncei.noaa.gov/pub/data/swdi/stormevents/csvfiles/"
p "https://api.fda.gov/food/event.json?limit=1"
p "https://www.federalregister.gov/api/v1/documents.json?per_page=1"
p "https://api.fda.gov/other/substance.json?limit=1"
p "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=recall&retmax=1"
p "https://api.fda.gov/tobacco/problem.json?limit=1"
p "https://api.fda.gov/animalandveterinary/event.json?limit=1"
p "https://www.osha.gov/ords/imis/establishment.search?p_logger=1"
p "https://api.fda.gov/device/udi.json?limit=1"
p "https://www.accessdata.fda.gov/rest/gudid/"
