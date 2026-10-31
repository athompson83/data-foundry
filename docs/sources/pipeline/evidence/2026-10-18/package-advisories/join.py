# OSV GHSA advisories -> NVD by declared CVE alias; counts from the OSV per-ecosystem archives.
import sys, io, zipfile, json, random, time, urllib.request
sys.path.insert(0, '..'); from common import *
random.seed(20261018)
out = {}
for eco in ["PyPI"]:
    b = get(f"https://osv-vulnerabilities.storage.googleapis.com/{eco}/all.zip", raw=True)
    if b:
        z = zipfile.ZipFile(io.BytesIO(b)); names = z.namelist()
        docs = [json.loads(z.read(n)) for n in names]
        ghsa = [d for d in docs if d["id"].startswith("GHSA-")]
        withcve = [d for d in ghsa if any(a.startswith("CVE-") for a in d.get("aliases", []))]
        out[eco] = {"files": len(names), "ghsa": len(ghsa), "ghsa_with_cve_alias": len(withcve),
                    "with_details_text": sum(1 for d in docs if len(d.get("details", "")) > 100),
                    "with_fixed_version": sum(1 for d in docs if any(e.get("fixed") for a in d.get("affected", []) for r in a.get("ranges", []) for e in r.get("events", []))),
                    "with_cwe": sum(1 for d in docs if d.get("database_specific", {}).get("cwe_ids"))}
        sample = random.sample(withcve, 25); res = []
        for d in sample:
            cve = [a for a in d["aliases"] if a.startswith("CVE-")][0]
            j = get(f"https://services.nvd.nist.gov/rest/json/cves/2.0?cveId={cve}")
            res.append({"ghsa": d["id"], "cve": cve, "nvd_found": bool(j and j.get("totalResults") == 1)}); time.sleep(6.5)
        out["nvd_join"] = {"checked": len(res), "resolved": sum(r["nvd_found"] for r in res), "rows": res}
    else:
        out[eco] = "not fetched"
json.dump(out, open("join.json", "w"), indent=1); print(json.dumps({k: v for k, v in out.items() if k != "nvd_join"}, indent=1), out["nvd_join"]["resolved"], "/", out["nvd_join"]["checked"])
