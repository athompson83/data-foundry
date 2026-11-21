#!/usr/bin/env python3
"""Screening 2026-11-16: contaminated-sites. Fetches every source live (stdlib only).
Run from this directory with: python3 -I csite_measure.py   -> writes csite_measure.json
(optional argv[1]: path for the candidate pairs used in csite_handcheck.json; kept outside the repo)
Output holds site identifiers, site (facility/organisation) names, places and counts only. Owner, operator,
case-manager and project-manager fields are never written (some are natural persons).

Members:
  US EPA SEMS via Envirofacts (data.epa.gov/efservice/sems.*): every CERCLA site with EPA ID, NPL status, contaminants.
  US EPA NPL sites with status information (EPA ArcGIS feature service): NPL milestones + cited FR notice URLs.
  Federal Register API (federalregister.gov): NPL proposal/listing/deletion notices (free text).
  New York DEC Environmental Remediation Sites (data.ny.gov Socrata): state registry with contaminants.
  Connecticut DEEP contaminated or potentially contaminated sites (data.ct.gov Socrata).
  New Jersey DEP Known Contaminated Sites List (mapsdep.nj.gov ArcGIS).
  Canada Federal Contaminated Sites Inventory (TBS, XML zip).
  California DTSC EnviroStor (probe only).
Joins:
  declared: NPL layer Site_EPA_ID -> SEMS epa_id (same publisher, EPA site ID).
  declared: NPL layer cited Federal Register notice URLs (govinfo FR document number) -> federalregister.gov document.
  candidate: NY DEC / CT DEEP / NJ KCS site name + same municipality -> SEMS site in that state (pairs written for review).
  measured: how many state-registry records carry an EPA site ID at all.
"""
import json, re, time, io, zipfile, urllib.request, urllib.parse
import xml.etree.ElementTree as ET
from collections import Counter

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}
pairs = {}
NREQ = [0]


def get(u, tries=3, timeout=300):
    for i in range(tries):
        NREQ[0] += 1
        try:
            r = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(r, timeout=timeout) as f:
                return f.status, f.headers.get("Content-Type", ""), f.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, e.headers.get("Content-Type", ""), e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, "", str(e).encode()
            time.sleep(5)


def jget(u):
    s, ct, b = get(u)
    try:
        return s, json.loads(b)
    except Exception:
        return s, None


EPA_ID = re.compile(r"\b[A-Z]{2}[A-Z0-9]\d{9}\b")
STOP = {"INC", "CO", "CORP", "CORPORATION", "COMPANY", "LLC", "LTD", "THE", "SITE", "SUPERFUND", "OF", "AND", "FORMER", "FMR"}


def norm(s):
    s = re.sub(r"\(.*?\)", " ", (s or "").upper())
    s = re.sub(r"\bOU\s*\d+\b", " ", s)
    s = re.sub(r"[^A-Z0-9 ]+", " ", s.replace("&", " AND "))
    return " ".join(w for w in s.split() if w not in STOP)


def city(s):
    s = re.sub(r"[^A-Z ]+", " ", (s or "").upper())
    s = re.sub(r"\b(TOWN|CITY|VILLAGE|BORO|BOROUGH|TWP|TOWNSHIP|OF)\b", " ", s)
    return " ".join(s.split())


def ymd(s):  # "06/24/1988" -> "1988-06-24"
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", s or "")
    return f"{m.group(3)}-{m.group(1)}-{m.group(2)}" if m else None


# ------------------------------------------------------------ 1. EPA SEMS via Envirofacts
sems, start, step = [], 1, 10000
while True:
    s, d = jget(f"https://data.epa.gov/efservice/sems.envirofacts_site/{start}:{start + step - 1}/JSON")
    if s != 200 or not isinstance(d, list):
        out.setdefault("sems_errors", []).append({"start": start, "status": s})
        break
    sems += d
    if len(d) < step:
        break
    start += step
    time.sleep(1)
out["sems_sites"] = len(sems)
out["sems_fields"] = sorted(sems[0].keys()) if sems else []
out["sems_npl_status"] = dict(Counter(x.get("npl_status_name") for x in sems).most_common())
out["sems_archived"] = sum(1 for x in sems if x.get("archived_ind") == "Y")
out["sems_with_epa_id"] = sum(1 for x in sems if x.get("epa_id"))
out["sems_with_latlon"] = sum(1 for x in sems if x.get("primary_latitude_decimal_val"))
out["sems_newest_non_npl_status_date"] = max((x.get("non_npl_status_date") or "" for x in sems), default=None)
out["sems_newest_archived_date"] = max((x.get("archived_date") or "" for x in sems), default=None)
sems_by_epa = {x["epa_id"]: x for x in sems if x.get("epa_id")}
sems_by_site = {str(x.get("site_id") or "").lstrip("0"): x for x in sems}
out["sems_epa_id_unique"] = len(sems_by_epa)

