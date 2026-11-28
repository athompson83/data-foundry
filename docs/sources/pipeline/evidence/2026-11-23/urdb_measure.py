#!/usr/bin/env python3
"""Round 32 (2026-11-23): electric utility rate schedules. OpenEI Utility Rate Database full CSV export
and EIA Form 861 (2024 detailed data). Measures counts, free text and the EIA utility id join.
Writes urdb_measure.json. Stdlib only (the xlsx sheets are read as zipped XML)."""
import collections, csv, gzip, io, random, re, statistics, zipfile
import xml.etree.ElementTree as ET
import scoutlib as s

csv.field_size_limit(10**9)
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def xlsx_rows(z, name, sheet="xl/worksheets/sheet1.xml"):
    """Rows of the first worksheet of an xlsx member, as lists of strings."""
    x = zipfile.ZipFile(io.BytesIO(z.read(name)))
    shared = []
    if "xl/sharedStrings.xml" in x.namelist():
        for si in ET.fromstring(x.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    out = []
    for row in ET.fromstring(x.read(sheet)).iter("{%s}row" % NS["m"]):
        cells = {}
        for c in row.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group(0)
            v = c.find("m:v", NS)
            val = "" if v is None else (shared[int(v.text)] if c.get("t") == "s" else v.text)
            idx = 0
            for ch in col:
                idx = idx * 26 + ord(ch) - 64
            cells[idx - 1] = val
        out.append([cells.get(i, "") for i in range(max(cells) + 1)] if cells else [])
    return out


out = {"run_date": "2026-11-23"}
body = s.get("urdb_csv", "https://openei.org/apps/USURDB/download/usurdb.csv.gz")
reader = csv.reader(io.TextIOWrapper(gzip.GzipFile(fileobj=io.BytesIO(body)), encoding="utf-8", errors="replace", newline=""))
head = next(reader)
ix = {h: i for i, h in enumerate(head)}
rows = [r for r in reader]
desc = [r[ix["description"]] for r in rows if r[ix["description"]].strip()]
eia_ids = collections.Counter(r[ix["eiaid"]].split(".")[0] for r in rows if r[ix["eiaid"]].strip())
urdb_name = {}
for r in rows:
    urdb_name.setdefault(r[ix["eiaid"]].split(".")[0], r[ix["utility"]])
out["urdb"] = {
    "rows": len(rows), "columns": len(head),
    "distinct_labels": len({r[ix["label"]] for r in rows}),
    "distinct_eia_ids": len(eia_ids), "rows_without_eia_id": sum(1 for r in rows if not r[ix["eiaid"]].strip()),
    "distinct_utility_names": len({r[ix["utility"]] for r in rows}),
    "by_sector": dict(collections.Counter(r[ix["sector"]] for r in rows).most_common()),
    "rows_without_end_date": sum(1 for r in rows if not r[ix["enddate"]].strip()),
    "newest_latest_update": max(r[ix["latest_update"]] for r in rows),
    "rows_updated_in_2026": sum(1 for r in rows if r[ix["latest_update"]].startswith("2026")),
    "rows_updated_since_2026_11_01": sum(1 for r in rows if r[ix["latest_update"]] >= "2026-11-01"),
    "rows_with_source_url": sum(1 for r in rows if r[ix["source"]].strip()),
    "rows_with_description": len(desc), "description_characters": sum(map(len, desc)),
    "description_median_characters": statistics.median(map(len, desc)),
    "descriptions_stating_a_dollar_amount": sum(1 for d in desc if re.search(r"\$\s?\d", d)),
    "rows_with_basic_information_comments": sum(1 for r in rows if r[ix["basicinformationcomments"]].strip()),
    "rows_with_fixed_charge": sum(1 for r in rows if r[ix["fixedchargefirstmeter"]].strip()),
    "rows_with_an_energy_rate_tier": sum(1 for r in rows if r[ix["energyratestructure/period0/tier0rate"]].strip()),
    "rows_with_a_demand_rate_tier": sum(1 for r in rows if r[ix["flatdemandstructure/period0/tier0rate"]].strip() or r[ix.get("demandratestructure/period0/tier0rate", 0)].strip()),
}

z = zipfile.ZipFile(io.BytesIO(s.get("eia861_zip", "https://www.eia.gov/electricity/data/eia861/zip/f8612024.zip")))
out["eia861"] = {"members": {i.filename: i.file_size for i in z.infolist()}}


def table(name):
    rs = xlsx_rows(z, name)
    h = next(i for i, r in enumerate(rs) if "Utility Number" in r)
    return rs[h], [r for r in rs[h + 1:] if r and r[rs[h].index("Utility Number")].strip()]


eia_name, by_file = {}, {}
for name in ("Utility_Data_2024.xlsx", "Sales_Ult_Cust_2024.xlsx", "Frame_2024.xlsx", "Short_Form_2024.xlsx"):
    h, rs = table(name)
    num, nm = h.index("Utility Number"), h.index("Utility Name")
    ids = set()
    for r in rs:
        k = r[num].split(".")[0]
        if k.isdigit():
            ids.add(k)
            eia_name.setdefault(k, r[nm] if nm < len(r) else "")
    by_file[name] = {"rows": len(rs), "distinct_utility_numbers": len(ids), "columns": [c for c in h if c][:40]}
    if name == "Utility_Data_2024.xlsx":
        own = h.index("Ownership Type") if "Ownership Type" in h else None
        if own is not None:
            by_file[name]["by_ownership_type"] = dict(collections.Counter(r[own] for r in rs if own < len(r)).most_common())
out["eia861"]["tables"] = by_file
out["eia861"]["distinct_utility_numbers_across_the_four_tables"] = len(eia_name)

matched = sorted(k for k in eia_ids if k in eia_name)
current = collections.Counter(r[ix["eiaid"]].split(".")[0] for r in rows if r[ix["eiaid"]].strip() and not r[ix["enddate"]].strip())
norm = lambda t: re.sub(r"[^a-z0-9]", "", re.sub(r"\b(inc|co|corp|company|corporation|the|of|city|assn|association|cooperative|coop|electric|elec|power|pwr|light|lgt|member|membership|mem|rural|energy|llc|util|utilities|utility|board|dept|department|public|pub|service|serv|svc|district|dist|system|sys|authority|auth|comm|commission)\b", "", t.lower()))
out["join_eia_utility_id"] = {
    "urdb_distinct_eia_ids": len(eia_ids), "found_in_eia861_2024": len(matched),
    "not_found": len(eia_ids) - len(matched), "not_found_sample": sorted(k for k in eia_ids if k not in eia_name)[:25],
    "urdb_rows_with_a_matched_id": sum(eia_ids[k] for k in matched), "urdb_rows_with_an_id": sum(eia_ids.values()),
    "ids_with_a_rate_that_has_no_end_date": len(current), "of_those_found_in_eia861_2024": sum(1 for k in current if k in eia_name),
    "eia861_utilities_with_a_urdb_rate": len(matched), "eia861_utilities_without_a_urdb_rate": len(eia_name) - len(matched),
    "matched_pairs_with_the_same_normalised_name": sum(1 for k in matched if norm(urdb_name[k]) == norm(eia_name[k])),
}
random.seed(20261123)
out["handcheck_sample"] = [{"eia_id": k, "urdb_utility": urdb_name[k], "eia861_utility_name": eia_name[k]} for k in random.sample(matched, 20)]
s.write(__file__, out)
