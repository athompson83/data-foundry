#!/usr/bin/env python3
"""Round 35 (2026-11-28): software weakness types. Reads the MITRE CWE catalogue (XML in a zip), the MITRE CAPEC
attack-pattern catalogue, and one page of NVD CVE records published 2026-11-01 to 2026-11-21. The join is the
CWE id a CVE record or an attack pattern cites. Writes cwe_measure.json. Stdlib only."""
import collections, io, json, random, re, zipfile
import xml.etree.ElementTree as ET
import scoutlib as s
from termslib import check

out = {"run_date": "2026-11-28"}
z = zipfile.ZipFile(io.BytesIO(s.get("cwec_latest.xml.zip", "https://cwe.mitre.org/data/xml/cwec_latest.xml.zip")))
root = ET.fromstring(z.read(z.namelist()[0]))
ns = {"c": root.tag.split("}")[0].strip("{")}
def text(el):
    return re.sub(r"\s+", " ", "".join(el.itertext())).strip() if el is not None else ""
weak = {}
for w in root.find("c:Weaknesses", ns):
    weak[w.get("ID")] = {"name": w.get("Name"), "abstraction": w.get("Abstraction"), "status": w.get("Status"),
        "description": text(w.find("c:Description", ns)), "extended": text(w.find("c:Extended_Description", ns)),
        "mitigations": len(w.findall("c:Potential_Mitigations/c:Mitigation", ns)), "mitigation_chars": sum(len(text(m)) for m in w.findall("c:Potential_Mitigations/c:Mitigation", ns)),
        "observed": [text(o.find("c:Reference", ns)) for o in w.findall("c:Observed_Examples/c:Observed_Example", ns)],
        "related": len(w.findall("c:Related_Weaknesses/c:Related_Weakness", ns)), "demos": len(w.findall("c:Demonstrative_Examples/c:Demonstrative_Example", ns)),
        "consequences": len(w.findall("c:Common_Consequences/c:Consequence", ns)), "capec": [r.get("CAPEC_ID") for r in w.findall("c:Related_Attack_Patterns/c:Related_Attack_Pattern", ns)]}
views = root.findall("c:Views/c:View", ns)
out["cwe_catalogue"] = {"file": z.namelist()[0], "version": root.get("Version"), "date": root.get("Date"), "weaknesses": len(weak),
    "views": len(views),
    "by_abstraction": dict(collections.Counter(v["abstraction"] for v in weak.values()).most_common()), "by_status": dict(collections.Counter(v["status"] for v in weak.values()).most_common()),
    "with_description": sum(1 for v in weak.values() if v["description"]), "description_characters": sum(len(v["description"]) for v in weak.values()),
    "with_extended_description": sum(1 for v in weak.values() if v["extended"]), "extended_description_characters": sum(len(v["extended"]) for v in weak.values()),
    "with_mitigations": sum(1 for v in weak.values() if v["mitigations"]), "mitigations": sum(v["mitigations"] for v in weak.values()), "mitigation_characters": sum(v["mitigation_chars"] for v in weak.values()),
    "with_observed_examples": sum(1 for v in weak.values() if v["observed"]), "observed_example_references": sum(len(v["observed"]) for v in weak.values()),
    "observed_example_references_that_are_cve_ids": sum(1 for v in weak.values() for o in v["observed"] if re.fullmatch(r"CVE-\d{4}-\d{4,}", o)),
    "with_demonstrative_examples": sum(1 for v in weak.values() if v["demos"]), "with_related_weaknesses": sum(1 for v in weak.values() if v["related"]),
    "with_common_consequences": sum(1 for v in weak.values() if v["consequences"]), "citing_a_capec_pattern": sum(1 for v in weak.values() if v["capec"])}
