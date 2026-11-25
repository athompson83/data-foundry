#!/usr/bin/env python3
"""Round 34 (2026-11-25): media types. Reads the IANA media types registry (XML), 20 seeded registration
templates from the registry, and the jshttp mime-db table. The join is the registered media type string
(type/subtype) that a mime-db entry attributes to IANA. Writes mediatype_measure.json. Stdlib only."""
import collections, json, random, re, urllib.error
import xml.etree.ElementTree as ET
import scoutlib as s
from termslib import check

out = {"run_date": "2026-11-25"}
NS = {"i": "http://www.iana.org/assignments"}
root = ET.fromstring(s.get("iana_media_types.xml", "https://www.iana.org/assignments/media-types/media-types.xml"))
iana = {}
for reg in root.findall("i:registry", NS):
    top = reg.get("id")
    for rec in reg.findall("i:record", NS):
        name = rec.findtext("i:name", default="", namespaces=NS).strip()
        if not name:
            continue
        clean = re.sub(r"\s*\(.*\)$", "", name)
        iana[f"{top}/{clean}".lower()] = {"registry": top, "name": name, "file": rec.findtext("i:file", default=None, namespaces=NS),
            "xrefs": [(x.get("type"), x.get("data")) for x in rec.findall("i:xref", NS)], "date": rec.get("date"), "updated": rec.get("updated"),
            "flagged": bool(re.search(r"OBSOLETE|DEPRECATED", name))}
out["iana_registry"] = {
    "registry_updated": root.findtext("i:updated", namespaces=NS), "records": len(iana),
    "by_top_level_type": dict(collections.Counter(v["registry"] for v in iana.values()).most_common()),
    "with_template_file": sum(1 for v in iana.values() if v["file"]), "citing_an_rfc": sum(1 for v in iana.values() if any(t == "rfc" for t, _ in v["xrefs"])),
    "citing_a_person": sum(1 for v in iana.values() if any(t == "person" for t, _ in v["xrefs"])),
    "with_registration_date": sum(1 for v in iana.values() if v["date"]), "marked_obsolete_or_deprecated": sum(1 for v in iana.values() if v["flagged"]),
    "structured_syntax_suffixes": dict(collections.Counter(k.rsplit("+", 1)[1] for k in iana if "+" in k).most_common(6)),
}
db = json.loads(s.get("mime_db.json", "https://cdn.jsdelivr.net/gh/jshttp/mime-db@master/db.json"))
src = collections.Counter(v.get("source", "none") for v in db.values())
from_iana = sorted(k for k, v in db.items() if v.get("source") == "iana")
hit = [k for k in from_iana if k.lower() in iana]
out["mime_db"] = {"entries": len(db), "by_source": dict(src), "with_extensions": sum(1 for v in db.values() if v.get("extensions")),
    "extensions": sum(len(v.get("extensions", [])) for v in db.values()), "with_compressible_flag": sum(1 for v in db.values() if "compressible" in v),
    "with_charset": sum(1 for v in db.values() if v.get("charset"))}
out["join_media_type_string"] = {
    "mime_db_entries_attributed_to_iana": len(from_iana), "found_in_the_iana_registry": len(hit),
    "not_found_sample": [k for k in from_iana if k.lower() not in iana][:15],
    "iana_records_found_in_mime_db": sum(1 for k in iana if k in {x.lower() for x in db}), "iana_records": len(iana),
    "iana_records_missing_from_mime_db_sample": sorted(k for k in iana if k not in {x.lower() for x in db})[:8],
    "matched_entries_adding_a_file_extension": sum(1 for k in hit if db[k].get("extensions")),
}
random.seed(20261125)
with_file = [k for k in hit if iana[k.lower()]["file"]]
sample, lens = [], []
for k in random.sample(with_file, 20):
    rec = iana[k.lower()]
    try:
        body = s.get("iana_template_" + rec["file"].replace("/", "__"), f"https://www.iana.org/assignments/media-types/{rec['file']}", timeout=60).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        sample.append({"media_type": k, "template": rec["file"], "http_status": e.code}); continue
    sub = k.split("/", 1)[1]
    lens.append(len(body))
    sample.append({"media_type": k, "template": rec["file"], "characters": len(body),
        "states_the_subtype": sub.lower() in body.lower(), "has_security_considerations": bool(re.search(r"security considerations", body, re.I)),
        "has_file_extension_line": bool(re.search(r"file extension", body, re.I)), "has_required_parameters": bool(re.search(r"required parameters", body, re.I)),
        "has_contact_line": bool(re.search(r"person\s*(?:&|and)\s*email|contact", body, re.I)),
        "mime_db_extensions": db[k].get("extensions"), "iana_reference": rec["xrefs"][:2]})
out["iana_templates_sample"] = {"requested": 20, "read": len(lens), "characters": sum(lens), "median_characters": sorted(lens)[len(lens) // 2] if lens else None,
    "stating_the_subtype": sum(1 for x in sample if x.get("states_the_subtype")), "with_security_considerations": sum(1 for x in sample if x.get("has_security_considerations")),
    "with_file_extension_line": sum(1 for x in sample if x.get("has_file_extension_line")), "with_a_contact_line": sum(1 for x in sample if x.get("has_contact_line"))}
out["handcheck_sample"] = sample
out["terms"] = {
    "iana": check("terms_iana.html", "https://www.iana.org/help/licensing-terms", [], ("CC0", "public domain", "license", "licence")),
    "mime_db": check("terms_mime_db_license.txt", "https://cdn.jsdelivr.net/gh/jshttp/mime-db@master/LICENSE", [], ("Permission is hereby granted", "MIT")),
}
s.write(__file__, out)
