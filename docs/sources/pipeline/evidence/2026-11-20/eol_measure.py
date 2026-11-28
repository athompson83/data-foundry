#!/usr/bin/env python3
"""Round 29 (2026-11-20) screening of software-release-lifecycles (prefix eol).

Re-fetches live: endoflife.date API v1 (all products), Python release-cycle.json and
peps.json plus every release-schedule PEP page, Node.js Release schedule.json, Debian
distro-info-data (ubuntu.csv, debian.csv), Kubernetes release schedule/eol YAML, and the
licence files. Writes eol_measure.json next to itself. Stdlib only; one request at a time.
Person names (release managers, PEP authors) are never written.
"""
import json, time, urllib.request, urllib.error, collections, os, re, csv, io, random, hashlib, html

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
N = 0

def get(url, timeout=120):
    global N
    N += 1
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body, status = r.read(), r.status
    except urllib.error.HTTPError as e:
        body, status = e.read(), e.code
    time.sleep(0.6)
    return status, body

def text(url):
    s, b = get(url)
    return s, b.decode("utf-8", "replace")

out = {"run_date": "2026-11-20", "user_agent": UA}

# ---- endoflife.date -------------------------------------------------------
s, b = get("https://endoflife.date/api/v1/products/full")
eol = json.loads(b)
prods = {p["name"]: p for p in eol["result"]}
rels = [(p["name"], r) for p in eol["result"] for r in p["releases"]]
today = "2026-11-20"
latest_dates = sorted(r["latest"]["date"] for _, r in rels if r.get("latest") and r["latest"].get("date"))
out["endoflife"] = {
    "status": s, "bytes": len(b), "schema_version": eol["schema_version"], "generated_at": eol["generated_at"],
    "products": len(prods), "release_cycles": len(rels),
    "by_category": dict(collections.Counter(p["category"] for p in prods.values()).most_common()),
    "identifier_types": dict(collections.Counter(i["type"] for p in prods.values() for i in p["identifiers"]).most_common()),
    "products_with_purl": sum(1 for p in prods.values() if any(i["type"] == "purl" for i in p["identifiers"])),
    "products_with_cpe": sum(1 for p in prods.values() if any(i["type"] == "cpe" for i in p["identifiers"])),
    "cycles_with_eol_date": sum(1 for _, r in rels if r.get("eolFrom")),
    "cycles_with_eoas_date": sum(1 for _, r in rels if r.get("eoasFrom")),
    "cycles_with_release_date": sum(1 for _, r in rels if r.get("releaseDate")),
    "cycles_lts": sum(1 for _, r in rels if r.get("isLts")),
    "cycles_maintained": sum(1 for _, r in rels if r.get("isMaintained")),
    "cycles_with_latest": sum(1 for _, r in rels if r.get("latest")),
    "newest_latest_release_date": latest_dates[-1],
    "latest_patch_in_last_30_days": sum(1 for d in latest_dates if "2026-10-21" <= d <= today),
    "cycles_released_2026": sum(1 for _, r in rels if (r.get("releaseDate") or "").startswith("2026")),
    "products_with_release_policy_link": sum(1 for p in prods.values() if p["links"].get("releasePolicy")),
}
s, b = text("https://endoflife.date/robots.txt"); out["endoflife"]["robots"] = b.strip()
s, lic = text("https://raw.githubusercontent.com/endoflife-date/endoflife.date/master/LICENSE")
out["endoflife"]["licence"] = {"status": s, "sha256": hashlib.sha256(lic.encode()).hexdigest(), "first_line": lic.splitlines()[0], "is_mit_grant": "Permission is hereby granted, free of charge" in lic}

def ecycles(name):
    return {r["name"]: r for r in prods[name]["releases"]}

# ---- Python release-cycle.json + PEPs --------------------------------------
s, b = get("https://peps.python.org/api/release-cycle.json")
pyrc = json.loads(b)
out["python_release_cycle"] = {"status": s, "bytes": len(b), "branches": len(pyrc), "by_status": dict(collections.Counter(v["status"] for v in pyrc.values())),
                               "with_pep": sum(1 for v in pyrc.values() if v.get("pep")), "newest_first_release": max(v["first_release"] for v in pyrc.values()),
                               "oldest_first_release": min(v["first_release"] for v in pyrc.values()), "fields": sorted({k for v in pyrc.values() for k in v} - {"release_manager"}),
                               "note": "the release_manager field (a person's name) is present in the source and is not written"}
