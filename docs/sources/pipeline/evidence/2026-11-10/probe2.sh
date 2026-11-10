#!/bin/bash
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
p(){ printf '%s ' "$1"; curl -sS -m 40 -A "$UA" -o /tmp/p2.out -w '%{http_code} %{size_download}\n' "$1" || echo FAIL; }
# rail accident investigations
p "https://railroads.dot.gov/accident-and-incident-reporting"
p "https://data.transportation.gov/resource/rash-pd2d.json?\$limit=1"
p "https://www.gov.uk/raib-reports.atom"
p "https://www.tsb.gc.ca/eng/rapports-reports/rail/index.html"
# pipeline incidents
p "https://www.phmsa.dot.gov/data-and-statistics/pipeline/pipeline-incident-flagged-files"
p "https://data.transportation.gov/api/views/metadata/v1"
# nuclear event reports
p "https://www.nrc.gov/reading-rm/doc-collections/event-status/event/"
p "https://www.nrc.gov/reading-rm/doc-collections/event-status/event/en.html"
# dams
p "https://nid.sec.usace.army.mil/api/nation/csv"
p "https://nid.sec.usace.army.mil/api/dams/?format=json"
# bridges
p "https://www.fhwa.dot.gov/bridge/nbi/ascii2024.cfm"
# wildfire
p "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query?where=1%3D1&returnCountOnly=true&f=json"
p "https://incidents.fire.ca.gov/umbraco/api/IncidentApi/List?inactive=true&year=2025"
# spills
p "https://nrc.uscg.mil/"
p "https://www.epa.gov/enviro/web-services"
# patents
p "https://api.patentsview.org/patents/query?q=%7B%22patent_number%22%3A%2210000000%22%7D"
p "https://search.patentsview.org/api/v1/patent/"
p "https://data.epo.org/linked-data/"
p "https://developer.uspto.gov/"
# CPSC other
p "https://www.saferproducts.gov/RestWebServices/Recall?format=json&ProductName=heater&RecallDateStart=2026-01-01"
# NHTSA complaints / investigations flat files
p "https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip"
p "https://api.nhtsa.gov/recalls/campaignNumber?campaignNumber=24V001000"
