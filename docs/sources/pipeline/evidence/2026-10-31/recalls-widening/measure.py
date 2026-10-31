"""Health Canada food and health-product recall notices as members of FDA Recall Intelligence.
Measures: category counts in the open-data index, free text present, explicit FDA citations,
and a candidate link to openFDA enforcement by firm token + date window (proposal only)."""
import json, re, sys, urllib.request, urllib.parse, collections, datetime as dt
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def get(u):
    return urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=120).read()
idx = json.loads(get("https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json"))
cats = collections.Counter(r.get("Organization") for r in idx)
def has(r, f): return bool((r.get(f) or "").strip())
out = {"fetched": dt.datetime.utcnow().isoformat() + "Z", "total": len(idx), "organizations": dict(cats)}
keys = collections.Counter(k for r in idx for k in r)
out["fields"] = list(keys)
sel = [r for r in idx if r.get("Organization") in ("Food", "Drugs and health products", "Medical devices")]
out["selected"] = len(sel)
dates = [r.get("Last updated") for r in idx if r.get("Last updated")]
out["last_updated_max"] = max(dates) if dates else None
fda_re = re.compile(r"\b(FDA|U\.S\. Food and Drug|United States Food and Drug)\b")
usrec = re.compile(r"\b[FDZ]-\d{3,4}-\d{4}\b")
txt = lambda r: " ".join(str(v) for v in r.values() if isinstance(v, str))
out["cite_fda"] = sum(1 for r in sel if fda_re.search(txt(r)))
out["cite_fda_recall_number"] = sum(1 for r in sel if usrec.search(txt(r)))
out["free_text_fields"] = {f: sum(1 for r in sel if has(r, f)) for f in ("Issue", "What you should do", "Product", "Recall class", "Last updated")}
json.dump(out, open(sys.argv[1], "w"), indent=1)
print(json.dumps(out, indent=1)[:600])
