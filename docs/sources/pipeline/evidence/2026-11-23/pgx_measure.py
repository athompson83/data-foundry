#!/usr/bin/env python3
"""Round 32 (2026-11-23): pharmacogenomic gene-drug guidance. The CPIC API (guidelines, gene-drug pairs,
drugs, recommendations) and the FDA Table of Pharmacogenetic Associations. Writes pgx_measure.json."""
import collections, html, json, random, re, statistics
import scoutlib as s

out = {"run_date": "2026-11-23"}
api = lambda n: json.loads(s.get("cpic_" + n, "https://api.cpicpgx.org/v1/" + n))
guide, pair, drug, rec = api("guideline"), api("pair"), api("drug"), api("recommendation")
dname = {d["drugid"]: d["name"] for d in drug}
live_pairs = [p for p in pair if not p["removed"]]
rtext = [(r.get("drugrecommendation") or "") + " " + " ".join((r.get("implications") or {}).values()) for r in rec]
out["cpic"] = {
    "guidelines": len(guide), "guideline_genes": len({g for x in guide for g in x["genes"]}),
    "pairs": len(pair), "pairs_not_removed": len(live_pairs), "pairs_by_cpic_level": dict(collections.Counter(p["cpiclevel"] for p in live_pairs).most_common()),
    "pairs_with_a_guideline": sum(1 for p in live_pairs if p["guidelineid"]), "pairs_with_fda_pgx_testing_note": dict(collections.Counter(str(p["pgxtesting"]) for p in live_pairs).most_common()),
    "pair_genes": len({p["genesymbol"] for p in live_pairs}), "pair_drugs": len({p["drugid"] for p in live_pairs}),
    "drugs": len(drug), "drugs_with_rxnorm_id": sum(1 for d in drug if d.get("rxnormid")), "drugs_with_drugbank_id": sum(1 for d in drug if d.get("drugbankid")),
    "drugs_with_atc_code": sum(1 for d in drug if d.get("atcid")),
    "recommendations": len(rec), "recommendation_drugs": len({r["drugid"] for r in rec}),
    "recommendations_by_classification": dict(collections.Counter(r["classification"] for r in rec).most_common()),
    "recommendation_text_characters": sum(map(len, rtext)), "recommendation_text_median_characters": statistics.median(map(len, rtext)),
    "pairs_citing_a_pubmed_id": sum(1 for p in live_pairs if p.get("citations")),
}
page = s.get("fda_pgx_table", "https://www.fda.gov/medical-devices/precision-medicine/table-pharmacogenetic-associations").decode("utf-8")
clean = lambda t: re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).strip()
rows = []
for n, tb in enumerate(re.findall(r"(?s)<table.*?</table>", page), 1):
    for tr in re.findall(r"(?s)<tr>(.*?)</tr>", tb):
        td = [clean(c) for c in re.findall(r"(?s)<td[^>]*>(.*?)</td>", tr)]
        if len(td) == 4:
            rows.append({"section": n, "drug": td[0], "gene": td[1], "subgroup": td[2], "description": td[3]})
desc = [r["description"] for r in rows]
current = re.search(r"Content current as of:.*?(\d\d/\d\d/\d{4})", clean(page))
out["fda_table"] = {
    "content_current_as_of": current.group(1) if current else None, "tables": len(re.findall(r"<table", page)), "rows": len(rows),
    "rows_by_section": dict(collections.Counter(r["section"] for r in rows)), "distinct_drugs": len({r["drug"].lower() for r in rows}),
    "distinct_genes": len({r["gene"] for r in rows}), "distinct_drug_gene_pairs": len({(r["drug"].lower(), r["gene"]) for r in rows}),
    "description_characters": sum(map(len, desc)), "description_median_characters": statistics.median(map(len, desc)),
    "descriptions_naming_an_action": sum(1 for d in desc if re.search(r"(?i)\b(avoid|do not use|contraindicated|dosage|dose|monitor|consider|recommended)\b", d)),
    "descriptions_referring_to_fda_labeling": sum(1 for d in desc if "FDA labeling" in d),
}
cp = collections.defaultdict(list)
for p in live_pairs:
    cp[(dname.get(p["drugid"], "").lower(), p["genesymbol"])].append(p)
