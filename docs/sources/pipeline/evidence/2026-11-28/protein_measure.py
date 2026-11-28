#!/usr/bin/env python3
"""Round 35 (2026-11-28): protein structures. Reads the RCSB PDB list of current entry ids, 40 seeded entries
with their polymer entities, and the UniProtKB record of every UniProt accession those entities cite. The join
is the UniProt accession a PDB polymer entity cites. Writes protein_measure.json. Stdlib only."""
import collections, json, random, re, urllib.request, time
import scoutlib as s
from termslib import check

out = {"run_date": "2026-11-28"}
ids = sorted(json.loads(s.get("rcsb_entry_ids.json", "https://data.rcsb.org/rest/v1/holdings/current/entry_ids")))
out["rcsb_holdings"] = {"current_entry_ids": len(ids), "first": ids[0], "last": ids[-1]}
random.seed(20261128)
entries, pairs = [], []
for pid in random.sample(ids, 40):
    body, err = s.try_get(f"rcsb_entry_{pid}.json", f"https://data.rcsb.org/rest/v1/core/entry/{pid}")
    if err:
        entries.append({"pdb_id": pid, "error": err}); continue
    e = json.loads(body)
    ent_ids = e["rcsb_entry_container_identifiers"].get("polymer_entity_ids") or []
    rec = {"pdb_id": pid, "title": (e.get("struct") or {}).get("title"), "method": [x.get("method") for x in e.get("exptl", [])], "release": (e["rcsb_accession_info"].get("initial_release_date") or "")[:10],
           "polymer_entities": len(ent_ids), "has_primary_citation_doi": bool((e.get("rcsb_primary_citation") or {}).get("pdbx_database_id_DOI")),
           "resolution": (e.get("rcsb_entry_info") or {}).get("resolution_combined"), "uniprot": []}
    for eid in ent_ids[:3]:
        b2, err2 = s.try_get(f"rcsb_entity_{pid}_{eid}.json", f"https://data.rcsb.org/rest/v1/core/polymer_entity/{pid}/{eid}")
        if err2:
            continue
        pe = json.loads(b2)
        desc = (pe.get("rcsb_polymer_entity") or {}).get("pdbx_description")
        for r in (pe.get("rcsb_polymer_entity_container_identifiers") or {}).get("reference_sequence_identifiers") or []:
            if r.get("database_name") == "UniProt":
                rec["uniprot"].append(r["database_accession"])
                pairs.append({"pdb_id": pid, "entity": eid, "pdb_entity_description": desc, "uniprot_accession": r["database_accession"], "provenance": r.get("provenance_source")})
    entries.append(rec)
ok = [e for e in entries if "error" not in e]
out["rcsb_entries_sample"] = {"requested": 40, "read": len(ok), "with_title": sum(1 for e in ok if e["title"]), "title_characters": sum(len(e["title"] or "") for e in ok),
    "by_method": dict(collections.Counter(m for e in ok for m in e["method"]).most_common()), "with_primary_citation_doi": sum(e["has_primary_citation_doi"] for e in ok),
    "with_resolution": sum(1 for e in ok if e["resolution"]), "release_year_range": [min(e["release"] for e in ok)[:4], max(e["release"] for e in ok)[:4]],
    "polymer_entities": sum(e["polymer_entities"] for e in ok), "entries_citing_a_uniprot_accession": sum(1 for e in ok if e["uniprot"]), "entity_to_uniprot_citations": len(pairs)}
accs = sorted({p["uniprot_accession"] for p in pairs})
up = {}
for a in accs:
    body, err = s.try_get(f"uniprot_{a}.json", f"https://rest.uniprot.org/uniprotkb/{a}.json")
    if err:
        up[a] = {"error": err}; continue
    u = json.loads(body)
    fn = [t.get("value", "") for c in u.get("comments", []) if c.get("commentType") == "FUNCTION" for t in c.get("texts", [])]
    name = ((u.get("proteinDescription") or {}).get("recommendedName") or {}).get("fullName", {}).get("value") or next((x["fullName"]["value"] for x in (u.get("proteinDescription") or {}).get("submissionNames", [])), None)
    up[a] = {"entry_type": u.get("entryType"), "primary_accession": u.get("primaryAccession"), "protein_name": name, "organism": (u.get("organism") or {}).get("scientificName"),
             "function_characters": sum(len(x) for x in fn), "pdb_cross_references": sorted(x["id"] for x in u.get("uniProtKBCrossReferences", []) if x.get("database") == "PDB"),
             "inactive": u.get("entryType") == "Inactive"}
good = {a: v for a, v in up.items() if "error" not in v and not v["inactive"]}
for p in pairs:
    v = up[p["uniprot_accession"]]
    p["uniprot_protein_name"] = v.get("protein_name"); p["uniprot_organism"] = v.get("organism"); p["uniprot_lists_this_pdb_id"] = p["pdb_id"] in v.get("pdb_cross_references", [])
out["join_uniprot_accession"] = {"distinct_accessions_cited": len(accs), "resolving_to_an_active_uniprotkb_record": len(good),
    "errors_or_inactive": {a: (v.get("error") or "inactive") for a, v in up.items() if a not in good},
    "citations": len(pairs), "citations_resolving": sum(1 for p in pairs if p["uniprot_accession"] in good),
    "citations_where_uniprot_lists_the_pdb_id_back": sum(1 for p in pairs if p["uniprot_lists_this_pdb_id"]),
    "by_uniprot_entry_type": dict(collections.Counter(v["entry_type"] for v in good.values()).most_common()),
    "records_with_function_text": sum(1 for v in good.values() if v["function_characters"]), "function_characters": sum(v["function_characters"] for v in good.values()),
    "by_provenance": dict(collections.Counter(p["provenance"] for p in pairs).most_common())}
def total(query):
    s.REQUESTS += 1
    req = urllib.request.Request("https://rest.uniprot.org/uniprotkb/search?size=1&fields=accession&query=" + query, headers={"User-Agent": s.UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        r.read(); time.sleep(0.5)
        return {"total": int(r.headers.get("X-Total-Results")), "release": r.headers.get("X-UniProt-Release"), "release_date": r.headers.get("X-UniProt-Release-Date")}
out["uniprot_totals"] = {"reviewed": total("reviewed:true"), "with_a_pdb_cross_reference": total("database:pdb"), "reviewed_with_a_pdb_cross_reference": total("reviewed:true%20AND%20database:pdb")}
out["rcsb_entries"] = entries
out["handcheck_sample"] = pairs[:20] if len(pairs) <= 20 else random.sample(pairs, 20)
out["terms"] = {
    "rcsb": check("terms_rcsb.html", "https://www.rcsb.org/pages/usage-policy", [], ("CC0", "Public Domain", "attribution")),
    "uniprot": check("terms_uniprot.html", "https://www.uniprot.org/help/license", [], ("Creative Commons", "CC BY", "licen")),
    "uniprot_ftp_license": check("terms_uniprot_ftp_license.txt", "https://ftp.uniprot.org/pub/databases/uniprot/current_release/knowledgebase/complete/LICENSE", [], ("Creative Commons", "Attribution", "licen")),
}
s.write(__file__, out)