croot = ET.fromstring(s.get("capec_latest.xml", "https://capec.mitre.org/data/xml/capec_latest.xml"))
cns = {"a": croot.tag.split("}")[0].strip("{")}
aps = croot.find("a:Attack_Patterns", cns)
cited = [(ap.get("ID"), r.get("CWE_ID")) for ap in aps for r in ap.findall("a:Related_Weaknesses/a:Related_Weakness", cns)]
out["capec"] = {"version": croot.get("Version"), "date": croot.get("Date"), "attack_patterns": len(aps), "by_status": dict(collections.Counter(ap.get("Status") for ap in aps).most_common()),
    "patterns_citing_a_cwe": len({a for a, _ in cited}), "cwe_citations": len(cited), "citations_resolving_in_cwe_catalogue": sum(1 for _, c in cited if c in weak),
    "citations_to_a_deprecated_weakness": sum(1 for _, c in cited if c in weak and weak[c]["status"] == "Deprecated"),
    "cwe_to_capec_citations": sum(len(v["capec"]) for v in weak.values()), "cwe_to_capec_resolving": sum(1 for v in weak.values() for c in v["capec"] if c in {ap.get("ID") for ap in aps})}
nvd = json.loads(s.get("nvd_cves_2026-11-01_2026-11-21_page0.json",
    "https://services.nvd.nist.gov/rest/json/cves/2.0?pubStartDate=2026-11-01T00:00:00.000Z&pubEndDate=2026-11-21T00:00:00.000Z&resultsPerPage=2000&startIndex=0", timeout=300))
cves = [v["cve"] for v in nvd["vulnerabilities"]]
pairs, noinfo, none = [], 0, 0
for c in cves:
    vals = {d["value"] for w in c.get("weaknesses", []) for d in w.get("description", [])}
    if not vals:
        none += 1
    for v in vals:
        if re.fullmatch(r"CWE-\d+", v):
            pairs.append((c["id"], v[4:]))
        else:
            noinfo += 1
ids = sorted({p[1] for p in pairs}, key=int)
miss = [i for i in ids if i not in weak]
out["nvd_page"] = {"total_results_in_window": nvd["totalResults"], "records_read": len(cves), "window": "published 2026-11-01 to 2026-11-21", "by_status": dict(collections.Counter(c.get("vulnStatus") for c in cves).most_common()),
    "records_with_no_weakness": none, "non_cwe_placeholders": noinfo, "records_citing_a_cwe_id": len({p[0] for p in pairs}), "cve_to_cwe_citations": len(pairs)}
out["join_cwe_id"] = {"distinct_cwe_ids_cited": len(ids), "found_in_cwe_catalogue_as_weakness": len(ids) - len(miss), "not_found": miss,
    "citations_resolving": sum(1 for p in pairs if p[1] in weak), "citations": len(pairs),
    "citations_to_deprecated_weakness": sum(1 for p in pairs if p[1] in weak and weak[p[1]]["status"] == "Deprecated"),
    "citations_by_abstraction": dict(collections.Counter(weak[p[1]]["abstraction"] for p in pairs if p[1] in weak).most_common()),
    "most_cited": [(f"CWE-{i}", n, weak[i]["name"]) for i, n in collections.Counter(p[1] for p in pairs if p[1] in weak).most_common(8)]}
random.seed(20261128)
byid = {c["id"]: c for c in cves}
sample = []
for cve, cw in random.sample(sorted(set(p for p in pairs if p[1] in weak)), 20):
    desc = next((d["value"] for d in byid[cve]["descriptions"] if d["lang"] == "en"), "")
    sample.append({"cve": cve, "cwe": f"CWE-{cw}", "cwe_name": weak[cw]["name"], "cve_description_first_260_characters": desc[:260]})
out["handcheck_sample"] = sample
out["terms"] = {
    "cwe": check("terms_cwe.html", "https://cwe.mitre.org/about/termsofuse.html", [], ("royalty-free", "commercial", "license")),
    "capec": check("terms_capec.html", "https://capec.mitre.org/about/termsofuse.html", [], ("royalty-free", "commercial", "license")),
    "nvd": check("terms_nvd.html", "https://nvd.nist.gov/general/legal-disclaimer", [], ("public domain", "copyright", "attribution", "not subject to")),
}
s.write(__file__, out)
