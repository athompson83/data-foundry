#!/usr/bin/env python3
"""Round 34 (2026-11-25): biological pathways. Reads the Reactome pathway list, hierarchy and pathway-to-GO
file, 20 seeded pathway records from the Reactome ContentService (for the summation text), and the Gene
Ontology go-basic.obo. The join is the GO term id a Reactome pathway cites. Writes pathway_measure.json."""
import collections, json, random, re
import scoutlib as s
from termslib import check, visible

out = {"run_date": "2026-11-25"}
lines = lambda b: [l.split("\t") for l in b.decode("utf-8").splitlines() if l.strip()]
paths = lines(s.get("reactome_pathways.txt", "https://reactome.org/download/current/ReactomePathways.txt"))
rel = lines(s.get("reactome_relation.txt", "https://reactome.org/download/current/ReactomePathwaysRelation.txt"))
p2go = lines(s.get("reactome_pathways2go_human.txt", "https://reactome.org/download/current/Pathways2GoTerms_human.txt"))[1:]
human = {p[0]: p[1] for p in paths if p[2] == "Homo sapiens"}
children = {c for _, c in rel}
out["reactome_pathways"] = {
    "rows": len(paths), "distinct_stable_ids": len({p[0] for p in paths}), "species": len({p[2] for p in paths}),
    "top_species": dict(collections.Counter(p[2] for p in paths).most_common(5)),
    "human_pathways": len(human), "hierarchy_rows": len(rel),
    "human_top_level_pathways": sum(1 for k in human if k not in children),
}
go_ids = sorted({r[2] for r in p2go})
out["reactome_pathways2go_human"] = {"rows": len(p2go), "distinct_pathways": len({r[0] for r in p2go}),
    "pathways_in_the_human_list": len({r[0] for r in p2go} & set(human)), "distinct_go_terms": len(go_ids),
    "human_pathways_citing_a_go_term": len({r[0] for r in p2go} & set(human)), "human_pathways_total": len(human)}

obo = s.get("go_basic.obo", "https://current.geneontology.org/ontology/go-basic.obo").decode("utf-8")
terms, alt = {}, {}
for block in obo.split("\n[Term]\n")[1:]:
    block = block.split("\n[Typedef]")[0]
    f = collections.defaultdict(list)
    for l in block.splitlines():
        if ": " in l:
            k, v = l.split(": ", 1); f[k].append(v)
    tid = f["id"][0]
    d = re.match(r'"(.*)" \[', f["def"][0]).group(1) if f["def"] else ""
    terms[tid] = {"name": f["name"][0], "namespace": f["namespace"][0], "definition": d, "obsolete": "true" in f["is_obsolete"]}
    for a in f["alt_id"]:
        alt[a] = tid
live = {k: v for k, v in terms.items() if not v["obsolete"]}
out["gene_ontology"] = {
    "data_version": re.search(r"data-version: (\S+)", obo).group(1), "terms": len(terms), "obsolete": len(terms) - len(live),
    "current_by_namespace": dict(collections.Counter(v["namespace"] for v in live.values())),
    "current_with_definition": sum(1 for v in live.values() if v["definition"]),
    "definition_characters": sum(len(v["definition"]) for v in live.values()), "alternate_ids": len(alt),
}
res = {g: ("current" if g in live else "alternate id" if g in alt else "obsolete" if g in terms else "unknown") for g in go_ids}
out["join_go_term_id"] = {"distinct_go_ids_cited_by_reactome": len(go_ids), "resolved_to_a_current_go_term": sum(1 for v in res.values() if v == "current"),
    "by_resolution": dict(collections.Counter(res.values())), "not_current": sorted(g for g, v in res.items() if v != "current")[:20],
    "cited_terms_by_namespace": dict(collections.Counter(live[g]["namespace"] for g in go_ids if g in live)),
    "pathway_to_go_pairs": len(p2go), "pairs_resolving_to_a_current_term": sum(1 for r in p2go if r[2] in live)}

random.seed(20261125)
pick = random.sample([r for r in p2go if r[2] in live], 20)
sample, chars = [], []
for sid, name, go in pick:
    try:
        j = json.loads(s.get(f"reactome_query_{sid}.json", f"https://reactome.org/ContentService/data/query/{sid}", accept="application/json"))
        text = visible(" ".join(x.get("text", "") for x in j.get("summation", [])))
        lit = len(j.get("literatureReference", []))
        extra = {"summation_characters": len(text), "summation_start": text[:160], "literature_references": lit,
                 "has_diagram": j.get("hasDiagram"), "doi": j.get("doi"), "release_date": j.get("releaseDate"), "go_in_record": (j.get("goBiologicalProcess") or {}).get("accession")}
        chars.append(len(text))
    except Exception as e:
        extra = {"error": type(e).__name__}
    sample.append({"pathway": sid, "pathway_name": name, "go_id": go, "go_name": live[go]["name"], "go_namespace": live[go]["namespace"], **extra})
out["reactome_content_service_sample"] = {"requested": 20, "read": len(chars), "with_summation_text": sum(1 for c in chars if c), "summation_characters": sum(chars),
    "median_summation_characters": sorted(chars)[len(chars) // 2] if chars else None,
    "go_accession_in_record_equals_file": sum(1 for x in sample if x.get("go_in_record") and "GO:" + x["go_in_record"] == x["go_id"])}
out["handcheck_sample"] = sample
out["terms"] = {
    "reactome": check("terms_reactome.html", "https://reactome.org/license", [], ("CC0", "Creative Commons", "public domain")),
    "gene_ontology": check("terms_go.html", "https://geneontology.org/docs/go-citation-policy/", [], ("Creative Commons", "CC BY", "license")),
}
s.write(__file__, out)
