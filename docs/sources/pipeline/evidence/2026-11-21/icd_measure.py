#!/usr/bin/env python3
"""Round 30 (2026-11-21): ICD-10-CM diagnosis codes. CDC NCHS FY2027 release (order file, addenda,
tabular XML with instructional notes) and the CMS copy of the code descriptions. Writes icd_measure.json.
Stdlib only."""
import collections, hashlib, io, re, zipfile
import xml.etree.ElementTree as ET
from scoutlib import get, write

BASE = "https://ftp.cdc.gov/pub/Health_Statistics/NCHS/Publications/ICD10CM/2027/"
out = {"run_date": "2026-11-21"}
listing = get("cdc_dir27.html", BASE).decode("utf-8", "replace")
out["cdc_directory_2027"] = [{"date": d, "bytes": int(b), "file": f} for d, b, f in re.findall(r"(\d+/\d+/\d{4})\s+\d+:\d+ [AP]M\s+(\d+)\s+<A HREF=\"[^\"]+\">([^<]+)</A>", listing, re.I)]

def order_rows(text):
    rows = []
    for line in text.splitlines():
        if len(line) < 16:
            continue
        rows.append({"code": line[6:13].strip(), "billable": line[14] == "1", "short": line[16:76].strip(), "long": line[77:].strip()})
    return rows

cdc_zip = zipfile.ZipFile(io.BytesIO(get("cdc_icd10cm-code-descriptions-2027.zip", BASE + "icd10cm-code-descriptions-2027.zip")))
name = lambda z, pat: next(n for n in z.namelist() if re.search(pat, n))
cdc_order_bytes = cdc_zip.read(name(cdc_zip, r"order-2027\.txt$"))
cdc = order_rows(cdc_order_bytes.decode("utf-8"))
codes = {r["code"]: r for r in cdc}
addenda = cdc_zip.read(name(cdc_zip, r"order-addenda-2027\.txt$")).decode("utf-8", "replace")
actions = collections.Counter(m.group(1) for l in addenda.splitlines() for m in [re.match(r"(Add|Delete|Revise to):", l)] if m)
out["cdc_order_file"] = {
    "rows": len(cdc), "distinct_codes": len(codes), "billable_codes": sum(1 for r in cdc if r["billable"]), "header_codes": sum(1 for r in cdc if not r["billable"]),
    "three_character_categories": sum(1 for c in codes if len(c) == 3), "code_lengths": dict(sorted(collections.Counter(len(c) for c in codes).items())),
    "first_letters": len({c[0] for c in codes}), "long_description_characters": sum(len(r["long"]) for r in cdc),
    "order_addenda_rows": {"additions": actions["Add"], "deletions": actions["Delete"], "revisions": actions["Revise to"]},
}

tab_zip = zipfile.ZipFile(io.BytesIO(get("cdc_icd10cm-table-and-index-2027.zip", BASE + "icd10cm-table-and-index-2027.zip")))
root = ET.fromstring(tab_zip.read(name(tab_zip, r"tabular.*\.xml$")))
NOTE_TAGS = ("includes", "inclusionTerm", "excludes1", "excludes2", "codeFirst", "useAdditionalCode", "codeAlso", "notes", "sevenChrNote")
note_rows, note_chars, diag_with = collections.Counter(), collections.Counter(), collections.Counter()
cited, cite_notes = collections.Counter(), 0
CODE = re.compile(r"\b([A-TV-Z]\d[0-9AB](?:\.[0-9A-Z]{1,4})?)(-?)")
diags = 0
unresolved = collections.Counter()
for d in root.iter("diag"):
    diags += 1
    for tag in NOTE_TAGS:
        el = d.find(tag)
        if el is None:
            continue
        diag_with[tag] += 1
        for n in el.findall("note"):
            text = n.text or ""
            note_rows[tag] += 1; note_chars[tag] += len(text)
            found = CODE.findall(text)
            if found:
                cite_notes += 1
            for code, dash in found:
                stem = code.replace(".", "")   # the order file writes codes without the dot
                ok = stem in codes or bool(dash and any(c.startswith(stem) for c in codes))
                cited["resolved" if ok else "unresolved"] += 1
                if not ok:
                    unresolved[stem] += 1
