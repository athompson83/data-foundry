#!/usr/bin/env python3
"""Round 30 (2026-11-21): adversary techniques. MITRE ATT&CK Enterprise STIX bundle and the Red Canary
Atomic Red Team index. Writes atk_measure.json. Stdlib only (the Atomic index is YAML and is read with
line patterns, not a YAML parser)."""
import collections, json, re
from scoutlib import get, write

out = {"run_date": "2026-11-21"}
bundle = json.loads(get("attack.json", "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/enterprise-attack/enterprise-attack.json"))
objs = bundle["objects"]
types = collections.Counter(o["type"] for o in objs)
coll = [o for o in objs if o["type"] == "x-mitre-collection"][0]
ext = lambda o: next((r.get("external_id") for r in o.get("external_references", []) if r.get("source_name") == "mitre-attack"), None)
tech = [o for o in objs if o["type"] == "attack-pattern"]
live = [o for o in tech if not o.get("revoked") and not o.get("x_mitre_deprecated")]
ids = {ext(o): o for o in live}
desc = [len(o.get("description") or "") for o in live]
rel = [o for o in objs if o["type"] == "relationship" and not o.get("revoked")]
uses = [r for r in rel if r["relationship_type"] == "uses" and r["target_ref"].startswith("attack-pattern--")]
live_refs = {o["id"]: ext(o) for o in live}
uses_live = [r for r in uses if r["target_ref"] in live_refs]
platforms = collections.Counter(p for o in live for p in o.get("x_mitre_platforms", []))
tactics = collections.Counter(k["phase_name"] for o in live for k in o.get("kill_chain_phases", []))
out["mitre_attack_enterprise"] = {
    "collection_version": coll.get("x_mitre_version"), "collection_modified": coll.get("modified"), "spec_version": coll.get("x_mitre_attack_spec_version"),
    "objects": len(objs), "object_types": dict(types.most_common()),
    "attack_patterns": len(tech), "revoked": sum(1 for o in tech if o.get("revoked")), "deprecated_not_revoked": sum(1 for o in tech if o.get("x_mitre_deprecated") and not o.get("revoked")),
    "live_techniques": len(live), "live_top_level": sum(1 for o in live if not o.get("x_mitre_is_subtechnique")), "live_sub_techniques": sum(1 for o in live if o.get("x_mitre_is_subtechnique")),
    "live_with_distinct_external_id": len(ids), "live_with_description": sum(1 for d in desc if d), "description_characters": sum(desc), "description_median_characters": sorted(desc)[len(desc) // 2],
    "newest_technique_modified": max(o["modified"] for o in live),
    "tactics": dict(tactics.most_common()), "platforms": dict(platforms.most_common()),
    "procedure_example_relationships_to_live_techniques": len(uses_live),
    "procedure_examples_with_description": sum(1 for r in uses_live if (r.get("description") or "").strip()),
    "procedure_example_characters": sum(len(r.get("description") or "") for r in uses_live),
    "live_techniques_with_a_procedure_example": len({r["target_ref"] for r in uses_live}),
    "mitigates_relationships": sum(1 for r in rel if r["relationship_type"] == "mitigates"),
    "detects_relationships": sum(1 for r in rel if r["relationship_type"] == "detects"),
    "groups": types["intrusion-set"], "software": types["malware"] + types["tool"], "campaigns": types["campaign"], "mitigations": types["course-of-action"],
}
lic = get("attack_license.txt", "https://raw.githubusercontent.com/mitre-attack/attack-stix-data/master/LICENSE.txt").decode()
out["mitre_attack_license_first_sentence"] = re.sub(r"\s+", " ", lic.split("License\n-------\n")[1].split("\n\n")[0])

# --- The same release on MITRE's own host: the Excel workbook linked from attack.mitre.org --------------
import io, zipfile
import xml.etree.ElementTree as ET
ver = coll.get("x_mitre_version")
wb = zipfile.ZipFile(io.BytesIO(get("attack_enterprise.xlsx", f"https://attack.mitre.org/docs/attack-excel-files/v{ver}/enterprise-attack/enterprise-attack-v{ver}.xlsx")))
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main", "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships"}
shared = ["".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])) for si in ET.fromstring(wb.read("xl/sharedStrings.xml")).findall("m:si", NS)]
book = ET.fromstring(wb.read("xl/workbook.xml"))
rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(wb.read("xl/_rels/workbook.xml.rels"))}
sheets = {s.get("name"): rels[s.get("{%s}id" % NS["r"])] for s in book.find("m:sheets", NS)}
def column_a(sheet):
    vals = []
    for c in ET.fromstring(wb.read("xl/" + sheets[sheet].lstrip("/").replace("xl/", ""))).iter("{%s}c" % NS["m"]):
        if re.match(r"^A\d+$", c.get("r") or ""):
            v = c.find("m:v", NS)
            if v is not None:
                vals.append(shared[int(v.text)] if c.get("t") == "s" else v.text)
    return vals
