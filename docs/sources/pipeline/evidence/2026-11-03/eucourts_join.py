#!/usr/bin/env python3 -I
"""CJEU judgments (EUR-Lex/CELLAR) citing ECtHR judgments by CE:ECHR ECLI, resolved in HUDOC. Writes eucourts_join.json.
Sample: 150 CJEU (offset 400 in date order, newest records have no text yet) 'CJ' judgments with an ECLI in CELLAR. Declared identifier: ECLI:CE:ECHR:... printed as CE:ECHR:... in the judgment text."""
import json, re, subprocess, urllib.parse
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def curl(url, accept="*/*", lang=None, timeout=60):
    cmd = ["curl", "-sS", "-m", str(timeout), "-L", "-A", UA, "-H", f"Accept: {accept}"]
    if lang: cmd += ["-H", f"Accept-Language: {lang}"]
    return subprocess.run(cmd + [url], capture_output=True, text=True).stdout
sp = """PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>
SELECT DISTINCT ?c ?ecli ?d WHERE { ?w cdm:case-law_ecli ?ecli . ?w cdm:resource_legal_id_celex ?c . ?w cdm:work_date_document ?d .
FILTER(REGEX(?c, "^6[0-9]{4}CJ[0-9]{4}$")) } ORDER BY DESC(?d) OFFSET 400 LIMIT 150"""
rows = json.loads(curl("https://publications.europa.eu/webapi/rdf/sparql?query=" + urllib.parse.quote(sp) + "&format=application%2Fsparql-results%2Bjson", timeout=120))["results"]["bindings"]
rows = [{k: v["value"] for k, v in b.items()} for b in rows]
res, cited_all = [], set()
for r in rows:
    txt = curl("https://publications.europa.eu/resource/celex/" + r["c"], "application/xhtml+xml", "eng")
    plain = re.sub(r"<[^>]+>", " ", txt)
    eclis = sorted(set(re.findall(r"CE:ECHR:\d{4}:\d{4}JUD\d{8}", plain)))
    res.append({"celex": r["c"], "ecli": r["ecli"], "date": r["d"], "chars": len(plain), "echr_eclis": eclis})
    cited_all.update(eclis)
resolved = {}
for e in sorted(cited_all):
    full = "ECLI:" + e
    o = json.loads(curl("https://hudoc.echr.coe.int/app/query/results?query=" + urllib.parse.quote(f'contentsitename:ECHR AND ecli:"{full}"') + "&select=itemid,docname,ecli,kpdate&sort=kpdate%20Descending&start=0&length=1") or "{}")
    resolved[full] = o.get("resultcount", None)
with_text = [x for x in res if x["chars"] > 2000]
summary = {"sample": len(res), "with_text": len(with_text), "citing_echr_ecli": sum(bool(x["echr_eclis"]) for x in with_text),
  "distinct_cited_echr_eclis": len(cited_all), "resolved_in_hudoc": sum(1 for v in resolved.values() if v), "unresolved": [k for k, v in resolved.items() if not v][:10]}
json.dump({"summary": summary, "resolved": resolved, "rows": res}, open("eucourts_join.json", "w"), indent=1)
print(json.dumps(summary, indent=1))