tab_codes = {(d.findtext("name") or "").replace(".", "") for d in root.iter("diag")}
out["cdc_tabular_xml"] = {
    "version": root.findtext("version"), "chapters": len(root.findall("chapter")), "sections": len(list(root.iter("section"))), "diag_elements": diags,
    "distinct_diag_codes": len(tab_codes), "diag_codes_in_order_file": len(tab_codes & set(codes)), "order_codes_not_in_tabular": len(set(codes) - tab_codes),
    "diag_elements_with_note_type": dict(diag_with.most_common()), "note_rows_by_type": dict(note_rows.most_common()), "note_characters_by_type": dict(note_chars.most_common()),
    "note_rows": sum(note_rows.values()), "note_characters": sum(note_chars.values()),
    "note_rows_citing_a_code": cite_notes, "code_citations": sum(cited.values()), "code_citations_resolving_to_an_order_file_code_or_prefix": cited["resolved"],
    "unresolved_citation_top": dict(unresolved.most_common(12)),
    "seven_character_definition_blocks": len(list(root.iter("sevenChrDef"))),
}

cms_zip = zipfile.ZipFile(io.BytesIO(get("cms27.zip", "https://www.cms.gov/files/zip/2027-code-descriptions-tabular-order.zip")))
cms_order_bytes = cms_zip.read(name(cms_zip, r"order_2027\.txt$"))
cms = order_rows(cms_order_bytes.decode("utf-8"))
cms_codes = {r["code"]: r for r in cms}
both = set(codes) & set(cms_codes)
out["cms_copy"] = {
    "zip_members": cms_zip.namelist(), "rows": len(cms), "distinct_codes": len(cms_codes),
    "order_file_sha256_cdc": hashlib.sha256(cdc_order_bytes).hexdigest(), "order_file_sha256_cms": hashlib.sha256(cms_order_bytes).hexdigest(),
    "order_files_byte_identical": cdc_order_bytes == cms_order_bytes,
}
out["icd10cm_code_join"] = {
    "cdc_codes": len(codes), "cms_codes": len(cms_codes), "in_both": len(both),
    "same_long_description": sum(1 for c in both if codes[c]["long"] == cms_codes[c]["long"]),
    "same_billable_flag": sum(1 for c in both if codes[c]["billable"] == cms_codes[c]["billable"]),
}

# --- Independent publisher: ICD-10-CM codes cited as cross-references by the Mondo Disease Ontology ----
obo = get("mondo.obo", "https://purl.obolibrary.org/obo/mondo.obo").decode("utf-8")
header, *stanzas = obo.split("\n[Term]\n")
pairs = []
for st in stanzas:
    st = st.split("\n[Typedef]")[0]
    tid = re.search(r"^id: (MONDO:\d+)", st, re.M)
    if not tid or re.search(r"^is_obsolete: true", st, re.M):
        continue
    for code, qual in re.findall(r"^xref: ICD10CM:(\S+)(?: \{([^}]*)\})?", st, re.M):
        pairs.append((tid.group(1), code, qual or ""))
cited_codes = {c for _, c, _ in pairs}
res = {c for c in cited_codes if c.replace(".", "") in codes}
quals = collections.Counter(re.sub(r'source="([^"]*)".*', r"\1", q) for _, _, q in pairs)
out["mondo_icd10cm_xrefs"] = {
    "mondo_data_version": re.search(r"data-version: (\S+)", header).group(1),
    "live_terms_citing_an_icd10cm_code": len({m for m, _, _ in pairs}), "xref_rows": len(pairs), "distinct_codes_cited": len(cited_codes),
    "distinct_codes_resolving_in_cdc_order_file": len(res), "unresolved_sample": sorted(cited_codes - res)[:15],
    "resolved_billable": sum(1 for c in res if codes[c.replace(".", "")]["billable"]),
    "xref_rows_by_first_source_qualifier": dict(quals.most_common(6)),
    "codes_cited_by_more_than_one_term": sum(1 for v in collections.Counter(c for _, c, _ in pairs).values() if v > 1),
}
import random
random.seed(20261121)
names = {}
for st in stanzas:
    m = re.search(r"^id: (MONDO:\d+)\nname: (.*)", st, re.M)
    if m:
        names[m.group(1)] = m.group(2)
ok_pairs = sorted((m, c) for m, c, _ in pairs if c in res)
out["mondo_handcheck_sample"] = [{"mondo": m, "mondo_name": names.get(m), "icd10cm": c, "icd10cm_long_description": codes[c.replace(".", "")]["long"]} for m, c in random.sample(ok_pairs, 20)]
write(__file__, out)
