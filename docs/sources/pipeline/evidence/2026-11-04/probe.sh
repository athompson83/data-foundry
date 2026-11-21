#!/bin/bash
# Reachability probe, 2026-11-04. Declared UA; one request per URL; prints status, bytes, content-type.
UA="data-foundry-scout/1.0 (data@mail.proviciency.com)"
while read -r name url; do
  out=$(curl -sS -m 40 -A "$UA" -o /tmp/probe_body -w '%{http_code} %{size_download} %{content_type}' -L "$url" 2>&1 | tail -1)
  echo "$name | $out | $(head -c 160 /tmp/probe_body 2>/dev/null | tr '\n\r' '  ')"
done <<'EOF'
gazette-notices https://www.thegazette.co.uk/insolvency/notice/data.json?results-page-size=2
gazette-all https://www.thegazette.co.uk/all-notices/notice/data.json?noticetype=2450&results-page-size=2
cisa-csaf-index https://raw.githubusercontent.com/cisagov/CSAF/develop/csaf_files/OT/white/index.txt
cisa-csaf-changes https://raw.githubusercontent.com/cisagov/CSAF/develop/csaf_files/OT/white/changes.csv
siemens-csaf https://cert-portal.siemens.com/productcert/csaf/ssa-feed-tlp-white.json
siemens-csaf-index https://cert-portal.siemens.com/productcert/csaf/provider-metadata.json
schneider-csaf https://www.se.com/.well-known/csaf/provider-metadata.json
gao-reports https://www.gao.gov/rss/reports.xml
gao-api https://www.gao.gov/api/reports
oversight-gov https://www.oversight.gov/reports
oversight-api https://www.oversight.gov/api/reports
house-votes https://clerk.house.gov/evs/2026/roll001.xml
senate-votes https://www.senate.gov/legislative/LIS/roll_call_votes/vote1192/vote_119_2_00001.xml
senate-votes-menu https://www.senate.gov/legislative/LIS/roll_call_lists/vote_menu_119_2.xml
uk-commons-votes https://commonsvotes-api.parliament.uk/data/divisions.json/search?queryParameters.take=2
ca-house-votes https://www.ourcommons.ca/members/en/votes/xml
uk-nao https://www.nao.org.uk/wp-json/wp/v2/report?per_page=2
ca-oag https://www.oag-bvg.gc.ca/internet/English/parl_oag_lst_e_1.xml
vaers https://vaers.hhs.gov/data/datasets.html
yellowcard https://yellowcard.mhra.gov.uk/
canada-vigilance https://www.canada.ca/en/health-canada/services/drugs-health-products/medeffect-canada/adverse-reaction-database/canada-vigilance-online-database-data-extract.html
aphis-hpai https://www.aphis.usda.gov/livestock-poultry-disease/avian/avian-influenza/hpai-detections
orange-book https://www.fda.gov/media/76860/download
ecfr-title21 https://www.ecfr.gov/api/versioner/v1/titles.json
EOF