s, b = get("https://peps.python.org/api/peps.json")
peps = json.loads(b)
rel_peps = {int(k): v for k, v in peps.items() if v.get("topic") == "release"}
out["python_peps"] = {"status": s, "bytes": len(b), "peps": len(peps), "release_topic_peps": len(rel_peps),
                      "release_peps_with_python_version": sum(1 for v in rel_peps.values() if v.get("python_version"))}
# fetch every release-topic PEP page (free text)
lens, cc0, eolphrase, dated = [], 0, 0, 0
pep_text = {}
for n in sorted(rel_peps):
    s, h = text(f"https://peps.python.org/pep-{n:04d}/")
    if s != 200: continue
    m = re.search(r"<section id=\"pep-content\">(.*?)</section>\s*<footer|<article[^>]*>(.*)</article>", h, re.S)
    body = re.sub(r"<[^>]+>", " ", html.unescape(h.split('<section id="pep-content">')[-1].split("<footer")[0]))
    body = re.sub(r"\s+", " ", body)
    pep_text[n] = body
    lens.append(len(body))
    if "public domain" in body or "CC0-1.0" in body: cc0 += 1
    if re.search(r"\d{4}-\d{2}-\d{2}", body): dated += 1
    if re.search(r"end[- ]of[- ]life|security (?:updates|fixes|patches)|final (?:regular )?bugfix|no further|retired", body, re.I): eolphrase += 1
