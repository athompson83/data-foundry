#!/usr/bin/env python3
"""Round 35 (2026-11-28): units of measure. Reads the QUDT unit vocabulary (Turtle, from qudt.org), the UNECE Recommendation 20
code list as mirrored by the Datahub `datasets` project, and the UCUM essence file. The joins are the UNECE
common code and the UCUM code a QUDT unit cites. Writes unit_measure.json. Stdlib only."""
import collections, csv, io, json, random, re
import xml.etree.ElementTree as ET
import scoutlib as s
from termslib import check

out = {"run_date": "2026-11-28"}
ttl = s.get("qudt_vocab_unit.ttl", "https://qudt.org/vocab/unit/").decode("utf-8")
blocks = re.split(r"\n(?=unit:\S+\s*\n\s+a )", ttl)
units = {}
for b in blocks:
    m = re.match(r"unit:(\S+)\s*\n\s+a ([^;]+);", b)
    if not m or "qudt:Unit" not in m.group(2) and "qudt:DerivedUnit" not in m.group(2):
        continue
    def vals(prop):
        return re.findall(prop + r'\s+"((?:[^"\\]|\\.)*)"', b)
    lab = re.findall(r'rdfs:label\s+"([^"]*)"(?:@en)?\s*[;.,]', b)
    en = re.findall(r'rdfs:label\s+"([^"]*)"@en\b', b)
    desc = re.findall(r'dcterms:description\s+"""(.*?)"""', b, re.S) + vals("dcterms:description")
    units[m.group(1)] = {"label": (en or lab or [None])[0], "ucum": vals("qudt:ucumCode"), "unece": vals("qudt:uneceCommonCode"), "symbol": vals("qudt:symbol"),
        "kinds": re.findall(r"quantitykind:(\w+)", b), "has_multiplier": "qudt:conversionMultiplier" in b, "desc_chars": sum(len(d) for d in desc),
        "deprecated": "qudt:deprecated true" in b, "si_exact": "qudt:siExactMatch" in b}
ver = re.search(r'owl:versionInfo\s+"([^"]+)"', ttl)
out["qudt_units"] = {"version_info": ver.group(1) if ver else None, "units": len(units), "with_english_label": sum(1 for u in units.values() if u["label"]),
    "with_ucum_code": sum(1 for u in units.values() if u["ucum"]), "ucum_codes": sum(len(u["ucum"]) for u in units.values()),
    "with_unece_common_code": sum(1 for u in units.values() if u["unece"]), "with_symbol": sum(1 for u in units.values() if u["symbol"]),
    "with_quantity_kind": sum(1 for u in units.values() if u["kinds"]), "distinct_quantity_kinds": len({k for u in units.values() for k in u["kinds"]}),
    "with_conversion_multiplier": sum(1 for u in units.values() if u["has_multiplier"]), "with_description": sum(1 for u in units.values() if u["desc_chars"]),
    "description_characters": sum(u["desc_chars"] for u in units.values()), "deprecated": sum(1 for u in units.values() if u["deprecated"])}
rows = list(csv.DictReader(io.StringIO(s.get("unece_rec20_units.csv", "https://cdn.jsdelivr.net/gh/datasets/unece-units-of-measure@main/data/units-of-measure.csv").decode("utf-8-sig"))))
code_col = next(c for c in rows[0] if c.lower().replace(" ", "") == "commoncode")
unece = {r[code_col]: r for r in rows}
out["unece_rec20"] = {"rows": len(rows), "columns": list(rows[0].keys()), "distinct_common_codes": len(unece),
    "by_status": dict(collections.Counter(r.get("Status") or "(blank)" for r in rows).most_common()),
    "with_description": sum(1 for r in rows if (r.get("Description") or "").strip()), "description_characters": sum(len(r.get("Description") or "") for r in rows),
    "with_conversion_factor": sum(1 for r in rows if (r.get("ConversionFactor") or "").strip()), "with_symbol": sum(1 for r in rows if (r.get("Symbol") or "").strip())}
