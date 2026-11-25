#!/usr/bin/env python3
"""Round 34 (2026-11-25): Unicode characters. Reads the Unicode Character Database (UnicodeData.txt and the
annotated NamesList.txt), the Unicode emoji test file, and the WHATWG HTML named character reference table
(entities.json). The join is the Unicode code point. Writes unicode_measure.json. Stdlib only."""
import collections, json, random, re
import scoutlib as s
from termslib import check

out = {"run_date": "2026-11-25"}
ud = s.get("UnicodeData.txt", "https://www.unicode.org/Public/UCD/latest/ucd/UnicodeData.txt").decode("utf-8").splitlines()
chars, ranges, first = {}, [], None
for l in ud:
    f = l.split(";")
    cp = int(f[0], 16)
    if f[1].endswith(", First>"):
        first = (cp, f[1][1:-8], f[2])
    elif f[1].endswith(", Last>"):
        ranges.append((first[0], cp, first[1], first[2]))
    else:
        chars[cp] = {"name": f[1], "category": f[2], "old_name": f[10], "decomposition": f[5]}
def lookup(cp):
    if cp in chars:
        return chars[cp]
    for a, b, name, cat in ranges:
        if a <= cp <= b:
            return {"name": f"<{name}>", "category": cat}
    return None
out["unicode_data"] = {
    "lines": len(ud), "individually_listed_code_points": len(chars), "ranges": len(ranges),
    "code_points_inside_ranges": sum(b - a + 1 for a, b, _, _ in ranges),
    "by_major_category": dict(sorted(collections.Counter(c["category"][0] for c in chars.values()).items())),
    "with_decomposition_mapping": sum(1 for c in chars.values() if c["decomposition"]),
    "with_unicode_1_name": sum(1 for c in chars.values() if c["old_name"]),
}
nl = s.get("NamesList.txt", "https://www.unicode.org/Public/UCD/latest/ucd/NamesList.txt").decode("utf-8").splitlines()
entries, cur = {}, None
kinds = collections.Counter()
for l in nl:
    m = re.match(r"^([0-9A-F]{4,6})\t(.*)", l)
    if m:
        cur = int(m.group(1), 16); entries[cur] = []
    elif cur is not None and l.startswith("\t") and len(l) > 2 and l[1] in "=*x%#:~":
        entries[cur].append((l[1], l[3:])); kinds[l[1]] += 1
    elif l.startswith("@"):
        cur = None
notes = [t for v in entries.values() for k, t in v if k == "*"]
out["names_list"] = {
    "version_line": nl[1].strip(), "lines": len(nl), "code_point_entries": len(entries), "block_headers": sum(1 for l in nl if l.startswith("@@\t")),
    "annotation_lines_by_kind": {"alias (=)": kinds["="], "informative note (*)": kinds["*"], "cross reference (x)": kinds["x"], "formal alias (%)": kinds["%"],
                                 "compatibility decomposition (#)": kinds["#"], "canonical decomposition (:)": kinds[":"], "variation sequence (~)": kinds["~"]},
    "entries_with_an_informative_note": sum(1 for v in entries.values() if any(k == "*" for k, _ in v)),
    "informative_note_characters": sum(map(len, notes)),
    "entries_with_an_alias": sum(1 for v in entries.values() if any(k == "=" for k, _ in v)),
    "entries_with_a_cross_reference": sum(1 for v in entries.values() if any(k == "x" for k, _ in v)),
    "entries_found_in_unicode_data": sum(1 for cp in entries if lookup(cp)),
    "example": {"code_point": "U+00B5", "name": chars[0xB5]["name"], "annotations": entries.get(0xB5)},
}
ent = json.loads(s.get("whatwg_entities.json", "https://html.spec.whatwg.org/entities.json"))
cps = [cp for v in ent.values() for cp in v["codepoints"]]
distinct = sorted(set(cps))
out["whatwg_named_character_references"] = {"entities": len(ent), "with_trailing_semicolon": sum(1 for k in ent if k.endswith(";")),
    "mapping_to_two_code_points": sum(1 for v in ent.values() if len(v["codepoints"]) == 2), "distinct_code_points": len(distinct)}
out["join_code_point_whatwg"] = {"distinct_code_points_cited_by_entities": len(distinct), "resolved_in_unicode_data": sum(1 for c in distinct if lookup(c)),
    "unresolved": [f"U+{c:04X}" for c in distinct if not lookup(c)][:10],
    "resolved_by_category": dict(collections.Counter(lookup(c)["category"] for c in distinct if lookup(c)).most_common(8)),
    "resolved_with_a_names_list_annotation": sum(1 for c in distinct if entries.get(c))}
em = s.get("emoji-test.txt", "https://unicode.org/Public/emoji/latest/emoji-test.txt").decode("utf-8").splitlines()
seqs = [(l.split(";")[0].split(), l.split(";")[1].split("#")[0].strip(), l.split("#", 1)[1].strip()) for l in em if l and not l.startswith("#") and ";" in l]
ecp = sorted({int(c, 16) for q, _, _ in seqs for c in q})
out["emoji_test"] = {"header": [l for l in em[:12] if "Version" in l or "Date" in l], "sequences": len(seqs),
    "by_status": dict(collections.Counter(st for _, st, _ in seqs)), "groups": sum(1 for l in em if l.startswith("# group:")),
    "distinct_code_points": len(ecp), "resolved_in_unicode_data": sum(1 for c in ecp if lookup(c)),
    "unresolved": [f"U+{c:04X}" for c in ecp if not lookup(c)][:10]}
random.seed(20261125)
single = sorted(k for k, v in ent.items() if k.endswith(";") and len(v["codepoints"]) == 1)
out["handcheck_sample"] = [{"entity": k, "code_point": f"U+{ent[k]['codepoints'][0]:04X}", "unicode_name": lookup(ent[k]["codepoints"][0])["name"],
                            "annotations": [t for _, t in entries.get(ent[k]["codepoints"][0], [])][:2]} for k in random.sample(single, 20)]
out["terms"] = {
    "unicode": check("terms_unicode_license.txt", "https://www.unicode.org/license.txt", [], ("Permission is hereby granted", "without restriction", "provided that")),
    "whatwg": check("terms_whatwg.html", "https://html.spec.whatwg.org/multipage/", [], ("Creative Commons", "Copyright")),
}
s.write(__file__, out)