cont, start = [], 1
for _ in range(15):
    s, d = jget(f"https://data.epa.gov/efservice/sems.envirofacts_contaminants/{start}:{start + step - 1}/JSON")
    if s != 200 or not isinstance(d, list):
        out.setdefault("sems_contaminant_errors", []).append({"start": start, "status": s})
        break
    cont += d
    if len(d) < step:
        break
    start += step
    time.sleep(1)
out["sems_contaminant_rows"] = len(cont)
out["sems_contaminant_rows_complete"] = len(cont) % step != 0
out["sems_sites_with_contaminants"] = len({c.get("fk_site_id") for c in cont})
out["sems_contaminant_media"] = dict(Counter(c.get("media_name") for c in cont).most_common(10))
out["sems_contaminant_top"] = dict(Counter(c.get("preferred_contaminant_name") for c in cont).most_common(10))
out["sems_contaminant_action"] = dict(Counter(c.get("action_name") for c in cont).most_common(6))
out["sems_contaminant_site_ids_resolve"] = f"{sum(1 for i in {c.get('fk_site_id') for c in cont} if str(i or '').lstrip('0') in sems_by_site)}/{len({c.get('fk_site_id') for c in cont})}"

# ------------------------------------------------------------ 2. EPA NPL ArcGIS layer
NPL = "https://services.arcgis.com/cJ9YHowT8TU7DUyn/arcgis/rest/services/Superfund_National_Priorities_List_(NPL)_Sites_with_Status_Information/FeatureServer/0"
s, meta = jget(NPL + "?f=json")
out["npl_layer"] = {"status": s, "name": (meta or {}).get("name"), "data_last_edit_ms": ((meta or {}).get("editingInfo") or {}).get("dataLastEditDate")}
npl, off = [], 0
while True:
    q = urllib.parse.urlencode({"where": "1=1", "outFields": "*", "returnGeometry": "false", "resultOffset": off, "resultRecordCount": 1000, "orderByFields": "ObjectId2", "f": "json"})
    s, d = jget(NPL + "/query?" + q)
    feats = (d or {}).get("features") or []
    npl += [f["attributes"] for f in feats]
    if not feats or not (d or {}).get("exceededTransferLimit"):
        break
    off += len(feats)
    time.sleep(1)
out["npl_sites"] = len(npl)
out["npl_status"] = dict(Counter(x.get("Status") for x in npl).most_common())
out["npl_partial_deletion"] = dict(Counter(x.get("Site_has_had_a_Partial_Deletion") for x in npl))
for k in ["Proposed_Date", "Listing_Date", "Construction_Completion_Date", "NOID_Date", "Deletion_Date"]:
    ds = [ymd(x.get(k)) for x in npl if ymd(x.get(k))]
    out[f"npl_{k.lower()}"] = {"present": len(ds), "newest": max(ds) if ds else None}
for k in ["Site_Listing_Narrative", "Site_Progress_Profile", "Proposed_FR_Notice", "Final_FR_Notice", "NOID_FR_Notice", "Deletion_FR_Notice"]:
    out[f"npl_{k.lower()}_links"] = sum(1 for x in npl if "href" in (x.get(k) or ""))

# declared join A: Site_EPA_ID -> SEMS epa_id; SEMS_ID -> SEMS site_id
ids = [x.get("Site_EPA_ID") for x in npl if x.get("Site_EPA_ID")]
ok = [i for i in ids if i in sems_by_epa]
sid_ok = sum(1 for x in npl if x.get("SEMS_ID") and sems_by_epa.get(x.get("Site_EPA_ID")) and str(sems_by_epa[x["Site_EPA_ID"]].get("site_id") or "").lstrip("0") == str(x["SEMS_ID"]))
st_ok = 0
for x in npl:
    e = sems_by_epa.get(x.get("Site_EPA_ID"))
    if e and ((x.get("Status") or "").startswith("Deleted") == (e.get("npl_status_code") == "D")):
        st_ok += 1
out["join_npl_epa_id_to_sems"] = {"matched": len(ok), "total": len(ids), "sems_id_agrees": sid_ok, "deleted_status_agrees": st_ok}

