#!/usr/bin/env python3
"""Round 34 (2026-11-25): medical subject headings. Reads the NLM MeSH 2026 descriptor file and the Human Disease
Ontology (doid.obo). The join is the MeSH unique id a Disease Ontology term cites as a cross-reference.
Writes mesh_measure.json. Stdlib only."""
import collections, gzip, random, re
import xml.etree.ElementTree as ET
import io
import scoutlib as s
from termslib import check

out = {"run_date": "2026-11-25"}
raw = s.get("mesh_desc2026.gz", "https://nlmpubs.nlm.nih.gov/projects/mesh/MESH_FILES/xmlmesh/desc2026.gz", timeout=900)
mesh, n = {}, 0
scope_chars, trees, entry_terms, with_scope, pa = 0, 0, 0, 0, 0
for ev, el in ET.iterparse(gzip.GzipFile(fileobj=io.BytesIO(raw))):
    if el.tag != "DescriptorRecord":
        continue
    ui = el.findtext("DescriptorUI"); name = el.findtext("DescriptorName/String")
    scope = (el.findtext("ConceptList/Concept[@PreferredConceptYN='Y']/ScopeNote") or "").strip()
    tn = [t.text for t in el.findall("TreeNumberList/TreeNumber")]
    terms = {t.findtext("String") for t in el.iter("Term")}
    mesh[ui] = {"name": name, "scope": scope, "trees": tn, "class": el.get("DescriptorClass")}
    scope_chars += len(scope); with_scope += bool(scope); trees += len(tn); entry_terms += len(terms) - 1
    pa += bool(el.find("PharmacologicalActionList"))
    el.clear()
scopes = sorted(len(v["scope"]) for v in mesh.values() if v["scope"])
out["nlm_mesh_descriptors_2026"] = {
    "compressed_bytes": len(raw), "descriptors": len(mesh), "by_descriptor_class": dict(collections.Counter(v["class"] for v in mesh.values())),
    "with_scope_note": with_scope, "scope_note_characters": scope_chars, "median_scope_note_characters": scopes[len(scopes) // 2],
    "tree_numbers": trees, "entry_terms_beyond_the_heading": entry_terms, "with_pharmacological_action": pa,
    "by_tree_category": dict(sorted(collections.Counter(t[0] for v in mesh.values() for t in {x[0] for x in v["trees"]}).items())),
    "scope_notes_naming_a_year": sum(1 for v in mesh.values() if re.search(r"\b(19|20)\d\d\b", v["scope"])),
    "example": {"ui": "D001249", **{k: mesh["D001249"][k] for k in ("name", "scope", "trees")}},
}
obo = s.get("doid.obo", "https://raw.githubusercontent.com/DiseaseOntology/HumanDiseaseOntology/main/src/ontology/doid.obo").decode("utf-8")
do = []
for block in obo.split("\n[Term]\n")[1:]:
    block = block.split("\n[Typedef]")[0]
    if "is_obsolete: true" in block:
        continue
    do.append({"id": re.search(r"^id: (\S+)", block, re.M).group(1), "name": re.search(r"^name: (.*)", block, re.M).group(1),
               "mesh": re.findall(r"^xref: MESH:(\S+)", block, re.M), "has_def": bool(re.search(r"^def: ", block, re.M))})
pairs = [(t["id"], t["name"], m) for t in do for m in t["mesh"]]
d_pairs = [p for p in pairs if p[2].startswith("D")]
out["disease_ontology"] = {"data_version": re.search(r"data-version: (\S+)", obo).group(1), "current_terms": len(do),
    "with_definition": sum(1 for t in do if t["has_def"]), "terms_citing_a_mesh_id": sum(1 for t in do if t["mesh"]),
    "mesh_cross_references": len(pairs), "by_mesh_id_prefix": dict(collections.Counter(p[2][0] for p in pairs))}
hit = [p for p in d_pairs if p[2] in mesh]
norm = lambda t: re.sub(r"[^a-z0-9]+", " ", t.lower()).strip()
out["join_mesh_unique_id"] = {
    "do_cross_references_to_a_mesh_descriptor_id": len(d_pairs), "resolved_in_the_2026_descriptor_file": len(hit),
    "unresolved_sample": sorted({p[2] for p in d_pairs if p[2] not in mesh})[:15],
    "distinct_descriptors_cited": len({p[2] for p in hit}), "descriptors_in_disease_tree_C": sum(1 for v in mesh.values() if any(t.startswith("C") for t in v["trees"])),
    "resolved_to_a_descriptor_in_tree_C_or_F": sum(1 for p in hit if any(t[0] in "CF" for t in mesh[p[2]]["trees"])),
    "resolved_with_identical_normalised_heading": sum(1 for p in hit if norm(p[1]) == norm(mesh[p[2]]["name"])),
    "cross_references_to_supplementary_records_not_checked": len(pairs) - len(d_pairs),
}
random.seed(20261125)
out["handcheck_sample"] = [{"doid": a, "do_name": b, "mesh_ui": c, "mesh_heading": mesh[c]["name"], "mesh_trees": mesh[c]["trees"][:3]} for a, b, c in random.sample(hit, 20)]
out["terms"] = {
    "nlm": check("terms_nlm_mesh.html", "https://www.nlm.nih.gov/databases/download/terms_and_conditions_mesh.html", [], ("restriction", "copyright", "acknowledg", "NLM")),
    "nlm_general": check("terms_nlm.html", "https://www.nlm.nih.gov/databases/download/terms_and_conditions.html", [], ("restriction", "copyright", "acknowledg")),
    "disease_ontology": check("terms_do_readme.md", "https://raw.githubusercontent.com/DiseaseOntology/HumanDiseaseOntology/main/README.md", [], ("CC0", "license", "License")),
}
s.write(__file__, out)
