#!/usr/bin/env python3
"""Round 32 (2026-11-23): phenotype terms. The Human Phenotype Ontology (hp.obo) and Orphadata product 4
(rare diseases annotated with HPO phenotypes and their frequency). Writes hpo_measure.json. Stdlib only."""
import collections, random, re, statistics
import xml.etree.ElementTree as ET
import scoutlib as s

out = {"run_date": "2026-11-23"}
obo = s.get("hp_obo", "https://purl.obolibrary.org/obo/hp.obo").decode("utf-8")
head, *stanzas = obo.split("\n[")
terms, alt = {}, {}
for st in stanzas:
    if not st.startswith("Term]"):
        continue
    t = collections.defaultdict(list)
    for line in st.splitlines()[1:]:
        if ": " in line:
            k, v = line.split(": ", 1)
            t[k].append(v)
    tid = t["id"][0]
    terms[tid] = t
    for a in t["alt_id"]:
        alt[a] = tid
live = {k: t for k, t in terms.items() if "true" not in t["is_obsolete"]}
defs = [re.match(r'"(.*)" \[', d[0]).group(1) for d in (t["def"] for t in live.values()) if d]
xref = collections.Counter(x.split(":")[0] for t in live.values() for x in t["xref"])
out["hpo"] = {
    "data_version": re.search(r"data-version: (.*)", head).group(1), "licence_property": re.search(r"terms:license (.*)", head).group(1),
    "terms": len(terms), "live": len(live), "obsolete": len(terms) - len(live), "alt_ids": len(alt),
    "obsolete_with_replaced_by": sum(1 for t in terms.values() if "true" in t["is_obsolete"] and t["replaced_by"]),
    "live_with_definition": len(defs), "definition_characters": sum(map(len, defs)), "definition_median_characters": statistics.median(map(len, defs)),
    "live_with_comment": sum(1 for t in live.values() if t["comment"]),
    "live_with_synonym": sum(1 for t in live.values() if t["synonym"]), "synonyms": sum(len(t["synonym"]) for t in live.values()),
    "layperson_synonyms": sum(1 for t in live.values() for x in t["synonym"] if "layperson" in x),
    "live_terms_with_xref_by_source": dict(xref.most_common(8)),
    "newest_term_date": max((re.search(r'"(\d{4}-\d\d-\d\d)', p).group(1) for t in live.values() for p in t["property_value"] if p.startswith("terms:date") and re.search(r'"(\d{4}-\d\d-\d\d)', p)), default=None),
}

root = ET.fromstring(s.get("orpha_product4", "https://www.orphadata.com/data/xml/en_product4.xml"))
assoc = []
disorders = root.findall(".//Disorder")
for d in disorders:
    for a in d.findall(".//HPODisorderAssociation"):
        assoc.append((d.findtext("OrphaCode"), d.findtext("Name"), a.findtext("HPO/HPOId"), a.findtext("HPO/HPOTerm"), a.findtext("HPOFrequency/Name"), a.findtext("DiagnosticCriteria/Name")))
ids = {a[2] for a in assoc}
state = lambda i: "live" if i in live else "alt_id" if i in alt else "obsolete" if i in terms else "unknown"
by_state = collections.Counter(state(i) for i in ids)
same = sum(1 for a in assoc if a[2] in live and live[a[2]]["name"][0] == a[3])
out["orphadata_product4"] = {
    "file_date": root.get("date"), "licence": root.findtext(".//Licence/FullName"),
    "disorders": len(disorders), "disorders_with_an_annotation": len({a[0] for a in assoc}),
    "associations": len(assoc), "distinct_hpo_ids": len(ids),
    "by_frequency": dict(collections.Counter(a[4] for a in assoc).most_common()),
    "associations_flagged_as_diagnostic_criterion": dict(collections.Counter(a[5] for a in assoc if a[5]).most_common()),
    "median_annotations_per_disorder": statistics.median(collections.Counter(a[0] for a in assoc).values()),
}
out["join_hpo_id"] = {
    "orphadata_distinct_hpo_ids": len(ids), "by_state_in_hp_obo": dict(by_state),
    "associations_citing_a_live_term": sum(1 for a in assoc if a[2] in live), "associations": len(assoc),
    "associations_whose_label_equals_the_hp_obo_name": same,
    "not_live_sample": sorted(i for i in ids if i not in live)[:20],
    "live_hpo_terms_used_by_orphadata": by_state["live"], "live_hpo_terms": len(live),
}
random.seed(20261123)
out["handcheck_sample"] = [{"orpha_code": a[0], "disorder": a[1], "hpo_id": a[2], "orphadata_label": a[3], "hp_obo_name": (terms.get(a[2]) or {"name": [None]})["name"][0], "frequency": a[4]}
                           for a in random.sample([a for a in assoc if a[2] in live and live[a[2]]["name"][0] != a[3]] or assoc, 20)]
s.write(__file__, out)