xl_ids = {v for v in column_a("techniques") if re.match(r"^T\d{4}(\.\d{3})?$", v or "")}
out["attack_mitre_org_workbook"] = {
    "sheets": list(sheets), "technique_ids_in_techniques_sheet": len(xl_ids),
    "equal_to_live_stix_technique_ids": xl_ids == set(ids), "in_workbook_not_live_in_stix": sorted(xl_ids - set(ids))[:10], "live_in_stix_not_in_workbook": sorted(set(ids) - xl_ids)[:10],
}

# --- Atomic Red Team index: tactic -> technique id -> { technique: {...}, atomic_tests: [...] } --------
text = get("atomic_index.yaml", "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/atomics/Indexes/index.yaml").decode()
entries = collections.defaultdict(int)   # technique id -> number of atomic tests (each test listed once per id)
seen_guid = collections.defaultdict(set)
cur = None
platforms_a = collections.Counter()
in_platforms = False
for line in text.splitlines():
    m = re.match(r"^  (T\d{4}(?:\.\d{3})?):\s*$", line)
    if m:
        cur = m.group(1); entries.setdefault(cur, 0); continue
    m = re.match(r"^      auto_generated_guid: ([0-9a-f-]{36})", line)
    if m and cur:
        seen_guid[cur].add(m.group(1)); continue
    if re.match(r"^      supported_platforms:", line):
        in_platforms = True; continue
    if in_platforms:
        m = re.match(r"^      - ([a-z0-9:_-]+)\s*$", line)
        if m:
            platforms_a[m.group(1)] += 1; continue
        in_platforms = False
all_ids = set(entries)
with_tests = {k for k, v in seen_guid.items() if v}
guids = set().union(*seen_guid.values())
out["atomic_red_team_index"] = {
    "technique_ids_listed": len(all_ids), "technique_ids_with_at_least_one_test": len(with_tests),
    "distinct_atomic_test_guids": len(guids),
    "max_tests_for_one_technique": max(len(v) for v in seen_guid.values()),
    "supported_platform_mentions": dict(platforms_a.most_common()),
}
# Red Canary also serves each atomic on its own site; one page is read to confirm the host answers.
site = get("atomic_site_T1055.011.html", "https://www.atomicredteam.io/atomic-red-team/atomics/T1055.011").decode("utf-8", "replace")
out["atomicredteam_io_page"] = {"url": "https://www.atomicredteam.io/atomic-red-team/atomics/T1055.011", "names_technique_id": "T1055.011" in site,
                                "test_guids_from_index_found_on_page": sum(1 for g in seen_guid.get("T1055.011", ()) if g in site), "tests_in_index_for_this_id": len(seen_guid.get("T1055.011", ()))}
lic2 = get("atomic_license.txt", "https://raw.githubusercontent.com/redcanaryco/atomic-red-team/master/LICENSE.txt").decode()
out["atomic_red_team_license_head"] = [l for l in lic2.splitlines() if l.strip()][:2]

# --- Declared join: the ATT&CK technique ID that an atomic test is filed under -------------------
all_attack_ids = {ext(o): o for o in tech}
matched_live = with_tests & set(ids)
not_live = sorted(with_tests - set(ids))
out["technique_id_join"] = {
    "atomic_technique_ids_with_tests": len(with_tests), "resolve_to_live_attack_technique": len(matched_live),
    "resolve_only_to_revoked_or_deprecated": [i for i in not_live if i in all_attack_ids],
    "resolve_to_nothing": [i for i in not_live if i not in all_attack_ids],
    "live_attack_techniques": len(ids), "live_attack_techniques_with_atomic_test": len(matched_live),
    "tests_under_matched_ids": len(set().union(*(seen_guid[i] for i in matched_live))),
}
write(__file__, out)
