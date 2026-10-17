"""Round 2026-09-30 screening measurements: sanctions lists, procurement, accident reports, case law, airworthiness directives.
Live requests, declared User-Agent. Writes screening.json. Acquisition script: the source bodies are not archived for a SCREENED round."""
import csv, io, json, re, subprocess, time, zipfile
import xml.etree.ElementTree as ET

UA = "DataFoundryScout/1.0 (data@mail.proviciency.com)"
strip = lambda tag: tag.split("}")[-1]


def fetch(url, body=None):
    cmd = ["curl", "-sS", "-L", "-m", "180", "-A", UA, url] + (["-H", "Content-Type: application/json", "-d", json.dumps(body)] if body else [])
    for attempt in range(4):
        done = subprocess.run(cmd, capture_output=True)
        if done.returncode == 0:
            return done.stdout
        time.sleep(2 ** attempt)
    raise RuntimeError(url)


out = {"round": "2026-09-30"}

# --- Sanctions designations: four official lists.
sdn = ET.fromstring(fetch("https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.XML"))
ns = sdn.tag.split("}")[0] + "}"
entries = sdn.findall(ns + "sdnEntry")
un = ET.fromstring(fetch("https://scsanctions.un.org/resources/xml/en/consolidated.xml"))
un_all = un.findall(".//INDIVIDUAL") + un.findall(".//ENTITY")
un_refs = {x.findtext("REFERENCE_NUMBER") for x in un_all}
eu = ET.fromstring(fetch("https://webgate.ec.europa.eu/fsd/fsf/public/files/xmlFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"))
eu_ents = [x for x in eu.iter() if strip(x.tag) == "sanctionEntity"]
eu_un = [x.attrib["unitedNationId"] for x in eu_ents if x.attrib.get("unitedNationId")]
uk_raw = fetch("https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.xml").decode("utf-8-sig")
uk_head = subprocess.run(["curl", "-sSI", "-A", UA, "https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.xml"], capture_output=True, text=True).stdout
out["sanctions"] = {
    "ofac_sdn": {"publish_date": sdn.findtext(f"{ns}publshInformation/{ns}Publish_Date"), "entries": len(entries),
                 "types": {t: sum(1 for e in entries if e.findtext(ns + "sdnType") == t) for t in ("Entity", "Individual", "Vessel", "Aircraft")},
                 "with_remarks": sum(1 for e in entries if e.findtext(ns + "remarks"))},
    "un_consolidated": {"generated": un.attrib.get("dateGenerated"), "individuals": len(un.findall(".//INDIVIDUAL")), "entities": len(un.findall(".//ENTITY")),
                        "with_comments": sum(1 for x in un_all if x.findtext("COMMENTS1"))},
    "eu_fsf": {"generated": eu.attrib.get("generationDate"), "entities": len(eu_ents), "citing_un_reference": len(eu_un),
               "cited_reference_resolves_in_un_list": sum(1 for v in eu_un if v in un_refs)},
    "uk_ofsi_conlist_2022format": {"last_modified_header": re.search(r"(?i)last-modified: (.*)", uk_head).group(1).strip(), "rows": len(re.findall(r"<GroupID>", uk_raw)),
                                   "groups": len(set(re.findall(r"<GroupID>(\d+)</GroupID>", uk_raw))),
                                   "distinct_statements_of_reasons": len(set(re.findall(r"<UKStatementOfReasons>([^<]+)</UKStatementOfReasons>", uk_raw)))},
}

# --- Procurement notices.
cf = json.loads(fetch("https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search?limit=100&publishedFrom=2026-09-28"))
cb = list(csv.DictReader(io.StringIO(fetch("https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv").decode("utf-8-sig"))))
out["tenders"] = {"uk_contracts_finder_ocds": {"license": cf["license"], "releases_in_page": len(cf["releases"]), "publisher": cf["publisher"]["name"]},
                  "canadabuys_open_tenders": {"rows": len(cb), "latest_publication": max(r["publicationDate-datePublication"] for r in cb),
                                              "with_english_description": sum(1 for r in cb if r.get("tenderDescription-descriptionAppelOffres-eng"))}}

# --- Accident reports.
aaib = json.loads(fetch("https://www.gov.uk/api/search.json?filter_format=aaib_report&count=1&fields=title,public_timestamp,link&order=-public_timestamp"))
csv.field_size_limit(10**9)
msha_zip = zipfile.ZipFile(io.BytesIO(fetch("https://arlweb.msha.gov/OpenGovernmentData/DataSets/Accidents.zip")))
msha = list(csv.DictReader(io.TextIOWrapper(msha_zip.open("Accidents.txt"), encoding="latin-1"), delimiter="|"))
out["accidents"] = {"uk_aaib": {"total": aaib["total"], "newest": aaib["results"][0]["public_timestamp"], "newest_title": aaib["results"][0]["title"]},
                    "msha_accidents": {"rows": len(msha), "earliest": min(r["ACCIDENT_DT"][6:] + r["ACCIDENT_DT"][:2] + r["ACCIDENT_DT"][3:5] for r in msha), "latest": max(r["ACCIDENT_DT"][6:] + r["ACCIDENT_DT"][:2] + r["ACCIDENT_DT"][3:5] for r in msha),
                                       "with_narrative": sum(1 for r in msha if r.get("NARRATIVE")), "with_equipment_manufacturer_and_model": sum(1 for r in msha if r["EQUIP_MFR_NAME"] and r["EQUIP_MODEL_NO"])}}

# --- Case law and airworthiness directives.
feed = fetch("https://caselaw.nationalarchives.gov.uk/atom.xml?per_page=2").decode()
fr = json.loads(fetch("https://www.federalregister.gov/api/v1/documents.json?conditions[agencies][]=federal-aviation-administration&conditions[type][]=RULE&conditions[term]=%22airworthiness+directives%22&per_page=1".replace("[", "%5B").replace("]", "%5D")))
out["caselaw_and_directives"] = {"uk_find_case_law": {"pages_of_2": int(re.search(r'per_page=2&amp;page=(\d+)" rel="last"', feed).group(1)), "rights_link": re.search(r"<rights>([^<]+)</rights>", feed).group(1)},
                                 "federal_register_faa_ad_rules": {"count_reported": fr["count"], "newest": fr["results"][0]["publication_date"]}}
json.dump(out, open("screening.json", "w"), indent=1)
print(json.dumps(out, indent=1))
