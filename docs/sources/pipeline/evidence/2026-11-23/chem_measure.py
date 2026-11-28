#!/usr/bin/env python3
"""Round 32 (2026-11-23): chemical substances. ChEBI ontology (EMBL-EBI) and the FDA Global Substance
Registration System UNII list. Measures counts, definitions and the InChIKey join. Writes chem_measure.json."""
import collections, gzip, io, random, re, statistics, zipfile
import scoutlib as s

out = {"run_date": "2026-11-23"}
body = s.get("chebi_obo", "https://ftp.ebi.ac.uk/pub/databases/chebi/ontology/chebi.obo.gz")
terms, cur, header = [], None, []
with gzip.GzipFile(fileobj=io.BytesIO(body)) as f:
    for raw in f:
        line = raw.decode("utf-8").rstrip("\n")
        if line == "[Term]":
            cur = {"xref": [], "syn": 0}
            terms.append(cur)
        elif line.startswith("["):
            cur = None
        elif cur is None:
            if not terms:
                header.append(line)
        elif line.startswith("id: "):
            cur["id"] = line[4:]
        elif line.startswith("name: "):
            cur["name"] = line[6:]
        elif line.startswith("def: "):
            cur["def"] = re.match(r'def: "(.*)" \[', line).group(1)
        elif line.startswith("subset: "):
            cur["subset"] = line[8:]
        elif line.startswith("is_obsolete: true"):
            cur["obsolete"] = True
        elif line.startswith("synonym: "):
            cur["syn"] += 1
        elif line.startswith("xref: "):
            cur["xref"].append(line[6:].split(" ")[0])
        elif line.startswith("property_value: chemrof:inchi_key_string"):
            cur["ik"] = line.split('"')[1]
del body
live = [t for t in terms if not t.get("obsolete")]
defs = [t["def"] for t in live if t.get("def")]
out["chebi"] = {
    "data_version": next(l for l in header if l.startswith("data-version")), "date": next(l for l in header if l.startswith("date")),
    "licence_property": next(l for l in header if "terms:license" in l),
    "terms": len(terms), "live": len(live), "obsolete": len(terms) - len(live),
    "by_subset": dict(collections.Counter(str(t.get("subset")) for t in live).most_common()),
    "with_definition": len(defs), "definition_characters": sum(map(len, defs)), "definition_median_characters": statistics.median(map(len, defs)),
    "with_inchikey": sum(1 for t in live if t.get("ik")), "distinct_inchikeys": len({t["ik"] for t in live if t.get("ik")}),
    "with_cas_xref": sum(1 for t in live if any(x.startswith("cas:") for x in t["xref"])),
    "with_synonym": sum(1 for t in live if t["syn"]),
    "xrefs_by_source": dict(collections.Counter(x.split(":")[0] for t in live for x in t["xref"]).most_common(10)),
}
z = zipfile.ZipFile(io.BytesIO(s.get("unii_zip", "https://precision.fda.gov/uniisearch/archive/latest/UNII_Data.zip")))
name = next(n for n in z.namelist() if n.startswith("UNII_Records"))
lines = z.read(name).decode("utf-8", "replace").splitlines()
h = lines[0].split("\t")
unii = [dict(zip(h, l.split("\t"))) for l in lines[1:] if l.strip()]
out["unii"] = {
    "members": {i.filename: i.file_size for i in z.infolist()}, "records_file": name, "columns": h,
    "records": len(unii), "distinct_unii": len({u["UNII"] for u in unii}),
    "by_substance_type": dict(collections.Counter(str(u.get("SUBSTANCE_TYPE")) for u in unii).most_common()),
    "with_inchikey": sum(1 for u in unii if u.get("INCHIKEY")), "distinct_inchikeys": len({u["INCHIKEY"] for u in unii if u.get("INCHIKEY")}),
    "with_cas_rn": sum(1 for u in unii if u.get("RN")), "with_rxcui": sum(1 for u in unii if u.get("RXCUI")),
    "with_pubchem": sum(1 for u in unii if u.get("PUBCHEM")), "with_epa_comptox": sum(1 for u in unii if u.get("EPA_CompTox")),
    "with_ncit": sum(1 for u in unii if u.get("NCIT")), "with_ema_sms_id": sum(1 for u in unii if u.get("SMSID")),
    "associated_with_a_dailymed_label": sum(1 for u in unii if u.get("DAILYMED")),
}
by_ik = collections.defaultdict(list)
for t in live:
    if t.get("ik"):
        by_ik[t["ik"]].append(t)
u_ik = collections.defaultdict(list)
for u in unii:
    if u.get("INCHIKEY"):
        u_ik[u["INCHIKEY"]].append(u)
shared = sorted(set(by_ik) & set(u_ik))
one = [k for k in shared if len(by_ik[k]) == 1 and len(u_ik[k]) == 1]
cas = lambda t: {x[4:] for x in t["xref"] if x.startswith("cas:")}
out["join_inchikey"] = {
    "unii_distinct_inchikeys": len(u_ik), "chebi_distinct_inchikeys": len(by_ik), "shared": len(shared),
    "shared_one_to_one": len(one), "shared_keys_held_by_more_than_one_chebi_term": sum(1 for k in shared if len(by_ik[k]) > 1),
    "shared_keys_held_by_more_than_one_unii": sum(1 for k in shared if len(u_ik[k]) > 1),
    "one_to_one_pairs_where_both_state_a_cas_number": sum(1 for k in one if cas(by_ik[k][0]) and u_ik[k][0].get("RN")),
    "of_those_with_the_same_cas_number": sum(1 for k in one if u_ik[k][0].get("RN") and u_ik[k][0]["RN"] in cas(by_ik[k][0])),
    "one_to_one_pairs_with_a_chebi_definition": sum(1 for k in one if by_ik[k][0].get("def")),
    "one_to_one_pairs_with_the_same_lowercased_name": sum(1 for k in one if by_ik[k][0]["name"].lower() == u_ik[k][0]["DISPLAY_NAME"].lower()),
}
random.seed(20261123)
out["handcheck_sample"] = [{"inchikey": k, "chebi_id": by_ik[k][0]["id"], "chebi_name": by_ik[k][0]["name"], "unii": u_ik[k][0]["UNII"], "unii_display_name": u_ik[k][0]["DISPLAY_NAME"],
                            "chebi_cas": sorted(cas(by_ik[k][0])), "unii_rn": u_ik[k][0].get("RN")} for k in random.sample(one, 20)]
s.write(__file__, out)
