#!/usr/bin/env python3
"""Round 30 (2026-11-21): human genes. HGNC complete set, NCBI Gene gene_info for Homo sapiens and the
NCBI gene_summary file. Writes gene_measure.json. Stdlib only."""
import collections, csv, gzip, io, random, re
from scoutlib import get, write

out = {"run_date": "2026-11-21"}
hg = list(csv.DictReader(io.StringIO(get("hgnc.txt", "https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt").decode("utf-8")), delimiter="\t"))
approved = [r for r in hg if r["status"] == "Approved"]
filled = lambda f: sum(1 for r in approved if r[f].strip())
out["hgnc_complete_set"] = {
    "rows": len(hg), "by_status": dict(collections.Counter(r["status"] for r in hg)), "columns": len(hg[0]),
    "approved_by_locus_group": dict(collections.Counter(r["locus_group"] for r in approved).most_common()),
    "distinct_hgnc_ids": len({r["hgnc_id"] for r in hg}), "distinct_symbols": len({r["symbol"] for r in hg}),
    "approved_with": {f: filled(f) for f in ("entrez_id", "ensembl_gene_id", "uniprot_ids", "omim_id", "refseq_accession", "alias_symbol", "prev_symbol", "gene_group", "mane_select", "location")},
    "newest_date_modified": max(r["date_modified"] for r in hg), "symbol_changes_dated_2026": sum(1 for r in hg if r["date_symbol_changed"].startswith("2026")),
    "approved_or_reserved_in_2026": sum(1 for r in hg if r["date_approved_reserved"].startswith("2026")),
}

gi_raw = gzip.decompress(get("gene_info.gz", "https://ftp.ncbi.nlm.nih.gov/gene/DATA/GENE_INFO/Mammalia/Homo_sapiens.gene_info.gz")).decode("utf-8")
gi = list(csv.DictReader(io.StringIO(gi_raw.lstrip("#")), delimiter="\t", quoting=csv.QUOTE_NONE))
human = [r for r in gi if r["tax_id"] == "9606"]
def hgnc_of(r):
    m = re.search(r"HGNC:(HGNC:\d+)", r["dbXrefs"])
    return m.group(1) if m else None
ncbi_by_id = {r["GeneID"]: r for r in human}
out["ncbi_gene_info_human"] = {
    "rows": len(gi), "rows_tax_9606": len(human), "by_type_of_gene": dict(collections.Counter(r["type_of_gene"] for r in human).most_common()),
    "with_hgnc_cross_reference": sum(1 for r in human if hgnc_of(r)), "with_ensembl_cross_reference": sum(1 for r in human if "Ensembl:" in r["dbXrefs"]),
    "with_mim_cross_reference": sum(1 for r in human if "MIM:" in r["dbXrefs"]),
    "newest_modification_date": max(r["Modification_date"] for r in human), "modified_in_november_2026": sum(1 for r in human if r["Modification_date"].startswith("202611")),
    "columns": list(gi[0]),
}

summ = {}
total_rows = 0
sources = collections.Counter()
with gzip.open(io.BytesIO(get("gene_summary.gz", "https://ftp.ncbi.nlm.nih.gov/gene/DATA/gene_summary.gz")), "rt", encoding="utf-8") as fh:
    next(fh)
    for line in fh:
        total_rows += 1
        if line.startswith("9606\t"):
            _, gid, src, text = line.rstrip("\n").split("\t", 3)
            summ[gid] = text; sources[src] += 1
lens = sorted(len(t) for t in summ.values())
out["ncbi_gene_summary"] = {
    "rows_all_taxa": total_rows, "human_rows": len(summ), "human_by_source": dict(sources),
    "human_summary_characters": sum(lens), "median_characters": lens[len(lens) // 2],
    "human_summaries_whose_gene_id_is_in_gene_info": sum(1 for g in summ if g in ncbi_by_id),
    "human_summaries_ending_with_a_provider_stamp": sum(1 for t in summ.values() if re.search(r"\[provided by [^\]]+\]\.?$", t.strip())),
    "provider_stamps_top": dict(collections.Counter(m.group(1) for t in summ.values() for m in [re.search(r"\[provided by ([^,\]]+)", t)] if m).most_common(6)),
}

# --- Declared join: the HGNC id NCBI records for a gene, and the Entrez id HGNC records for it --------
hg_by_id = {r["hgnc_id"]: r for r in hg}
ncbi_pairs = {(hgnc_of(r), r["GeneID"]) for r in human if hgnc_of(r)}
hgnc_pairs = {(r["hgnc_id"], r["entrez_id"]) for r in approved if r["entrez_id"].strip()}
resolve = [(h, g) for h, g in ncbi_pairs if h in hg_by_id]
approved_ids = {r["hgnc_id"] for r in approved}
out["hgnc_id_join"] = {
    "ncbi_genes_citing_an_hgnc_id": len(ncbi_pairs), "cited_hgnc_ids_present_in_hgnc_file": len(resolve),
    "cited_hgnc_ids_with_status_approved": sum(1 for h, _ in resolve if h in approved_ids),
    "cited_hgnc_ids_absent_sample": sorted(h for h, _ in ncbi_pairs if h not in hg_by_id)[:10],
    "hgnc_approved_records_citing_an_entrez_id": len(hgnc_pairs),
    "pairs_stated_by_both_sides": len(ncbi_pairs & hgnc_pairs), "pairs_only_ncbi": len(ncbi_pairs - hgnc_pairs), "pairs_only_hgnc": len(hgnc_pairs - ncbi_pairs),
    "both_sided_pairs_with_same_symbol": sum(1 for h, g in ncbi_pairs & hgnc_pairs if hg_by_id[h]["symbol"] == ncbi_by_id[g]["Symbol"]),
    "both_sided_pairs_with_different_symbol_sample": sorted((h, hg_by_id[h]["symbol"], g, ncbi_by_id[g]["Symbol"]) for h, g in ncbi_pairs & hgnc_pairs if hg_by_id[h]["symbol"] != ncbi_by_id[g]["Symbol"])[:10],
    "approved_hgnc_genes": len(approved),
    "approved_hgnc_genes_with_ncbi_summary_through_both_sided_pair": sum(1 for h, g in ncbi_pairs & hgnc_pairs if g in summ),
    "approved_protein_coding_with_summary": sum(1 for h, g in ncbi_pairs & hgnc_pairs if g in summ and hg_by_id[h]["locus_group"] == "protein-coding gene"),
    "approved_protein_coding": sum(1 for r in approved if r["locus_group"] == "protein-coding gene"),
}
random.seed(20261121)
out["handcheck_sample"] = [{"hgnc_id": h, "hgnc_symbol": hg_by_id[h]["symbol"], "hgnc_location": hg_by_id[h]["location"], "gene_id": g, "ncbi_symbol": ncbi_by_id[g]["Symbol"], "ncbi_map_location": ncbi_by_id[g]["map_location"]} for h, g in random.sample(sorted(ncbi_pairs & hgnc_pairs), 20)]
write(__file__, out)
