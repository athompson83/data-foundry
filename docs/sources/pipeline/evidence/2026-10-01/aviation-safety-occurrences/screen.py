#!/usr/bin/env python3
"""Screen the aviation-safety-occurrences members (2026-10-01).

Members measured: NTSB aviation (weekly MDB update files, 2026), UK AAIB (GOV.UK search + content API),
Transport Canada CADORS (open.canada.ca CSV, HTTP Range samples only). Probes for FAA registry, NASA ASRS,
BEA and TSB Canada are recorded as reachability/terms checks. Requires `mdb-export` (mdbtools).
Politeness: <= ~2 req/s, sampled downloads only. Usage: python3 screen.py  (WORK=/some/dir to cache files)
"""
import csv, io, json, os, re, subprocess, sys, time, zipfile, html, urllib.request, urllib.parse, collections

UA = {"User-Agent": "data-foundry-scout (data@mail.proviciency.com)"}
WORK = os.environ.get("WORK", "/tmp/aviation-work")
os.makedirs(WORK, exist_ok=True)
OUT = {"run_date": "2026-10-01", "probes": {}, "ntsb": {}, "aaib": {}, "cadors": {}, "links": {}}
csv.field_size_limit(10**8)


def get(url, rng=None, timeout=60, head=False):
    for _try in range(4):
        r = _get(url, rng, timeout, head)
        if r[0]:
            return r
        time.sleep(4)
    return r


def _get(url, rng=None, timeout=60, head=False):
    time.sleep(0.6)
    h = dict(UA)
    if rng:
        h["Range"] = f"bytes={rng[0]}-{rng[1]}"
    req = urllib.request.Request(url, headers=h, method="HEAD" if head else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, dict(r.headers), (b"" if head else r.read())
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), b""
    except Exception as e:  # noqa
        return 0, {"error": str(e)[:120]}, b""


def text(body):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", "", body.decode("utf8", "ignore"), flags=re.S)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))


# ---------------------------------------------------------------- probes (HEAD only, no large downloads)
for name, url in {
    "faa_registry_zip": "https://registry.faa.gov/database/ReleasableAircraft.zip",
    "faa_registry_inquiry": "https://registry.faa.gov/aircraftinquiry/",
    "asrs_home": "https://asrs.arc.nasa.gov/",
    "asrs_dbol": "https://asrs.arc.nasa.gov/search/dbol.html",
    "bea_reports": "https://bea.aero/en/investigation-reports/notified-events/",
    "bea_legal": "https://bea.aero/en/legal-notice/",
    "tsb_air_csv": "https://www.tsb.gc.ca/sites/default/files/stats/ASISdb_MDOTW_VW_OCCURRENCE_PUBLIC.csv",
    "ntsb_avdata_page": "https://data.ntsb.gov/avdata",
    "ntsb_web_policies": "https://www.ntsb.gov/about/Pages/Website-Policies.aspx",
    "aaib_search_api": "https://www.gov.uk/api/search.json?filter_format=aaib_report&count=1",
    "govuk_terms": "https://www.gov.uk/help/terms-conditions",
    "cadors_occ_csv": "https://opendatatc.tc.canada.ca/CADORS_Occurrence_Information.csv",
    "cadors_ac_csv": "https://opendatatc.tc.canada.ca/CADORS_Aircraft_Information.csv",
    "cadors_event_csv": "https://opendatatc.tc.canada.ca/CADORS_Occurrence_Event_Information.csv",
    "ogl_canada": "https://open.canada.ca/en/open-government-licence-canada",
}.items():
    for _try in range(3):
        s, h, _ = get(url, head=True)
        if s:
            break
        time.sleep(3)
    OUT["probes"][name] = {"url": url, "http": s, "content_length": h.get("content-length") or h.get("Content-Length"), "last_modified": h.get("last-modified") or h.get("Last-Modified")}

