#!/usr/bin/env python3
"""Round 35 (2026-11-28): United States Code sections. Reads Title 49 of the 2024 edition of the U.S. Code from
GovInfo (one HTML file), and Title 14 of the eCFR (structure JSON and full XML). The join is the U.S. Code
section an eCFR authority citation names ("49 U.S.C. 44701"). Writes usc_measure.json. Stdlib only."""
import collections, html, json, random, re
import scoutlib as s
from termslib import check

out = {"run_date": "2026-11-28"}
raw = s.get("usc_2024_title49.htm", "https://www.govinfo.gov/content/pkg/USCODE-2024-title49/html/USCODE-2024-title49.htm").decode("utf-8", "replace")
docs = re.split(r"(?=<!-- documentid:)", raw)[1:]
sections = {}
for d in docs:
    m = re.search(r'<h3 class="section-head">&sect;\s*([0-9]+[a-zA-Z0-9\-]*)\.\s*(.*?)</h3>', d, re.S)
    if not m:
        continue
    body = html.unescape(re.sub(r"<[^>]+>", " ", d))
    sections[m.group(1)] = {"heading": re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", m.group(2)))).strip(), "chars": len(re.sub(r"\s+", " ", body)),
        "has_source_credit": 'class="source-credit"' in d, "public_laws": len(set(re.findall(r"Pub\. L\. (\d+)&ndash;(\d+)", d))),
        "status": ("repealed" if re.search(r"Repealed", m.group(2)) else "omitted" if "Omitted" in m.group(2) else "transferred" if "Transferred" in m.group(2) else "renumbered" if "Renumbered" in m.group(2) else "current"),
        "has_notes": "Statutory Notes" in d or "Editorial Notes" in d, "cross_refs_to_usc": len(re.findall(r"section \d+[a-z]? of title \d+", body))}
out["us_code_title_49_2024"] = {"documents": len(docs), "sections": len(sections), "by_status": dict(collections.Counter(v["status"] for v in sections.values()).most_common()),
    "characters": sum(v["chars"] for v in sections.values()), "median_characters": sorted(v["chars"] for v in sections.values())[len(sections) // 2],
    "with_source_credit": sum(v["has_source_credit"] for v in sections.values()), "distinct_public_law_citations_summed": sum(v["public_laws"] for v in sections.values()),
    "with_notes": sum(v["has_notes"] for v in sections.values()), "citations_to_other_code_sections": sum(v["cross_refs_to_usc"] for v in sections.values())}
titles = json.loads(s.getz("ecfr_titles.json", "https://www.ecfr.gov/api/versioner/v1/titles.json"))
t14 = next(t for t in titles["titles"] if t["number"] == 14)
date = t14["up_to_date_as_of"]
st = json.loads(s.getz("ecfr_title14_structure.json", f"https://www.ecfr.gov/api/versioner/v1/structure/{date}/title-14.json"))
kinds = collections.Counter()
def walk(n):
    kinds[n.get("type")] += 1
    for c in n.get("children", []):
        walk(c)
walk(st)
xml = s.getz("ecfr_title14_full.xml", f"https://www.ecfr.gov/api/versioner/v1/full/{date}/title-14.xml", timeout=600).decode("utf-8", "replace")
out["ecfr_title_14"] = {"up_to_date_as_of": date, "latest_amended_on": t14.get("latest_amended_on"), "structure_nodes_by_type": dict(kinds.most_common()), "full_xml_characters": len(xml)}
parts = re.findall(r'<DIV5 N="([^"]+)" TYPE="PART".*?(?=<DIV5 |\Z)', xml, re.S)
cites, part_auth, unparsed = [], {}, 0
for m in re.finditer(r'<DIV5 N="([^"]+)" TYPE="PART"(.*?)(?=<DIV5 |\Z)', xml, re.S):
    part, body = m.group(1), m.group(2)
    head = re.search(r"<HEAD>(.*?)</HEAD>", body, re.S)
    auth = re.search(r"<AUTH>(.*?)</AUTH>", body, re.S)
    if not auth:
        continue
    text = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", auth.group(1)))).strip()
    part_auth[part] = {"heading": re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", head.group(1)))).strip() if head else None, "text": text}
    if "U.S.C." not in text:
        unparsed += 1
    for tm in re.finditer(r"(\d+) U\.S\.C\.(?: App\.)? (.*?)(?=\d+ U\.S\.C\.|;|Pub\. L\.|E\.O\.|\Z)", text):
        if "App." in tm.group(0)[:16]:
            continue
        # The list of sections ends where another kind of citation begins (Federal Register, Statutes at Large, a treaty, a CFR part).
        lst = re.split(r"\d+ (?:FR|Stat\.|U\.S\.T\.|CFR)\b|\b(?:[Ss]ecs?\.|[Ss]ections?|[Aa]rticles?|Reorganization Plan)\b", tm.group(2))[0]
        lst = re.sub(r"\([^)]*\)", "", lst)
        for tok in re.findall(r"\d+[a-z]?(?:\s*[–-]\s*\d+[a-z]?)?", lst):
            ends = [e.strip() for e in re.split(r"[–-]", tok)]
            for e in ends:
                cites.append((part, tm.group(1), e, len(ends) > 1))
c49 = [c for c in cites if c[1] == "49"]
hit = [c for c in c49 if c[2] in sections]
out["ecfr_authority_citations"] = {"parts_in_full_xml": len(parts), "parts_with_authority_line": len(part_auth), "authority_characters": sum(len(v["text"]) for v in part_auth.values()),
    "authority_lines_without_a_usc_citation": unparsed, "section_citations_extracted": len(cites), "by_code_title": dict(collections.Counter(c[1] for c in cites).most_common(8)),
    "citations_that_are_range_endpoints": sum(1 for c in cites if c[3])}
out["join_usc_section"] = {"citations_to_title_49": len(c49), "distinct_title_49_sections_cited": len({c[2] for c in c49}), "citations_resolving_in_the_2024_code": len(hit),
    "distinct_sections_resolving": len({c[2] for c in hit}), "resolving_to_a_repealed_omitted_or_transferred_section": sum(1 for c in hit if sections[c[2]]["status"] != "current"),
    "not_resolving_sections_with_citing_part_count": dict(sorted(collections.Counter(c[2] for c in set(c49) if c[2] not in sections).items())),
    "documents_in_the_code_file_without_a_parsed_section_heading": len(docs) - len(sections), "parts_citing_title_49": len({c[0] for c in c49})}
random.seed(20261128)
out["handcheck_sample"] = [{"cfr_part": f"14 CFR part {p}", "cfr_part_heading": part_auth[p]["heading"], "usc_section": f"49 U.S.C. {sec}", "usc_section_heading": sections[sec]["heading"],
    "authority_line": part_auth[p]["text"][:700], "was_range_endpoint": rng} for p, _, sec, rng in random.sample(sorted(set(hit)), 20)]
out["terms"] = {
    "govinfo": check("terms_govinfo.html", "https://www.govinfo.gov/about/policies", ["By virtue of the foregoing, public documents can generally be reprinted without legal restriction."], ("public domain", "copyright")),
    "ecfr": check("terms_ecfr.html", "https://www.ecfr.gov/reader-aids/government-policy-and-ogc/terms-of-service", [], ("copyright", "public domain", "reuse", "commercial", "permission", "not an official")),
}
s.write(__file__, out)