pairs = [(k, c) for k, u in units.items() for c in u["unece"]]
hit = [(k, c) for k, c in pairs if c in unece]
out["join_unece_common_code"] = {"qudt_units_citing_a_code": len({k for k, _ in pairs}), "citations": len(pairs), "distinct_codes_cited": len({c for _, c in pairs}),
    "citations_found_in_rec20_list": len(hit), "not_found_sample": [(k, c) for k, c in pairs if c not in unece][:15],
    "codes_cited_by_more_than_one_qudt_unit": sum(1 for c, n in collections.Counter(c for _, c in pairs).items() if n > 1),
    "rec20_codes_not_cited_by_qudt": len(set(unece) - {c for _, c in pairs})}
uroot = ET.fromstring(s.get("ucum-essence.xml", "https://cdn.jsdelivr.net/gh/ucum-org/ucum@main/ucum-essence.xml"))
un = {"u": uroot.tag.split("}")[0].strip("{")}
prefixes = {p.get("Code") for p in uroot.findall("u:prefix", un)}
atoms = {a.get("Code") for a in uroot.findall("u:base-unit", un)} | {a.get("Code") for a in uroot.findall("u:unit", un)}
metric = {a.get("Code") for a in uroot.findall("u:base-unit", un)} | {a.get("Code") for a in uroot.findall("u:unit", un) if a.get("isMetric") == "yes"}
def atom_ok(tok):
    if tok in atoms or tok == "" or re.fullmatch(r"\d+", tok) or re.fullmatch(r"10[\^*]-?\d+", tok):
        return True
    return any(tok.startswith(p) and tok[len(p):] in metric for p in prefixes)
def expr_ok(code):
    code = re.sub(r"\{[^}]*\}", "", code)
    toks = [re.sub(r"[+-]?\d+$", "", t) if t not in atoms else t for t in re.split(r"[./()]", code)]
    return all(atom_ok(t) for t in toks)
codes = [c for u in units.values() for c in u["ucum"]]
out["ucum_essence"] = {"version": uroot.get("version"), "revision_date": uroot.get("revision-date"), "prefixes": len(prefixes), "base_units": len(uroot.findall("u:base-unit", un)), "units": len(uroot.findall("u:unit", un))}
out["join_ucum_code"] = {"qudt_ucum_codes": len(codes), "that_are_a_single_ucum_atom": sum(1 for c in codes if c in atoms),
    "that_parse_as_prefix_atom_expressions": sum(1 for c in codes if expr_ok(c)), "not_parsing_sample": [c for c in codes if not expr_ok(c)][:20]}
random.seed(20261128)
out["handcheck_sample"] = [{"qudt_unit": k, "qudt_label": units[k]["label"], "qudt_symbol": units[k]["symbol"][:1], "unece_common_code": c, "unece_name": unece[c].get("Name"),
    "unece_symbol": unece[c].get("Symbol"), "unece_conversion_factor": unece[c].get("ConversionFactor")} for k, c in random.sample(sorted(hit), 20)]
out["terms"] = {
    "qudt": check("terms_qudt_readme.md", "https://cdn.jsdelivr.net/gh/qudt/qudt-public-repo@main/README.md", [], ("licensed under",)),
    "ucum": check("terms_ucum_license.md", "https://cdn.jsdelivr.net/gh/ucum-org/ucum@main/LICENSE.md", [], ("commercial", "permission", "redistribut", "royalty", "derivative")),
    "unece_mirror_datapackage": check("terms_unece_mirror_datapackage.json", "https://cdn.jsdelivr.net/gh/datasets/unece-units-of-measure@main/datapackage.json", [], ("license", "PDDL", "Public Domain")),
    "unece": check("terms_unece.html", "https://unece.org/terms-and-conditions", [], ("commercial", "reproduc", "permission", "copyright")),
}
s.write(__file__, out)
