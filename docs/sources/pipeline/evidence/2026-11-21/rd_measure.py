#!/usr/bin/env python3
"""Round 30 (2026-11-21): rare diseases. Orphadata product 1 (Orphanet nomenclature, definitions and
cross-references) and the Mondo Disease Ontology. Writes rd_measure.json. Stdlib only."""
import collections, io, random, re
import xml.etree.ElementTree as ET
from scoutlib import get, write

out = {"run_date": "2026-11-21"}
raw = get("orpha1.xml", "https://www.orphadata.com/data/xml/en_product1.xml")
root_attrs, licence = {}, None
orpha = {}
src_count, rel_count = collections.Counter(), collections.Counter()
types, groups, flags = collections.Counter(), collections.Counter(), collections.Counter()
for event, el in ET.iterparse(io.BytesIO(raw), events=("start", "end")):
    if event == "start" and el.tag == "JDBOR":
        root_attrs = dict(el.attrib)
    if event != "end":
        continue
    if el.tag == "ShortIdentifier":
        licence = el.text
    if el.tag == "Disorder" and el.find("OrphaCode") is not None:
        code = el.findtext("OrphaCode")
        refs = [(r.findtext("Source"), r.findtext("Reference"), (r.findtext("DisorderMappingRelation/Name") or "")[:5].strip()) for r in el.findall("ExternalReferenceList/ExternalReference")]
        definition = " ".join((c.text or "") for c in el.findall("SummaryInformationList/SummaryInformation/TextSectionList/TextSection/Contents"))
        orpha[code] = {"name": el.findtext("Name"), "type": el.findtext("DisorderType/Name"), "group": el.findtext("DisorderGroup/Name"),
                       "synonyms": len(el.findall("SynonymList/Synonym")), "refs": refs, "definition": len(definition.strip()),
                       "flags": [f.findtext("Label") or "(no label)" for f in el.findall("DisorderFlagList/DisorderFlag")]}
        types[orpha[code]["type"]] += 1; groups[orpha[code]["group"]] += 1
        for f in orpha[code]["flags"]:
            flags[f] += 1
        for s in {r[0] for r in refs}:
            src_count[s] += 1
        for r in refs:
            rel_count[r[2]] += 1
        el.clear()
deflen = sorted(d["definition"] for d in orpha.values() if d["definition"])
out["orphadata_product1"] = {
    "file_date": root_attrs.get("date"), "file_version": root_attrs.get("version"), "licence_short_identifier": licence,
    "entries": len(orpha), "by_group": dict(groups.most_common()), "by_type": dict(types.most_common()),
    "flag_labels": dict(flags.most_common()),
    "entries_flagged_inactive_obsolete_deprecated_or_historical": sum(1 for d in orpha.values() if set(d["flags"]) & {"Inactive", "Obsolete entity", "Deprecated entity", "Historical entity", "Obsolete with resources"}),
    "entries_without_a_labelled_flag": sum(1 for d in orpha.values() if all(f == "(no label)" for f in d["flags"])),
    "entries_with_definition_text": len(deflen), "definition_characters": sum(deflen), "definition_median_characters": deflen[len(deflen) // 2],
    "entries_with_synonyms": sum(1 for d in orpha.values() if d["synonyms"]), "synonyms": sum(d["synonyms"] for d in orpha.values()),
    "entries_with_reference_by_source": dict(src_count.most_common()),
    "reference_rows_by_mapping_relation": dict(rel_count.most_common()),
}

# --- Mondo ---------------------------------------------------------------------------------------
obo = get("mondo.obo", "https://purl.obolibrary.org/obo/mondo.obo").decode("utf-8")
header, *stanzas = obo.split("\n[Term]\n")
version = re.search(r"data-version: (\S+)", header).group(1)
terms = {}
for st in stanzas:
    st = st.split("\n[Typedef]")[0]
    tid = re.search(r"^id: (MONDO:\d+)", st, re.M)
    if not tid:
        continue
    xo = re.findall(r'^xref: Orphanet:(\d+)(?: \{([^}]*)\})?', st, re.M)
    terms[tid.group(1)] = {
        "name": (re.search(r"^name: (.*)", st, re.M) or [None, None])[1],
        "obsolete": bool(re.search(r"^is_obsolete: true", st, re.M)),
        "def": len((re.search(r'^def: "(.*?)" \[', st, re.M) or [None, ""])[1]),
        "orpha_equiv": [c for c, q in xo if "MONDO:equivalentTo" in (q or "")],
        "orpha_any": [c for c, q in xo],
        "subsets": re.findall(r"^subset: (\S+)", st, re.M),
        "xref_prefixes": {x.split(":")[0] for x in re.findall(r"^xref: (\S+)", st, re.M)},
    }
live = {k: v for k, v in terms.items() if not v["obsolete"]}
subsets = collections.Counter(s for v in live.values() for s in v["subsets"])
prefixes = collections.Counter(p for v in live.values() for p in v["xref_prefixes"])
out["mondo"] = {
    "data_version": version, "terms": len(terms), "obsolete": len(terms) - len(live), "live_terms": len(live),
    "live_with_definition": sum(1 for v in live.values() if v["def"]), "definition_characters": sum(v["def"] for v in live.values()),
    "live_with_any_orphanet_xref": sum(1 for v in live.values() if v["orpha_any"]),
    "live_with_equivalent_orphanet_xref": sum(1 for v in live.values() if v["orpha_equiv"]),
    "rare_subsets": {k: v for k, v in subsets.items() if "rare" in k},
    "live_terms_by_xref_prefix_top": dict(prefixes.most_common(12)),
}

# --- Declared join: the ORPHAcode Mondo cites as an equivalent cross-reference -----------------------
pairs = [(m, c) for m, v in live.items() for c in v["orpha_equiv"]]
cited = {c for _, c in pairs}
resolved = {c for c in cited if c in orpha}
per_code = collections.Counter(c for _, c in pairs)
per_term = collections.Counter(m for m, _ in pairs)
norm = lambda s: re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()
same_name = sum(1 for m, c in pairs if c in orpha and norm(live[m]["name"]) == norm(orpha[c]["name"]))
back = sum(1 for c in resolved if any(s == "MONDO" for s, _, _ in orpha[c]["refs"]))
out["orphacode_join"] = {
    "mondo_equivalent_pairs": len(pairs), "distinct_orphacodes_cited": len(cited), "resolve_in_orphadata_product1": len(resolved),
    "cited_but_absent_sample": sorted(cited - resolved, key=int)[:15],
    "orphacodes_cited_by_more_than_one_mondo_term": sum(1 for v in per_code.values() if v > 1),
    "mondo_terms_citing_more_than_one_orphacode": sum(1 for v in per_term.values() if v > 1),
    "pairs_with_identical_normalised_name": same_name,
    "orphadata_entries": len(orpha), "orphadata_entries_named_by_a_mondo_equivalent": len(resolved),
    "orphadata_entries_not_named_by_group": dict(collections.Counter(orpha[c]["group"] for c in orpha if c not in resolved).most_common()),
    "resolved_entries_whose_orphadata_record_lists_a_mondo_reference": back,
}
random.seed(20261121)
diff = sorted((m, c) for m, c in pairs if c in orpha and norm(live[m]["name"]) != norm(orpha[c]["name"]))
out["orphacode_handcheck_sample_names_differ"] = [{"mondo": m, "mondo_name": live[m]["name"], "orphacode": c, "orphanet_name": orpha[c]["name"]} for m, c in random.sample(diff, 20)]
write(__file__, out)