# ---------------------------------------------------------------- NTSB: weekly update files from 2026
s, _, body = get("https://data.ntsb.gov/avdata")
page = text(body)
rows = re.findall(r"(up\d\d[A-Z]{3}\.zip)\s+(\d+)/(\d+)/(\d{4})\s+[\d:]+\s+[AP]M\s+(\d+)", page)
want = [(n, int(sz)) for n, m, d, y, sz in rows if int(y) == 2026]
OUT["ntsb"]["avdata_listing"] = {
    "update_files_listed": len(rows), "fetched_2026_files": len(want), "fetched_bytes_total": sum(sz for _, sz in want),
    "full_db_avall_zip_bytes": int(re.search(r"avall\.zip\s+\S+\s+\S+\s+[AP]M\s+(\d+)", page).group(1)),
    "note": "avall.zip (96.6MB) is NOT used here; a first accidental GET of it was discarded (over the 50MB cap) and is disclosed in notes.md",
}
assert sum(sz for _, sz in want) < 30_000_000
events, aircraft, narr = {}, {}, {}
for name, _ in want:
    dest = os.path.join(WORK, name)
    if not os.path.exists(dest):
        s, _, b = get("https://data.ntsb.gov/avdata/FileDirectory/DownloadFile?fileID=" + urllib.parse.quote(f"C:\\avdata\\{name}", safe=""))
        if s != 200:
            continue
        open(dest, "wb").write(b)
    z = zipfile.ZipFile(dest)
    mdb = os.path.join(WORK, z.namelist()[0])
    if not os.path.exists(mdb):
        z.extract(z.namelist()[0], WORK)
    def export(t):
        return list(csv.DictReader(io.StringIO(subprocess.run(["mdb-export", mdb, t], capture_output=True, text=True).stdout)))
    for r in export("events"):
        events[r["ev_id"]] = r
    for r in export("aircraft"):
        aircraft[(r["ev_id"], r["Aircraft_Key"])] = r
    for r in export("narratives"):
        narr[(r["ev_id"], r["Aircraft_Key"])] = r
dates = sorted(r["ev_date"][:8] for r in events.values() if r["ev_date"])
def mdy(s):
    m, d, y = s.split("/")
    return f"20{y}-{m}-{d}"
ev_dates = sorted(mdy(r["ev_date"][:8]) for r in events.values() if r["ev_date"])
nt_rows = []
for (ev, k), a in aircraft.items():
    e = events.get(ev, {})
    n = narr.get((ev, k), {})
    nt_rows.append({"ev_id": ev, "ntsb_no": e.get("ntsb_no"), "ev_type": e.get("ev_type"), "date": mdy(e["ev_date"][:8]) if e.get("ev_date") else None,
                    "country": e.get("ev_country"), "reg": (a["regis_no"] or "").strip().upper(), "make": a["acft_make"], "model": a["acft_model"],
                    "operator": a["oper_name"], "far_part": a["far_part"], "narr_chars": sum(len(n.get(c, "")) for c in ("narr_accp", "narr_accf", "narr_cause", "narr_inc")),
                    "has_narr": bool(n.get("narr_accp") or n.get("narr_accf") or n.get("narr_inc")), "narr_head": (n.get("narr_accp") or n.get("narr_inc") or "")[:160]})
valid_reg = [r for r in nt_rows if r["reg"] and r["reg"].lower() not in ("unknown", "none", "")]
OUT["ntsb"].update({
    "events_unique": len(events), "aircraft_rows": len(aircraft), "narrative_rows": len(narr),
    "event_date_min": ev_dates[0], "event_date_max": ev_dates[-1],
    "aircraft_with_registration": len(valid_reg), "aircraft_with_narrative": sum(r["has_narr"] for r in nt_rows),
    "foreign_event_country_counts": dict(collections.Counter(r["country"] for r in nt_rows).most_common(8)),
    "aircraft_with_operator_name": sum(bool(r["operator"]) for r in nt_rows),
    "sample20": [r for r in valid_reg if r["has_narr"]][:20],
    "identifier_fields": ["ev_id", "ntsb_no", "regis_no", "acft_serial_no", "oper_cert_num"],
    "freetext_fields": ["narratives.narr_accp", "narr_accf", "narr_cause", "narr_inc"],
    "personal_data_fields_to_exclude": ["owner_acft", "owner_street", "owner_city", "oper_individual_name", "Flight_Crew.*"],
})
nt_by_reg = collections.defaultdict(list)
for r in valid_reg:
    nt_by_reg[r["reg"]].append(r)

# ---------------------------------------------------------------- AAIB: every report via GOV.UK search API (metadata only)
aaib, start = [], 0
total = None
while True:
    q = "https://www.gov.uk/api/search.json?filter_format=aaib_report&count=1000&order=-public_timestamp&start=%d" % start
    for f in ("title", "link", "public_timestamp", "registration", "date_of_occurrence", "aircraft_category"):
        q += "&fields=" + f
    s, _, b = get(q)
    if s != 200:
        break
    d = json.loads(b)
    total = d["total"]
    aaib += d["results"]
    start += 1000
    if start >= total:
        break