# declared join B: cited FR notice URLs -> federalregister.gov documents
GOVINFO = re.compile(r"govinfo\.gov/content/pkg/FR-(\d{4}-\d{2}-\d{2})/(?:pdf|html)/([A-Z]?\d{2,4}-\d{3,6})\.(?:pdf|htm)")
cites = []
for x in npl:
    for k in ["Proposed_FR_Notice", "Final_FR_Notice", "NOID_FR_Notice", "Deletion_FR_Notice"]:
        v = x.get(k) or ""
        m = GOVINFO.search(v)
        if m:
            cites.append({"epa_id": x.get("Site_EPA_ID"), "site": x.get("Site_Name"), "field": k, "date": m.group(1), "doc": m.group(2)})
        elif "href" in v:
            host = re.search(r"https?://([^/\"]+)", v)
            out.setdefault("npl_fr_link_hosts_other", Counter())[host.group(1) if host else "?"] += 1
out["npl_fr_link_hosts_other"] = dict(out.get("npl_fr_link_hosts_other", {}))
out["npl_fr_citations_govinfo"] = {"total": len(cites), "by_field": dict(Counter(c["field"] for c in cites)), "since_1994": sum(1 for c in cites if c["date"] >= "1994-01-01")}
docs = {}
todo = sorted({c["doc"] for c in cites if c["date"] >= "1994-01-01"})
for i in range(0, len(todo), 40):
    batch = todo[i:i + 40]
    q = "&".join("fields[]=" + f for f in ["document_number", "title", "abstract", "publication_date", "type", "agencies"])
    s, d = jget(f"https://www.federalregister.gov/api/v1/documents/{','.join(batch)}.json?{q}")
    for r in (d or {}).get("results", []) if isinstance(d, dict) else []:
        docs[r["document_number"]] = r
    time.sleep(1)
fr_join = [c for c in cites if c["date"] >= "1994-01-01"]
res = [c for c in fr_join if c["doc"] in docs]
same_date = [c for c in res if docs[c["doc"]].get("publication_date") == c["date"]]
epa_agency = [c for c in res if any("Environmental Protection" in (a.get("name") or "") for a in docs[c["doc"]].get("agencies") or [])]


def site_in_text(c):
    toks = [w for w in norm(c["site"]).split() if len(w) > 3][:2]
    txt = norm((docs[c["doc"]].get("title") or "") + " " + (docs[c["doc"]].get("abstract") or ""))
    return bool(toks) and all(t in txt.split() for t in toks)


named = [c for c in res if site_in_text(c)]
out["join_npl_fr_notice_url_to_federalregister"] = {
    "citations_since_1994": len(fr_join), "distinct_documents": len(todo), "resolved": len(res),
    "same_publication_date": len(same_date), "epa_agency": len(epa_agency), "site_named_in_title_or_abstract": len(named),
    "by_field_resolved": dict(Counter(c["field"] for c in res)),
}
out["join_npl_fr_samples"] = [{k: c[k] for k in ("epa_id", "field", "doc", "date")} | {"fr_title": docs[c["doc"]].get("title")} for c in res[:12]]

# ------------------------------------------------------------ 3. Federal Register search (free text)
FRQ = "https://www.federalregister.gov/api/v1/documents.json?" + urllib.parse.urlencode({"conditions[term]": '"National Priorities List"', "conditions[agencies][]": "environmental-protection-agency", "per_page": 100, "order": "newest", "fields[]": ["document_number", "title", "abstract", "publication_date", "type"]}, doseq=True)
s, d = jget(FRQ)
fr = (d or {}).get("results", [])
out["fr_npl_documents_epa"] = (d or {}).get("count")
out["fr_newest_publication"] = fr[0]["publication_date"] if fr else None
out["fr_sample_types"] = dict(Counter(r.get("type") for r in fr))
out["fr_sample_deletion_notices"] = sum(1 for r in fr if re.search(r"delet", (r.get("title") or "") + (r.get("abstract") or ""), re.I))
out["fr_sample_with_site_in_abstract"] = sum(1 for r in fr if re.search(r"Superfund Site", r.get("abstract") or "", re.I))
out["fr_sample_abstract_epa_id"] = sum(1 for r in fr if EPA_ID.search(r.get("abstract") or ""))
out["fr_sample_abstract_mean_chars"] = round(sum(len(r.get("abstract") or "") for r in fr) / max(1, len(fr)))

# ------------------------------------------------------------ 4. state registries
def soql(domain, rid, params):
    s, d = jget(f"https://{domain}/resource/{rid}.json?" + urllib.parse.urlencode(params))
    return d if isinstance(d, list) else []


