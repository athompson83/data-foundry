#!/usr/bin/env bash
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
p(){ local n="$1" u="$2"; r=$(curl -sS -m 90 -L -A "$UA" -o /tmp/p2.$$ -w '%{http_code} %{size_download} %{content_type}' "$u" 2>&1 | tail -1); echo "$n | $r | $u"; }
p nist-800-53-oscal 'https://raw.githubusercontent.com/usnistgov/oscal-content/main/nist.gov/SP800-53/rev5/json/NIST_SP-800-53_rev5_catalog.json'
p mitre-attack-stix 'https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json'
p mitre-capec 'https://raw.githubusercontent.com/mitre/cti/master/capec/2.1/stix-capec.json'
p mitre-cwe 'https://cwe.mitre.org/data/xml/cwec_latest.xml.zip'
p ctid-mapping 'https://raw.githubusercontent.com/center-for-threat-informed-defense/mappings-explorer/main/mappings/nist_800_53/attack-16.1/nist_800_53-rev5/enterprise/nist_800_53-rev5_attack-16.1-enterprise_json.json'
p nas-factsheet 'https://nas.er.usgs.gov/queries/FactSheet.aspx?speciesID=5'
p nhtsa-tsb-flat 'https://static.nhtsa.gov/odi/tsbs/TSBS_RECEIVED_2025-2026.zip'
p fueleconomy-zip 'https://www.fueleconomy.gov/feg/epadata/vehicles.csv.zip'