aaib_reg = [r for r in aaib if (r.get("registration") or "").strip()]
OUT["aaib"].update({
    "search_total": total, "fetched": len(aaib), "with_registration_field": len(aaib_reg),
    "newest_public_timestamp": max(r["public_timestamp"] for r in aaib), "oldest_date_of_occurrence": min((r.get("date_of_occurrence") or "9999") for r in aaib),
    "public_timestamp_last_30d": sum(r["public_timestamp"] >= "2026-09-01" for r in aaib),
    "identifier_fields": ["registration", "date_of_occurrence", "aircraft_type", "location"],
    "freetext_fields": ["content API details.body (HTML summary)", "PDF attachment (full report)"],
})
def norm(x):
    return re.sub(r"[^A-Z0-9]", "", (x or "").upper())
aaib_regs = collections.defaultdict(list)
for r in aaib_reg:
    for token in re.split(r"[,/;&]| and ", r["registration"]):
        if norm(token):
            aaib_regs[norm(token)].append(r)
OUT["aaib"]["non_G_prefix_registrations"] = sum(1 for k in aaib_regs if not k.startswith("G"))
OUT["aaib"]["n_number_registrations"] = sorted(k for k in aaib_regs if re.fullmatch(r"N\d{1,5}[A-Z]{0,2}", k))[:50]
# 20 report bodies via the content API
samples = []
for r in aaib[:20]:
    s, _, b = get("https://www.gov.uk" + "/api/content" + r["link"])
    if s != 200:
        continue
    d = json.loads(b)
    md = d["details"]["metadata"]
    samples.append({"link": r["link"], "title": r["title"], "registration": md.get("registration"), "date": md.get("date_of_occurrence"), "type": md.get("aircraft_type"),
                    "report_type": md.get("report_type"), "body_chars": len(text(d["details"].get("body", "").encode())), "pdf_attachments": sum(1 for a in d["details"].get("attachments", []) if a.get("content_type") == "application/pdf")})
OUT["aaib"]["sample20_content_api"] = samples

# ---------------------------------------------------------------- CADORS: Range samples only
def sample_rows(url, offsets, span):
    out, hdr = [], None
    for off in offsets:
        s, _, b = get(url, rng=(off, off + span))
        if s not in (200, 206):
            print("range failed", url, off, s)
            continue
        t = b.decode("utf8", "ignore")
        lines = t.split("\n")
        if off == 0:
            hdr = next(csv.reader([lines[0]]))
            body_ = "\n".join(lines[1:])
        else:
            body_ = "\n".join(lines[1:])  # drop the partial first row
        body_ = body_[: body_.rfind("\n")]
        out += list(csv.reader(io.StringIO(body_)))
    return hdr, out
ac_url = "https://opendatatc.tc.canada.ca/CADORS_Aircraft_Information.csv"
oc_url = "https://opendatatc.tc.canada.ca/CADORS_Occurrence_Information.csv"
ac_size = int(OUT["probes"]["cadors_ac_csv"]["content_length"])
oc_size = int(OUT["probes"]["cadors_occ_csv"]["content_length"])
span = 1_000_000
ac_h, ac_rows = sample_rows(ac_url, [0] + [int(ac_size * f) for f in (0.2, 0.4, 0.6, 0.8, 0.97)], span)
oc_h, oc_rows = sample_rows(oc_url, [0] + [int(oc_size * f) for f in (0.2, 0.4, 0.6, 0.8, 0.97)], span)
ac = [dict(zip(ac_h, r)) for r in ac_rows if len(r) == len(ac_h)]
oc = [dict(zip(oc_h, r)) for r in oc_rows if len(r) == len(oc_h)]
avg_ac = span * 6 / max(len(ac), 1)
avg_oc = span * 6 / max(len(oc), 1)
OUT["cadors"].update({
    "files_bytes": {"aircraft": ac_size, "occurrence": oc_size},
    "sampled_bytes_per_file": span * 6, "sampled_aircraft_rows": len(ac), "sampled_occurrence_rows": len(oc),
    "estimated_aircraft_rows_total": int(ac_size / avg_ac), "estimated_occurrence_rows_total": int(oc_size / avg_oc),
    "occurrence_date_range_in_sample": [min(r["occurrencedate"] for r in oc), max(r["occurrencedate"] for r in oc)],
    "aircraft_columns": ac_h, "occurrence_columns": oc_h,
    "with_foreign_registration": sum(bool(r["foreignaircraftregistration"].strip()) for r in ac),
    "with_cdn_registration": sum(bool(r["aircraftregistration"].strip()) for r in ac),
    "with_tsb_occurrence_number": sum(bool(r["tsboccurrencenumber"].strip()) for r in oc),
    "freetext_fields": "none found: no narrative column in the 5 published CSVs (category + event-name controlled vocabularies only)",
    "sample20": [{k: r[k] for k in ("cadorsnumber", "aircraftregistration", "foreignaircraftregistration", "aircraft_make_name_nm", "aircraft_model_name_nm", "operator", "damagedescriptione")} for r in ac[:20]],
})
cad_by_reg = collections.defaultdict(list)
for r in ac:
    for col in ("aircraftregistration", "foreignaircraftregistration"):
        k = norm(r[col])
        if k:
            cad_by_reg[k].append(r)