# New York DEC
ny = soql("data.ny.gov", "c6ci-rzpg", {"$select": "program_number,program_type,siteclass,program_facility_name,locality,county,count(*)", "$group": "program_number,program_type,siteclass,program_facility_name,locality,county", "$limit": 50000})
s, nym = jget("https://data.ny.gov/api/views/c6ci-rzpg.json")
out["ny_rows"] = int(next((c.get("cachedContents", {}).get("non_null") for c in (nym or {}).get("columns", []) if c["fieldName"] == "program_number"), 0) or 0)
out["ny_rows_updated_epoch"] = (nym or {}).get("rowsUpdatedAt")
out["ny_sites"] = len({r["program_number"] for r in ny})
out["ny_program_type"] = dict(Counter(r.get("program_type") for r in ny).most_common())
out["ny_siteclass"] = dict(Counter(r.get("siteclass") for r in ny).most_common())
nyc = soql("data.ny.gov", "c6ci-rzpg", {"$select": "count(distinct program_number)", "$where": "contaminants is not null"})
out["ny_sites_with_contaminants"] = int(list(nyc[0].values())[0]) if nyc else None
nyt = soql("data.ny.gov", "c6ci-rzpg", {"$select": "contaminants,count(*)", "$group": "contaminants", "$order": "count(*) desc", "$limit": 8})
out["ny_top_contaminants"] = {r.get("contaminants"): int(r.get("count") or 0) for r in nyt}
out["ny_epa_id_in_name_or_number"] = sum(1 for r in ny if EPA_ID.search((r.get("program_facility_name") or "") + " " + (r.get("program_number") or "")))

# Connecticut DEEP
ct = soql("data.ct.gov", "xcxg-6jqp", {"$select": "site_id_site_id,case_number,agency_id,case_program,case_name,official_town,case_status,cleanup_stage", "$limit": 50000})
out["ct_cases"] = len(ct)
out["ct_sites"] = len({r.get("site_id_site_id") for r in ct})
out["ct_case_program_top"] = dict(Counter(r.get("case_program") for r in ct).most_common(8))
out["ct_case_status"] = dict(Counter(r.get("case_status") for r in ct).most_common())
out["ct_epa_id_anywhere"] = sum(1 for r in ct if any(EPA_ID.search(str(v)) for v in r.values()))
s, ctm = jget("https://data.ct.gov/api/views/xcxg-6jqp.json")
out["ct_license"] = ((ctm or {}).get("license") or {}).get("name")
out["ct_rows_updated_epoch"] = (ctm or {}).get("rowsUpdatedAt")

# New Jersey DEP Known Contaminated Sites
NJ = "https://mapsdep.nj.gov/arcgis/rest/services/Features/Environmental_NJEMS/MapServer/0"
s, d = jget(NJ + "/query?where=1%3D1&returnCountOnly=true&f=json")
out["nj_kcs_count"] = (d or {}).get("count")
nj, off = [], 0
while off < 2000 * 12:
    q = urllib.parse.urlencode({"where": "NPL_STATUS IS NOT NULL", "outFields": "SITE_ID,PI_NAME,PI_NUMBER,STATUS,NPL_STATUS,NPL_DATE,MUNIC,COUNTY,DATALOAD_DATE", "returnGeometry": "false", "resultOffset": off, "resultRecordCount": 2000, "f": "json"})
    s, d = jget(NJ + "/query?" + q)
    feats = (d or {}).get("features") or []
    nj += [f["attributes"] for f in feats]
    if len(feats) < 2000:
        break
    off += 2000
out["nj_kcs_with_npl_status"] = len(nj)
out["nj_npl_status_values"] = dict(Counter(x.get("NPL_STATUS") for x in nj).most_common())
out["nj_dataload_newest_ms"] = max((x.get("DATALOAD_DATE") or 0 for x in nj), default=None)
out["nj_epa_id_anywhere"] = sum(1 for x in nj if any(EPA_ID.search(str(v)) for v in x.values()))
s, d = jget(NJ + "/query?" + urllib.parse.urlencode({"where": "1=1", "outStatistics": json.dumps([{"statisticType": "count", "onStatisticField": "OBJECTID", "outStatisticFieldName": "n"}]), "groupByFieldsForStatistics": "STATUS", "f": "json"}))
out["nj_kcs_status"] = {f["attributes"].get("STATUS"): f["attributes"].get("n") for f in (d or {}).get("features", [])}

