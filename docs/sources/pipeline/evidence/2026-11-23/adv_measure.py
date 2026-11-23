#!/usr/bin/env python3
"""Round 32 (2026-11-23) stage advance: IPEDS mission statements (table IC2023Mission in the IPEDS
2023-24 final Access database). The text is published only inside the Access file, so this script needs
the pure-Python reader access_parser 0.0.6 (with construct and tabulate) on PYTHONPATH; everything else
is stdlib. The 1 GB database is extracted to SCOUT_CACHE (or a temporary directory) and not committed.
Writes adv_measure.json."""
import io, os, random, re, statistics, tempfile, zipfile
import scoutlib as s
from access_parser import AccessParser

out = {"run_date": "2026-11-23"}
URL = "https://nces.ed.gov/ipeds/tablefiles/zipfiles/IPEDS_2023-24_Final.zip"
z = zipfile.ZipFile(io.BytesIO(s.get("ipeds_zip", URL, timeout=900)))
out["archive_members"] = {i.filename: i.file_size for i in z.infolist()}
work = s.CACHE or tempfile.mkdtemp()
path = os.path.join(work, "IPEDS202324.accdb")
if not os.path.exists(path):
    z.extract("IPEDS202324.accdb", work)
db = AccessParser(path)
out["tables_in_database"] = len(db.catalog)
m = db.parse_table("IC2023Mission")
hd = db.parse_table("HD2023")
blank = lambda v: v is None or str(v).strip() in ("", "None")
rows = list(zip(m["unitid"], m["missionURL"], m["mission"]))
text = [str(t).strip() for _, _, t in rows if not blank(t)]
units = {str(u) for u in hd["UNITID"]}
name = dict(zip(map(str, hd["UNITID"]), hd["INSTNM"]))
out["ic2023mission"] = {
    "rows": len(rows), "distinct_unitids": len({str(u) for u, _, _ in rows}),
    "with_mission_text": len(text), "with_mission_url": sum(1 for _, u, _ in rows if not blank(u)),
    "with_both": sum(1 for _, u, t in rows if not blank(u) and not blank(t)),
    "with_neither": sum(1 for _, u, t in rows if blank(u) and blank(t)),
    "mission_text_characters": sum(map(len, text)), "mission_text_median_characters": statistics.median(map(len, text)),
    "mission_text_longest": max(map(len, text)),
    "texts_naming_a_degree_level": sum(1 for t in text if re.search(r"(?i)\b(associate|baccalaureate|bachelor|master|doctoral|certificate)", t)),
    "texts_naming_a_religious_affiliation": sum(1 for t in text if re.search(r"(?i)\b(christ|catholic|biblical|jewish|torah|lutheran|baptist|methodist|faith)", t)),
}
out["hd2023"] = {"institutions": len(units)}
out["join_ipeds_unitid"] = {
    "mission_rows": len(rows), "unitid_present_in_hd2023": sum(1 for u, _, _ in rows if str(u) in units),
    "hd2023_institutions_without_a_mission_row": len(units - {str(u) for u, _, _ in rows}),
}
random.seed(20261123)
out["handcheck_sample"] = [{"unitid": str(u), "institution": name.get(str(u)), "mission_first_160_characters": str(t).strip()[:160]}
                           for u, _, t in random.sample([r for r in rows if not blank(r[2])], 20)]
s.write(__file__, out)