cad_date = {r["cadorsnumber"]: r["occurrencedate"] for r in oc}

# ---------------------------------------------------------------- linkage by exact registration (aircraft identity)
def link(name, a_regs, b_regs, a_label):
    matched = sorted(set(a_regs) & set(b_regs))
    return {"pair": name, "a_distinct_registrations": len(a_regs), "b_distinct_registrations": len(b_regs), "matched_registrations": len(matched), "matched_list": matched[:40]}
nt_regs = {norm(k): v for k, v in nt_by_reg.items()}
OUT["links"]["ntsb_vs_aaib"] = link("NTSB(2026 updates) x AAIB(all)", nt_regs, aaib_regs, "reg")
OUT["links"]["ntsb_vs_cadors_sample"] = link("NTSB(2026 updates) x CADORS(6MB Range sample)", nt_regs, cad_by_reg, "reg")
OUT["links"]["aaib_vs_cadors_sample"] = link("AAIB(all) x CADORS(Range sample)", aaib_regs, cad_by_reg, "reg")
# G-registered aircraft in NTSB, and N-registered in AAIB, are the only structurally possible overlaps
OUT["links"]["structural_note"] = {
    "ntsb_regs_not_starting_with_N": sorted(k for k in nt_regs if not k.startswith("N"))[:60],
    "aaib_n_number_count": len([k for k in aaib_regs if re.fullmatch(r"N\d{1,5}[A-Z]{0,2}", k)]),
    "cadors_n_number_count_in_sample": len([k for k in cad_by_reg if re.fullmatch(r"N\d{1,5}[A-Z]{0,2}", k)]),
}
# Detail every match with event dates for the hand check
detail = []
for pair, a_map, b_map in (("ntsb-aaib", nt_regs, aaib_regs), ("ntsb-cadors", nt_regs, cad_by_reg), ("aaib-cadors", aaib_regs, cad_by_reg)):
    for reg in sorted(set(a_map) & set(b_map))[:25]:
        a0, b0 = a_map[reg][0], b_map[reg][0]
        detail.append({"pair": pair, "reg": reg, "a": {k: a0.get(k) for k in ("ntsb_no", "date", "make", "model", "title", "date_of_occurrence", "cadorsnumber", "aircraft_make_name_nm", "aircraft_model_name_nm") if a0.get(k)},
                       "b": {k: b0.get(k) for k in ("ntsb_no", "date", "make", "model", "title", "date_of_occurrence", "cadorsnumber", "aircraft_make_name_nm", "aircraft_model_name_nm") if b0.get(k)},
                       "b_cadors_date": cad_date.get(b0.get("cadorsnumber", ""))})
OUT["links"]["match_detail"] = detail

# Event-level check: same registration AND occurrence dates within 3 days
import datetime as _dt
def _d(x):
    try:
        return _dt.date.fromisoformat((x or "")[:10])
    except Exception:
        return None
ev_pairs = []
for reg in sorted(set(nt_regs) & set(aaib_regs)):
    for a in nt_regs[reg]:
        for b in aaib_regs[reg]:
            da, db = _d(a["date"]), _d(b.get("date_of_occurrence"))
            if da and db and abs((da - db).days) <= 3:
                ev_pairs.append({"reg": reg, "ntsb_no": a["ntsb_no"], "ntsb_date": a["date"], "ntsb_make_model": f'{a["make"]} {a["model"]}', "aaib_date": b["date_of_occurrence"], "aaib_title": b["title"], "aaib_link": b["link"]})
OUT["links"]["ntsb_aaib_same_registration_and_date_within_3d"] = {"matched": len(ev_pairs), "of_registration_matches": len(set(nt_regs) & set(aaib_regs)), "pairs": ev_pairs[:30]}
OUT["ntsb"]["event_date_max_excluding_future_typos"] = max(d for d in ev_dates if d <= "2026-10-01")
OUT["ntsb"]["future_dated_events"] = sum(d > "2026-10-01" for d in ev_dates)
json.dump(OUT, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "results.json"), "w"), indent=1, default=str)
print(json.dumps({k: OUT[k] for k in ("ntsb", "aaib", "cadors")}, default=str)[:200])
print(json.dumps(OUT["links"], default=str, indent=1)[:3000])
