#!/usr/bin/env python3
"""Round 35 (2026-11-28): languages. Reads the SIL ISO 639-3 code table and retirements table, the Glottolog
CLDF languoid table and the IANA language subtag registry. The join is the ISO 639-3 code a Glottolog languoid
or an IANA subtag record carries. Writes lang_measure.json. Stdlib only."""
import collections, csv, io, random, re
import scoutlib as s
from termslib import check

out = {"run_date": "2026-11-28"}
tab = s.get("iso-639-3.tab", "https://iso639-3.sil.org/sites/iso639-3/files/downloads/iso-639-3.tab").decode("utf-8-sig")
sil = {r["Id"]: r for r in csv.DictReader(io.StringIO(tab), delimiter="\t")}
out["sil_iso_639_3"] = {"codes": len(sil), "by_scope": dict(collections.Counter(r["Scope"] for r in sil.values()).most_common()),
    "by_type": dict(collections.Counter(r["Language_Type"] for r in sil.values()).most_common()),
    "with_two_letter_code": sum(1 for r in sil.values() if r["Part1"]), "with_comment": sum(1 for r in sil.values() if (r.get("Comment") or "").strip())}
ret = list(csv.DictReader(io.StringIO(s.get("iso-639-3_Retirements.tab", "https://iso639-3.sil.org/sites/iso639-3/files/downloads/iso-639-3_Retirements.tab").decode("utf-8-sig")), delimiter="\t"))
remedy = [r for r in ret if (r.get("Ret_Remedy") or "").strip()]
cited = [c for r in remedy for c in re.findall(r"\[([a-z]{3})\]", r["Ret_Remedy"])]
out["sil_retirements"] = {"rows": len(ret), "by_reason": dict(collections.Counter(r["Ret_Reason"] for r in ret).most_common()),
    "with_change_to": sum(1 for r in ret if r.get("Change_To")), "with_remedy_prose": len(remedy), "remedy_characters": sum(len(r["Ret_Remedy"]) for r in remedy),
    "codes_cited_in_remedy_prose": len(cited), "cited_codes_in_current_table": sum(1 for c in cited if c in sil),
    "change_to_in_current_table": sum(1 for r in ret if r.get("Change_To") in sil), "effective_range": [min(r["Effective"] for r in ret), max(r["Effective"] for r in ret)],
    "retired_ids_reused_in_current_table": sum(1 for r in ret if r["Id"] in sil)}
glo = list(csv.DictReader(io.StringIO(s.get("glottolog_languages.csv", "https://cdn.jsdelivr.net/gh/glottolog/glottolog-cldf@master/cldf/languages.csv").decode("utf-8"))))
with_iso = [g for g in glo if g.get("ISO639P3code")]
hit = [g for g in with_iso if g["ISO639P3code"] in sil]
out["glottolog"] = {"languoids": len(glo), "columns": list(glo[0].keys()), "by_level": dict(collections.Counter(g.get("Level") for g in glo).most_common()),
    "with_coordinates": sum(1 for g in glo if g.get("Latitude")), "with_family": sum(1 for g in glo if g.get("Family_ID")),
    "by_macroarea": dict(collections.Counter(g.get("Macroarea") or "(none)" for g in glo).most_common(8))}
retired = {r["Id"] for r in ret}
miss = [g for g in with_iso if g["ISO639P3code"] not in sil]
out["join_glottolog_to_sil"] = {"languoids_with_iso_code": len(with_iso), "distinct_iso_codes": len({g["ISO639P3code"] for g in with_iso}), "found_in_sil_table": len(hit),
    "not_found": len(miss), "not_found_that_are_retired_codes": sum(1 for g in miss if g["ISO639P3code"] in retired), "not_found_sample": [(g["ID"], g["Name"], g["ISO639P3code"]) for g in miss[:10]],
    "sil_individual_living_codes": sum(1 for r in sil.values() if r["Scope"] == "I" and r["Language_Type"] == "L"),
    "sil_codes_with_a_glottolog_languoid": len({g["ISO639P3code"] for g in hit}), "same_name_ignoring_case": sum(1 for g in hit if g["Name"].lower() == sil[g["ISO639P3code"]]["Ref_Name"].lower())}
reg = s.get("iana_language_subtag_registry.txt", "https://www.iana.org/assignments/language-subtag-registry/language-subtag-registry").decode("utf-8")
recs = []
for block in reg.split("\n%%\n"):
    d = collections.defaultdict(list); last = None
    for line in block.splitlines():
        if line.startswith("  ") and last:
            d[last][-1] += " " + line.strip()
        elif ": " in line:
            k, v = line.split(": ", 1); d[k].append(v); last = k
    recs.append(d)
langs = [r for r in recs if r.get("Type") == ["language"]]
three = [r for r in langs if len(r["Subtag"][0]) == 3 and "Deprecated" not in r and r.get("Scope") != ["private-use"]]
two = [r for r in langs if len(r["Subtag"][0]) == 2 and "Deprecated" not in r]
part1 = {r["Part1"] for r in sil.values() if r["Part1"]}
out["iana_registry"] = {"file_date": recs[0].get("File-Date", [None])[0], "records": len(recs) - 1, "by_type": dict(collections.Counter(r["Type"][0] for r in recs[1:] if "Type" in r).most_common()),
    "language_records": len(langs), "deprecated_language_records": sum(1 for r in langs if "Deprecated" in r), "language_records_with_comments": sum(1 for r in langs if "Comments" in r),
    "comment_characters": sum(len(c) for r in recs for c in r.get("Comments", [])), "with_macrolanguage": sum(1 for r in langs if "Macrolanguage" in r), "with_suppress_script": sum(1 for r in langs if "Suppress-Script" in r)}
out["join_iana_to_sil"] = {"current_three_letter_language_subtags": len(three), "found_in_sil_table": sum(1 for r in three if r["Subtag"][0] in sil),
    "not_found_sample": [r["Subtag"][0] for r in three if r["Subtag"][0] not in sil][:15],
    "current_two_letter_language_subtags": len(two), "two_letter_found_as_sil_part1": sum(1 for r in two if r["Subtag"][0] in part1)}
random.seed(20261128)
out["handcheck_sample"] = [{"glottocode": g["ID"], "glottolog_name": g["Name"], "iso_639_3": g["ISO639P3code"], "sil_name": sil[g["ISO639P3code"]]["Ref_Name"],
    "sil_type": sil[g["ISO639P3code"]]["Language_Type"], "glottolog_level": g["Level"], "macroarea": g.get("Macroarea")} for g in random.sample(sorted(hit, key=lambda g: g["ID"]), 20)]
out["terms"] = {
    "sil": check("terms_sil.html", "https://iso639-3.sil.org/code_tables/download_tables", ["The ISO 639-3 code set may be downloaded and incorporated into software products, web-based systems, digital devices, etc., either commercial or non-commercial, provided that:"], ("attribution is given", "not modified")),
    "glottolog": check("terms_glottolog_downloads.html", "https://glottolog.org/meta/downloads", [], ("licensed under", "Creative Commons")),
    "glottolog_cldf_metadata_dc_license": __import__("json").loads(s.get("glottolog_cldf_metadata.json", "https://cdn.jsdelivr.net/gh/glottolog/glottolog-cldf@master/cldf/cldf-metadata.json")).get("dc:license"),
    "iana": check("terms_iana.html", "https://www.iana.org/help/licensing-terms", [], ("CC0", "public domain")),
}
s.write(__file__, out)