# ------------------------------------------------------------ 5. candidate joins state -> SEMS (same state)
def sems_index(state):
    idx = {}
    for x in sems:
        if x.get("fk_ref_state_code") == state:
            idx.setdefault(city(x.get("city_name")), []).append(x)
    return idx


def match(name, town, idx):
    n = norm(name)
    if len(n) < 5:
        return None
    for x in idx.get(city(town), []):
        m = norm(x.get("name"))
        if len(m) >= 5 and (n == m or (len(min(n, m, key=len)) >= 8 and (n in m or m in n))):
            return x
    return None


def run_join(label, rows, name_k, town_k, id_k, state):
    idx = sems_index(state)
    got = []
    for r in rows:
        x = match(r.get(name_k), r.get(town_k), idx)
        if x:
            got.append({"state_id": r.get(id_k), "state_name": r.get(name_k), "state_town": r.get(town_k),
                        "epa_id": x["epa_id"], "sems_name": x.get("name"), "sems_city": x.get("city_name"), "sems_npl": x.get("npl_status_code")})
    pairs[label] = got
    return got


nyd = {}
for r in ny:
    nyd.setdefault(r["program_number"], r)
ny_rows = list(nyd.values())
g = run_join("ny_dec_to_sems", ny_rows, "program_facility_name", "locality", "program_number", "NY")
ny_npl_sems = sum(1 for x in sems if x.get("fk_ref_state_code") == "NY" and x.get("npl_status_code") in ("F", "D"))
out["join_ny_dec_name_city_to_sems"] = {"matched": len(g), "total": len(ny_rows), "matched_npl_final_or_deleted": sum(1 for p in g if p["sems_npl"] in ("F", "D")), "sems_ny_npl_final_or_deleted": ny_npl_sems}

ct_npl = [r for r in ct if (r.get("case_program") or "").startswith("Federal Remediation")]
g = run_join("ct_deep_to_sems", ct_npl, "case_name", "official_town", "case_number", "CT")
out["join_ct_federal_remediation_name_town_to_sems"] = {"matched": len(g), "total": len(ct_npl)}

g = run_join("nj_kcs_to_sems", nj, "PI_NAME", "MUNIC", "PI_NUMBER", "NJ")
out["join_nj_kcs_npl_name_munic_to_sems"] = {"matched": len(g), "total": len(nj)}

# ------------------------------------------------------------ 6. Canada FCSI
s, ct_, b = get("https://map-carte.tbs-sct.gc.ca/fcsi-rscf/oddo/fcsi-rscf.zip")
out["fcsi_zip"] = {"status": s, "bytes": len(b)}
if s == 200:
    root = ET.fromstring(zipfile.ZipFile(io.BytesIO(b)).read("fcsi-rscf.xml"))
    sites = root.find("Sites")
    st, cls, contam, lastmod, orgs, prop, active_cont = Counter(), Counter(), Counter(), [], Counter(), 0, 0
    for site in sites:
        st[site.findtext("SiteStatus/Status/EN")] += 1
        cls[site.findtext("Classification/Name/EN")] += 1
        orgs[site.get("ReportingOrganization")] += 1
        lastmod.append(site.get("LastModified") or "")
        if (site.findtext("PropertyNumber") or "").strip():
            prop += 1
        cs = {c.findtext("EN") for c in site.findall("ContaminationDetails/ContaminatedMedia/Contamination")}
        if cs:
            active_cont += 1
        for c in cs:
            contam[c] += 1
    out["fcsi"] = {"sites": len(sites), "status": dict(st.most_common()), "classification": dict(cls.most_common()),
                   "reporting_orgs": len(orgs), "newest_last_modified": max(lastmod), "with_property_number": prop,
                   "with_contaminants": active_cont, "top_contaminants": dict(contam.most_common(6))}

# ------------------------------------------------------------ 7. California EnviroStor probe
s, ct_, b = get("https://www.envirostor.dtsc.ca.gov/public/data_download", tries=1)
txt = b.decode("utf8", "replace")
out["envirostor_probe"] = {"status": s, "bytes": len(b), "cloudflare_challenge": ("Just a moment" in txt) or ("_cf_chl_opt" in txt)}

out["requests"] = NREQ[0]
def clean(o):
    if isinstance(o, dict):
        return {str(k): clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    return o


out = clean(out)
json.dump(out, open("csite_measure.json", "w"), indent=1, sort_keys=True, default=str)
import sys
if len(sys.argv) > 1:  # pairs carry free-form state site names: written outside the repo for review only
    json.dump(pairs, open(sys.argv[1], "w"), indent=1)
print(json.dumps(out, indent=1, default=str)[:6000])