fda_pairs = collections.defaultdict(list)
for r in rows:
    for gene in re.split(r"\s*(?:,|/|\band\b|\bor\b)\s*", r["gene"]):
        if gene.strip():
            fda_pairs[(r["drug"].lower(), gene.strip())].append(r)
shared = sorted(set(cp) & set(fda_pairs))
cpic_genes, cpic_drugs = {p["genesymbol"] for p in live_pairs}, {n.lower() for n in dname.values()}
out["join_drug_name_and_gene_symbol"] = {
    "fda_drug_gene_pairs": len(fda_pairs), "cpic_drug_gene_pairs": len(cp), "shared": len(shared),
    "shared_by_cpic_level": dict(collections.Counter(cp[k][0]["cpiclevel"] for k in shared).most_common()),
    "shared_with_a_cpic_guideline": sum(1 for k in shared if cp[k][0]["guidelineid"]),
    "fda_pairs_whose_gene_is_a_cpic_gene": sum(1 for k in fda_pairs if k[1] in cpic_genes),
    "fda_pairs_whose_drug_name_is_a_cpic_drug": sum(1 for k in fda_pairs if k[0] in cpic_drugs),
    "fda_only_sample": [list(k) for k in sorted(set(fda_pairs) - set(cp))[:15]],
    "cpic_level_a_pairs_not_in_the_fda_table": sum(1 for k, v in cp.items() if v[0]["cpiclevel"] == "A" and k not in fda_pairs),
}
# A recommendation applies to a drug and to the gene or genes named in its lookup key, so it is linked to a
# pair on both, never on the drug alone (one drug can have several gene pairs).
pair_keys = {(p["drugid"], p["genesymbol"]) for p in live_pairs}
rec_genes = [(r["drugid"], sorted((r.get("lookupkey") or {}).keys())) for r in rec]
rec_links = [(d, g) for d, genes in rec_genes for g in genes]
drugs_per_pair_count = collections.Counter(p["drugid"] for p in live_pairs)
out["join_cpic_recommendation_to_pair"] = {
    "recommendations": len(rec), "recommendations_naming_no_gene": sum(1 for _, g in rec_genes if not g),
    "recommendations_naming_more_than_one_gene": sum(1 for _, g in rec_genes if len(g) > 1),
    "recommendation_drug_gene_links": len(rec_links), "links_resolving_to_a_current_pair": sum(1 for k in rec_links if k in pair_keys),
    "recommendations_with_every_gene_resolved": sum(1 for d, genes in rec_genes if genes and all((d, g) in pair_keys for g in genes)),
    "distinct_drug_gene_links": len(set(rec_links)), "distinct_links_resolving": len(set(rec_links) & pair_keys),
    "unresolved_distinct_links": sorted(map(list, set(rec_links) - pair_keys))[:20],
    "pair_drugs_with_more_than_one_current_gene_pair": sum(1 for n in drugs_per_pair_count.values() if n > 1),
    "recommendation_drugs_with_more_than_one_current_gene_pair": sum(1 for d in {r["drugid"] for r in rec} if drugs_per_pair_count[d] > 1),
}
random.seed(20261123)
out["handcheck_sample"] = [{"drug": k[0], "gene": k[1], "cpic_drug_id": cp[k][0]["drugid"], "cpic_level": cp[k][0]["cpiclevel"], "cpic_guideline_id": cp[k][0]["guidelineid"],
                            "fda_section": fda_pairs[k][0]["section"], "fda_subgroup": fda_pairs[k][0]["subgroup"], "fda_description": fda_pairs[k][0]["description"]} for k in random.sample(shared, min(20, len(shared)))]
s.write(__file__, out)