lens.sort()
out["python_peps"].update({"release_pep_pages_fetched": len(lens), "chars_total": sum(lens), "chars_median": lens[len(lens)//2] if lens else None, "chars_min": lens[0] if lens else None,
                           "chars_max": lens[-1] if lens else None, "pages_with_public_domain_or_cc0_notice": cc0, "pages_with_an_iso_date": dated, "pages_with_end_of_support_wording": eolphrase})

# join 1 (declared): PEP number cited by endoflife.date python cycle == PEP number in release-cycle.json for the same branch
epy = ecycles("python")
cited = {c: int(r["custom"]["pep"].split("-")[1]) for c, r in epy.items() if (r.get("custom") or {}).get("pep")}
j1 = {"endoflife_python_cycles": len(epy), "cycles_citing_a_pep": len(cited)}
j1["cited_pep_in_peps_json"] = sum(1 for p in cited.values() if str(p) in peps)
j1["cited_pep_is_release_topic"] = sum(1 for p in cited.values() if p in rel_peps)
j1["cited_pep_python_version_equals_cycle"] = sum(1 for c, p in cited.items() if c in [x.strip() for x in str((peps.get(str(p)) or {}).get("python_version") or "").split(",")])
both = [c for c in cited if c in pyrc]
j1["cycles_also_in_release_cycle_json"] = len(both)
j1["same_pep_number_as_release_cycle_json"] = sum(1 for c in both if pyrc[c].get("pep") == cited[c])
j1["release_cycle_branches_not_on_endoflife"] = sorted(set(pyrc) - set(epy))
j1["endoflife_cycles_not_in_release_cycle_json"] = sorted(set(epy) - set(pyrc))
# agreement of dates where both exist
def month(d): return (d or "")[:7]
j1["first_release_date_equal"] = sum(1 for c in both if pyrc[c]["first_release"] == epy[c].get("releaseDate"))
j1["end_of_life_month_equal"] = sum(1 for c in both if month(pyrc[c]["end_of_life"]) == month(epy[c].get("eolFrom")))
j1["pairs"] = [{"cycle": c, "endoflife_pep": cited[c], "release_cycle_pep": pyrc[c].get("pep"), "first_release_python": pyrc[c]["first_release"], "release_date_endoflife": epy[c].get("releaseDate"),
                "eol_python": pyrc[c]["end_of_life"], "eol_endoflife": epy[c].get("eolFrom")} for c in sorted(both, key=lambda x: [int(y) for y in x.split(".")])]
# cited PEP page mentions the branch in its text
j1["cited_pep_page_names_the_cycle"] = sum(1 for c, p in cited.items() if p in pep_text and f"Python {c}" in pep_text[p])
out["join_pep_number"] = j1

# ---- Node.js ---------------------------------------------------------------
s, b = get("https://raw.githubusercontent.com/nodejs/Release/main/schedule.json")
node = json.loads(b)
out["nodejs_schedule"] = {"status": s, "bytes": len(b), "lines": len(node), "with_lts": sum(1 for v in node.values() if v.get("lts")), "with_codename": sum(1 for v in node.values() if v.get("codename")),
                          "newest_start": max(v["start"] for v in node.values()), "end_after_today": sum(1 for v in node.values() if v["end"] > today), "fields": sorted({k for v in node.values() for k in v})}
lic_probe = {}
for path in ("LICENSE", "LICENSE.md", "package.json"):
    s, t = text(f"https://raw.githubusercontent.com/nodejs/Release/main/{path}")
    lic_probe[path] = {"status": s, "license_field": (json.loads(t).get("license") if s == 200 and path == "package.json" else None)}
s, readme = text("https://raw.githubusercontent.com/nodejs/Release/main/README.md")
lic_probe["README.md"] = {"status": s, "chars": len(readme), "mentions_licence": bool(re.search(r"\blicen[cs]e\b", readme, re.I))}
out["nodejs_schedule"]["licence_probe"] = lic_probe

# ---- Debian distro-info-data ----------------------------------------------
dist = {}
for name in ("ubuntu", "debian"):
    s, t = text(f"https://salsa.debian.org/debian/distro-info-data/-/raw/main/{name}.csv")
    rows = list(csv.DictReader(io.StringIO(t)))
    dist[name] = rows
    out[f"distro_info_{name}"] = {"status": s, "bytes": len(t), "rows": len(rows), "columns": list(rows[0].keys()), "newest_release": max(r["release"] for r in rows if r.get("release")),
                                  "with_eol": sum(1 for r in rows if r.get("eol")), "eol_after_today": sum(1 for r in rows if (r.get("eol") or "") > today)}
s, t = text("https://salsa.debian.org/debian/distro-info-data/-/raw/main/debian/copyright")
out["distro_info_licence"] = {"status": s, "license_line": next((l for l in t.splitlines() if l.startswith("License:")), None)}
s, t = text("https://salsa.debian.org/debian/distro-info-data/-/raw/main/debian/changelog")
m = re.search(r"^distro-info-data \(([^)]+)\).*?\n -- .*?  (.+?)$", t, re.S | re.M)
out["distro_info_changelog"] = {"status": s, "newest_version": m.group(1) if m else None, "newest_entry_date": m.group(2) if m else None,
                                "entries_2026": len(re.findall(r"^ -- .*, \d+ \w+ 2026 ", t, re.M)), "entries_total": len(re.findall(r"^ -- ", t, re.M))}

# ---- Kubernetes -------------------------------------------------------------
s, ks = text("https://raw.githubusercontent.com/kubernetes/website/main/data/releases/schedule.yaml")
k8s = {}
for blk in re.split(r"\n- (?=endOfLifeDate)", ks.split("schedules:")[1]):
    rel = re.search(r"\n  release: \"?([\d.]+)\"?", blk); e = re.search(r"endOfLifeDate: \"?([\d-]+)", blk); rd = re.search(r"\n  releaseDate: \"?([\d-]+)", blk)
    if rel: k8s[rel.group(1)] = {"eol": e.group(1) if e else None, "release": rd.group(1) if rd else None}
s2, ke = text("https://raw.githubusercontent.com/kubernetes/website/main/data/releases/eol.yaml")
for m in re.finditer(r"- endOfLifeDate: \"?([\d-]+)\"?\n(?:  .*\n)*?  release: \"?([\d.]+)", ke):
    k8s.setdefault(m.group(2), {"eol": m.group(1), "release": None})
out["kubernetes_schedule"] = {"status_schedule": s, "status_eol": s2, "bytes": len(ks) + len(ke), "minor_releases": len(k8s), "with_release_date": sum(1 for v in k8s.values() if v["release"]),
                              "eol_after_today": sum(1 for v in k8s.values() if (v["eol"] or "") > today), "newest_release_date": max((v["release"] or "") for v in k8s.values())}
s, t = text("https://raw.githubusercontent.com/kubernetes/website/main/LICENSE")
out["kubernetes_schedule"]["licence_first_line"] = t.splitlines()[0].strip()

# ---- join 2 (candidate): product + release cycle version string ------------
def close(a, b, days=0):
    return bool(a) and bool(b) and a == b
pairs = []
def add(product, cycle, pub, pub_key, e, up_release, up_eol):
    pairs.append({"product": product, "endoflife_cycle": cycle, "publisher": pub, "publisher_key": pub_key, "endoflife_release": e.get("releaseDate"), "publisher_release": up_release,
                  "endoflife_eol": e.get("eolFrom"), "publisher_eol": up_eol, "release_equal": e.get("releaseDate") == up_release,
                  "eol_month_equal": bool(up_eol) and month(e.get("eolFrom")) == month(up_eol), "eol_day_equal": bool(up_eol) and e.get("eolFrom") == up_eol})
tot = {}
for c, v in pyrc.items():
    tot["python"] = len(pyrc)
    if c in epy: add("python", c, "Python release-cycle.json", c, epy[c], v["first_release"], v["end_of_life"])
en = ecycles("nodejs"); tot["nodejs"] = len(node)
for k, v in node.items():
    c = k.lstrip("v")
    if c in en: add("nodejs", c, "Node.js schedule.json", k, en[c], v["start"], v["end"])
eu = ecycles("ubuntu"); tot["ubuntu"] = len(dist["ubuntu"])
for r in dist["ubuntu"]:
    c = r["version"].replace(" LTS", "")
    if c in eu: add("ubuntu", c, "distro-info-data ubuntu.csv", r["version"], eu[c], r["release"], r.get("eol-server") or r["eol"])
ed = ecycles("debian"); tot["debian"] = len(dist["debian"])
for r in dist["debian"]:
    c = r["version"].split(".")[0] if r["version"] and float(r["version"] or 0) >= 7 else r["version"]
    if c and c in ed: add("debian", c, "distro-info-data debian.csv", r["version"], ed[c], r.get("release"), r.get("eol"))
ek = ecycles("kubernetes"); tot["kubernetes"] = len(k8s)
for c, v in k8s.items():
    if c in ek: add("kubernetes", c, "Kubernetes schedule.yaml / eol.yaml", c, ek[c], v["release"], v["eol"])
j2 = {}
for prod in tot:
    ps = [p for p in pairs if p["product"] == prod]
    j2[prod] = {"publisher_cycles": tot[prod], "endoflife_cycles": len(ecycles(prod)), "matched_on_version_string": len(ps),
                "release_date_equal": sum(p["release_equal"] for p in ps), "both_have_release_date": sum(1 for p in ps if p["endoflife_release"] and p["publisher_release"]),
                "eol_month_equal": sum(p["eol_month_equal"] for p in ps), "eol_day_equal": sum(p["eol_day_equal"] for p in ps), "both_have_eol": sum(1 for p in ps if p["endoflife_eol"] and p["publisher_eol"])}
j2["total"] = {"publisher_cycles": sum(tot.values()), "matched_on_version_string": len(pairs), "release_date_equal": sum(p["release_equal"] for p in pairs),
               "eol_month_equal": sum(p["eol_month_equal"] for p in pairs), "both_have_eol": sum(1 for p in pairs if p["endoflife_eol"] and p["publisher_eol"])}
random.seed(20261120)
j2["handcheck_sample_seed"] = 20261120
j2["handcheck_sample"] = random.sample(sorted(pairs, key=lambda p: (p["product"], p["endoflife_cycle"])), 20)
j2["disagreements"] = [p for p in pairs if (p["endoflife_release"] and p["publisher_release"] and not p["release_equal"])][:40]
out["join_cycle_version_string"] = j2
out["requests"] = N
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "eol_measure.json"), "w"), indent=1, sort_keys=True)
print(json.dumps({k: v for k, v in out.items() if k != "join_cycle_version_string"}, indent=1)[:5000])
print(json.dumps({k: v for k, v in j2.items() if k not in ("handcheck_sample", "disagreements")}, indent=1))
