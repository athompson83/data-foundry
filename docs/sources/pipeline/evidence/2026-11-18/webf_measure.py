#!/usr/bin/env python3
"""Screening 2026-11-18: web-platform-features (one record per web platform feature). Fetches every source live (stdlib only).
Run from this directory with: python3 -I webf_measure.py   -> writes webf_measure.json (hand-check pairs included; verdicts in webf_handcheck.json)
Output holds feature ids, feature titles, compat keys, specification URLs, version strings, dates and counts only (no personal data:
Chrome Platform Status e-mail fields are counted, never written).

Members:
  web-features (W3C WebDX Community Group): data.json from the npm package via unpkg.com; release times from registry.npmjs.org.
  MDN browser-compat-data (BCD): data.json from the GitHub release asset; one key re-read from bcd.developer.mozilla.org.
  caniuse: fulldata-json/data-2.0.json (raw.githubusercontent.com) and caniuse.com/data.json.
  W3C browser-specs: index.json from w3c.github.io.
  MDN Web Docs content (prose): developer.mozilla.org <page>/index.json for a seeded sample of pages + the en-US sitemap.
  Chrome Platform Status: chromestatus.com/api/v0/features (paged; response starts with an anti-XSSI line that is stripped).
  webstatus.dev API: reachability and total only (a view over web-features, not an independent member).
Joins (all declared, except the last):
  BCD compat key listed in a web-features `compat_features` array = a `__compat` node in BCD (and the BCD tag `web-features:<id>` back).
  caniuse feature id listed in a web-features `caniuse` array = a key of caniuse `data`.
  specification URL listed by web-features (and by caniuse / BCD) = a specification in browser-specs (fragment dropped).
  BCD compat key in an MDN page's `browserCompat` and the page's Baseline feature id = the web-features feature (sampled pages).
  web-features feature id in a Chrome Platform Status entry's `web_feature` field = a web-features feature.
  candidate: normalised caniuse title = normalised web-features name (pairs written for hand-check).
Set WEBF_CACHE=<dir outside the repo> to reuse downloaded bodies while developing; the committed JSON comes from a run without it.
"""
import json, re, time, gzip, os, random, hashlib, html as H, collections, urllib.request, urllib.error

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
CACHE = os.environ.get("WEBF_CACHE")
out = {"run_date": time.strftime("%Y-%m-%d"), "cache_used": bool(CACHE)}
NREQ = [0]
STATUS = {}


def get(u, timeout=240, tries=3):
    cp = os.path.join(CACHE, hashlib.sha1(u.encode()).hexdigest()) if CACHE else None
    if cp and os.path.exists(cp):
        return 200, open(cp, "rb").read()
    for i in range(tries):
        NREQ[0] += 1
        try:
            rq = urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(rq, timeout=timeout) as f:
                b = f.read()
                if f.headers.get("Content-Encoding") == "gzip" or b[:2] == b"\x1f\x8b":
                    b = gzip.decompress(b)
                STATUS[u] = f.status
                if cp:
                    open(cp, "wb").write(b)
                return f.status, b
        except urllib.error.HTTPError as e:
            STATUS[u] = e.code
            if e.code in (429, 500, 502, 503, 504) and i < tries - 1:
                time.sleep(15 * (i + 1))
                continue
            return e.code, e.read()
        except Exception as e:
            STATUS[u] = 0
            if i == tries - 1:
                return 0, str(e).encode()
            time.sleep(10)


def ws(s):
    return re.sub(r"\s+", " ", s)


def quote_ok(body, q):
    return ws(q) in ws(body.decode("utf8", "replace"))


def strip_tags(s):
    return ws(H.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def npm_times(pkg):
    s, b = get("https://registry.npmjs.org/" + pkg)
    if s != 200:
        return {"status": s}
    d = json.loads(b)
    rel = sorted(((t, v) for v, t in d["time"].items() if re.fullmatch(r"\d+\.\d+\.\d+", v)), reverse=True)
    last365 = [t for t, v in rel if t >= time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(time.time() - 365 * 86400))]
    return {"status": s, "latest": d["dist-tags"].get("latest"), "license": d.get("license"), "stable_releases": len(rel),
            "newest_stable": [{"version": v, "published": t[:10]} for t, v in rel[:5]], "stable_releases_last_365_days": len(last365)}


# ---------------------------------------------------------------- web-features
WF_URL = "https://unpkg.com/web-features/data.json"
s, b = get(WF_URL)
wfd = json.loads(b)
wf_all = wfd["features"]
wf = {k: v for k, v in wf_all.items() if v.get("kind", "feature") == "feature"}
kinds = collections.Counter(v.get("kind", "feature") for v in wf_all.values())
base = collections.Counter(str(v["status"]["baseline"]) for v in wf.values())
low_dates = sorted(v["status"].get("baseline_low_date", "").lstrip("≤") for v in wf.values() if v["status"].get("baseline_low_date"))
s_l, b_l = get("https://unpkg.com/web-features/LICENSE.txt")
WF_QUOTE = "each Contributor hereby grants to You a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare Derivative Works of, publicly display, publicly perform, sublicense, and distribute the Work and such Derivative Works in Source or Object form."
out["web_features"] = {
    "url": WF_URL, "status": s, "bytes": len(b), "top_level_keys": sorted(wfd), "entries": len(wf_all), "kinds": dict(kinds),
    "features": len(wf), "groups": len(wfd.get("groups", {})), "snapshots": len(wfd.get("snapshots", {})), "browsers": sorted(wfd.get("browsers", {})),
    "baseline_status": dict(base), "newest_baseline_low_date": low_dates[-1] if low_dates else None,
    "with_description": sum(1 for v in wf.values() if v.get("description")), "with_spec": sum(1 for v in wf.values() if v.get("spec")),
    "with_compat_features": sum(1 for v in wf.values() if v.get("compat_features")), "with_caniuse": sum(1 for v in wf.values() if v.get("caniuse")),
    "with_group": sum(1 for v in wf.values() if v.get("group")),
    "sample": {k: {"name": wf[k]["name"], "baseline": wf[k]["status"]["baseline"], "baseline_low_date": wf[k]["status"].get("baseline_low_date"),
                   "support": wf[k]["status"].get("support"), "spec": wf[k].get("spec"), "caniuse": wf[k].get("caniuse"),
                   "compat_features": len(wf[k].get("compat_features", []))} for k in ("grid", "has", "view-transitions") if k in wf},
    "npm": npm_times("web-features"),
    "licence": {"url": "https://unpkg.com/web-features/LICENSE.txt", "status": s_l, "quote": WF_QUOTE, "quote_found": quote_ok(b_l, WF_QUOTE)},
}

# ---------------------------------------------------------------- BCD
BCD_URL = "https://github.com/mdn/browser-compat-data/releases/latest/download/data.json"
s, b = get(BCD_URL)
bcd = json.loads(b)
compat = {}


def walk(node, path):
    for k, v in node.items():
        if k == "__compat":
            compat[".".join(path)] = v
        elif isinstance(v, dict):
            walk(v, path + [k])


for top in bcd:
    if top not in ("__meta", "browsers"):
        walk(bcd[top], [top])
tagged = {k: [t.split(":", 1)[1] for t in v.get("tags", []) if t.startswith("web-features:")] for k, v in compat.items()}
snapshot_tags = sum(1 for v in tagged.values() for t in v if t.startswith("snapshot:"))  # e.g. web-features:snapshot:ecmascript-2019 (an edition, not a feature)
tagged = {k: [t for t in v if not t.startswith("snapshot:")] for k, v in tagged.items()}
tagged = {k: v for k, v in tagged.items() if v}
s_l, b_l = get("https://raw.githubusercontent.com/mdn/browser-compat-data/main/LICENSE")
BCD_QUOTE = "Affirmer hereby overtly, fully, permanently, irrevocably and unconditionally waives, abandons, and surrenders all of Affirmer's Copyright and Related Rights and associated claims and causes of action"
s_a, b_a = get("https://bcd.developer.mozilla.org/bcd/api/v0/current/css.properties.grid.json")
api_doc = json.loads(b_a) if s_a == 200 else {}
out["bcd"] = {
    "url": BCD_URL, "status": s, "bytes": len(b), "meta": bcd.get("__meta"), "compat_keys": len(compat),
    "by_top_level": dict(collections.Counter(k.split(".")[0] for k in compat)), "browsers": len(bcd.get("browsers", {})),
    "with_mdn_url": sum(1 for v in compat.values() if v.get("mdn_url")), "with_spec_url": sum(1 for v in compat.values() if v.get("spec_url")),
    "with_web_features_tag": len(tagged), "web_features_snapshot_tags": snapshot_tags,
    "status_flags": {f: sum(1 for v in compat.values() if v.get("status", {}).get(f)) for f in ("deprecated", "experimental", "standard_track")},
    "mdn_bcd_api": {"url": "https://bcd.developer.mozilla.org/bcd/api/v0/current/css.properties.grid.json", "status": s_a, "meta": api_doc.get("__meta"),
                    "same_support_as_release_asset": api_doc.get("data", {}).get("__compat", {}).get("support") == compat["css.properties.grid"]["support"] if api_doc else None},
    "npm": npm_times("@mdn/browser-compat-data"),
    "licence": {"url": "https://raw.githubusercontent.com/mdn/browser-compat-data/main/LICENSE", "status": s_l, "quote": BCD_QUOTE, "quote_found": quote_ok(b_l, BCD_QUOTE)},
}

# ---------------------------------------------------------------- caniuse
CIU_URL = "https://raw.githubusercontent.com/Fyrd/caniuse/main/fulldata-json/data-2.0.json"
s, b = get(CIU_URL)
ciud = json.loads(b)
ciu = ciud["data"]
s2, b2 = get("https://caniuse.com/data.json")
try:
    site = json.loads(b2)
    site_info = {"status": s2, "features": len(site.get("data", {})), "updated": time.strftime("%Y-%m-%d", time.gmtime(site["updated"])),
                 "same_ids_as_repo": sorted(site.get("data", {})) == sorted(ciu)}
except Exception:
    site_info = {"status": s2}
s_l, b_l = get("https://raw.githubusercontent.com/Fyrd/caniuse/main/README.md")
CIU_QUOTE = "The data in this repo is available for use under a CC BY 4.0 license (https://creativecommons.org/licenses/by/4.0/). For attribution just mention somewhere that the source is caniuse.com."
s_l2, b_l2 = get("https://raw.githubusercontent.com/Fyrd/caniuse/main/LICENSE")
out["caniuse"] = {
    "url": CIU_URL, "status": s, "bytes": len(b), "features": len(ciu), "agents": len(ciud["agents"]),
    "updated": time.strftime("%Y-%m-%d", time.gmtime(ciud["updated"])), "spec_status": dict(collections.Counter(v.get("status") for v in ciu.values())),
    "with_spec": sum(1 for v in ciu.values() if v.get("spec")), "with_description": sum(1 for v in ciu.values() if v.get("description")),
    "with_notes": sum(1 for v in ciu.values() if v.get("notes")), "with_numbered_notes": sum(1 for v in ciu.values() if v.get("notes_by_num")),
    "caniuse_com_data_json": site_info,
    "licence": {"url": "https://raw.githubusercontent.com/Fyrd/caniuse/main/README.md", "status": s_l, "quote": CIU_QUOTE, "quote_found": quote_ok(b_l, CIU_QUOTE),
                "licence_file_url": "https://raw.githubusercontent.com/Fyrd/caniuse/main/LICENSE", "licence_file_status": s_l2,
                "licence_file_is_cc_by_4": quote_ok(b_l2, "Attribution 4.0 International")},
}

# ---------------------------------------------------------------- browser-specs
BS_URL = "https://w3c.github.io/browser-specs/index.json"
s, b = get(BS_URL)
specs = json.loads(b)


def nu(u):
    u = (u or "").split("#")[0].strip()
    u = re.sub(r"^http://", "https://", u)
    u = re.sub(r"/(index|Overview)\.html$", "/", u)
    return u.rstrip("/").lower()


spec_urls = {}
for sp in specs:
    cands = [sp.get("url"), sp.get("nightly", {}).get("url"), sp.get("release", {}).get("url"), sp.get("series", {}).get("nightlyUrl"), sp.get("series", {}).get("releaseUrl")]
    cands += sp.get("nightly", {}).get("alternateUrls", []) + sp.get("nightly", {}).get("pages", []) + sp.get("release", {}).get("pages", [])
    for c in cands:
        if c:
            spec_urls.setdefault(nu(c), sp["shortname"])
spec_prefixes = sorted(spec_urls, key=len, reverse=True)


def spec_resolve(u):
    n = nu(u)
    if n in spec_urls:
        return spec_urls[n]
    for p in spec_prefixes:
        if n.startswith(p + "/"):
            return spec_urls[p]
    return None


s_l, b_l = get("https://raw.githubusercontent.com/w3c/browser-specs/main/LICENSE.md")
BS_QUOTE = "Additionally, the list of technical Web specifications (the [index.json](index.json) file) is published under the terms of the [CC0 license](#cc0-license)."
out["browser_specs"] = {
    "url": BS_URL, "status": s, "bytes": len(b), "specifications": len(specs), "series": len({sp["series"]["shortname"] for sp in specs}),
    "organizations": dict(collections.Counter(sp.get("organization") for sp in specs).most_common(8)),
    "standing": dict(collections.Counter(sp.get("standing") for sp in specs)), "with_release": sum(1 for sp in specs if sp.get("release")),
    "with_tests": sum(1 for sp in specs if sp.get("tests")), "known_urls": len(spec_urls),
    "npm": npm_times("browser-specs"),
    "licence": {"url": "https://raw.githubusercontent.com/w3c/browser-specs/main/LICENSE.md", "status": s_l, "quote": BS_QUOTE, "quote_found": quote_ok(b_l, BS_QUOTE)},
}

# ---------------------------------------------------------------- joins: web-features -> BCD, caniuse, browser-specs
J = {}
decl = [(fid, k) for fid, v in wf.items() for k in v.get("compat_features", [])]
dk = sorted({k for _, k in decl})
miss = [k for k in dk if k not in compat]
feat_all = sum(1 for v in wf.values() if v.get("compat_features") and all(k in compat for k in v["compat_features"]))
tag_pairs = [(k, t) for k, ts in tagged.items() for t in ts]
tag_ok = [(k, t) for k, t in tag_pairs if t in wf]
tag_agree = sum(1 for k, t in tag_ok if k in wf[t].get("compat_features", []))
J["bcd_compat_key"] = {
    "declared_pairs": len(decl), "distinct_keys_declared": len(dk), "resolved_in_bcd": len(dk) - len(miss), "unresolved_sample": miss[:15],
    "features_with_keys": sum(1 for v in wf.values() if v.get("compat_features")), "features_with_every_key_resolved": feat_all,
    "bcd_keys_total": len(compat), "bcd_keys_claimed_by_a_feature": len(set(dk) & set(compat)),
    "reverse_bcd_tag": {"tagged_keys": len(tagged), "tag_pairs": len(tag_pairs), "tag_resolves_to_feature": len(tag_ok),
                        "unresolved_tag_ids": sorted({t for k, t in tag_pairs if t not in wf})[:15],
                        "unresolved_tags_that_are_moved_or_split_entries": sum(1 for k, t in tag_pairs if t not in wf and t in wf_all),
                        "feature_lists_the_same_key": tag_agree},
    "web_features_version": out["web_features"]["npm"].get("latest"), "bcd_version": bcd["__meta"]["version"],
}
cd = [(fid, c) for fid, v in wf.items() for c in v.get("caniuse", [])]
cids = sorted({c for _, c in cd})
cmiss = [c for c in cids if c not in ciu]
J["caniuse_feature_id"] = {
    "declared_pairs": len(cd), "distinct_ids_declared": len(cids), "resolved_in_caniuse": len(cids) - len(cmiss), "unresolved": cmiss[:15],
    "features_with_caniuse": sum(1 for v in wf.values() if v.get("caniuse")), "caniuse_features_total": len(ciu),
    "caniuse_features_claimed": len(set(cids) & set(ciu)), "caniuse_ids_claimed_by_more_than_one_feature": sum(1 for c, n in collections.Counter(c for _, c in cd).items() if n > 1),
}


def spec_join(urls):
    urls = sorted({nu(u) for u in urls if u})
    res = {u: spec_resolve(u) for u in urls}
    un = [u for u in urls if not res[u]]
    return {"distinct_urls": len(urls), "resolved": len(urls) - len(un), "distinct_specs_hit": len({v for v in res.values() if v}),
            "unresolved_hosts": dict(collections.Counter(re.sub(r"^https://([^/]+).*", r"\1", u) for u in un).most_common(8)), "unresolved_sample": un[:10]}


wfspec = [u for v in wf.values() for u in (v.get("spec") or [])]
J["specification_url"] = {
    "web_features": dict(spec_join(wfspec), features_with_spec=sum(1 for v in wf.values() if v.get("spec")),
                         features_with_every_spec_resolved=sum(1 for v in wf.values() if v.get("spec") and all(spec_resolve(u) for u in v["spec"]))),
    "caniuse": dict(spec_join([v.get("spec") for v in ciu.values()]), features_with_spec=sum(1 for v in ciu.values() if v.get("spec")),
                    features_resolved=sum(1 for v in ciu.values() if v.get("spec") and spec_resolve(v["spec"]))),
    "bcd": spec_join([u for v in compat.values() for u in ([v["spec_url"]] if isinstance(v.get("spec_url"), str) else v.get("spec_url") or [])]),
}

# ---------------------------------------------------------------- MDN content (free text): sampled pages + sitemap
s, b = get("https://developer.mozilla.org/sitemaps/en-us/sitemap.xml.gz")
locs = re.findall(r"<loc>([^<]+)</loc>", b.decode("utf8", "replace")) if s == 200 else []
lastmods = sorted(re.findall(r"<lastmod>([^<]+)</lastmod>", b.decode("utf8", "replace"))) if s == 200 else []
key_feature = {}
for fid, k in decl:
    key_feature.setdefault(k, []).append(fid)
pool = sorted(k for k in dk if k in compat and compat[k].get("mdn_url"))
rng = random.Random(20261118)
sample = rng.sample(pool, 40)
pages = []
for k in sample:
    u = compat[k]["mdn_url"].rstrip("/") + "/index.json"
    s, b = get(u)
    row = {"bcd_key": k, "web_features_ids": key_feature[k], "url": u, "status": s}
    if s == 200:
        try:
            d = json.loads(b)["doc"]
            prose = " ".join(strip_tags(x["value"].get("content")) for x in d.get("body", []) if x.get("type") == "prose")
            bf = ((d.get("baseline") or {}).get("feature") or {}).get("id")
            row.update({"mdn_url": d.get("mdn_url"), "page": d.get("title"), "modified": (d.get("modified") or "")[:10], "browserCompat": d.get("browserCompat"),
                        "key_in_browserCompat": k in (d.get("browserCompat") or []), "baseline_feature_id": bf,
                        "baseline_feature_id_is_declaring_feature": bf in key_feature[k], "baseline_feature_id_in_web_features": bf in wf_all if bf else False,
                        "prose_chars": len(prose), "summary": (d.get("summary") or "")[:160], "has_specifications_section": any(x.get("type") == "specifications" for x in d.get("body", []))})
        except Exception as e:
            row["parse_error"] = str(e)[:80]
    pages.append(row)
    time.sleep(0.5)
ok = [p for p in pages if p.get("status") == 200 and "page" in p]
s_l, b_l = get("https://raw.githubusercontent.com/mdn/content/main/LICENSE.md")
MDN_QUOTE = "All prose content is available under ([CC-BY-SA 2.5](https://creativecommons.org/licenses/by-sa/2.5/))."
s_l2, b_l2 = get("https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license/index.json")
MDN_QUOTE2 = "Unless otherwise indicated, the content is available under the terms of the Creative Commons Attribution-ShareAlike license (CC-BY-SA), v2.5 or any later version."
lic2 = ""
if s_l2 == 200:
    lic2 = " ".join(strip_tags(x["value"].get("content")) for x in json.loads(b_l2)["doc"]["body"] if x.get("type") == "prose")
out["mdn_content"] = {
    "sitemap": {"url": "https://developer.mozilla.org/sitemaps/en-us/sitemap.xml.gz", "urls": len(locs), "under_docs_web": sum(1 for u in locs if "/en-US/docs/Web/" in u),
                "newest_lastmod": lastmods[-1][:10] if lastmods else None},
    "bcd_keys_declared_by_web_features_with_mdn_url": len(pool), "sampled_pages": len(pages), "pages_200": len(ok),
    "newest_modified_in_sample": max((p["modified"] for p in ok), default=None), "median_prose_chars": sorted(p["prose_chars"] for p in ok)[len(ok) // 2] if ok else None,
    "min_prose_chars": min((p["prose_chars"] for p in ok), default=None), "pages": pages,
    "licence": {"url": "https://raw.githubusercontent.com/mdn/content/main/LICENSE.md", "status": s_l, "quote": MDN_QUOTE, "quote_found": quote_ok(b_l, MDN_QUOTE),
                "site_url": "https://developer.mozilla.org/en-US/docs/MDN/Writing_guidelines/Attrib_copyright_license", "site_status": s_l2, "site_quote": MDN_QUOTE2,
                "site_quote_found": ws(MDN_QUOTE2) in ws(lic2)},
}
J["mdn_page"] = {
    "sampled": len(pages), "page_fetched": len(ok), "page_browserCompat_contains_the_key": sum(1 for p in ok if p["key_in_browserCompat"]),
    "page_carries_a_baseline_feature_id": sum(1 for p in ok if p["baseline_feature_id"]),
    "baseline_feature_id_resolves_in_web_features": sum(1 for p in ok if p["baseline_feature_id_in_web_features"]),
    "baseline_feature_id_is_the_declaring_feature": sum(1 for p in ok if p["baseline_feature_id_is_declaring_feature"]),
}

# ---------------------------------------------------------------- Chrome Platform Status
cs = {"url": "https://chromestatus.com/api/v0/features?num=100&start=N", "pages": [], "features": 0}
EMAIL_FIELDS = ("creator_email", "updater_email", "owner_emails", "editor_emails", "cc_emails", "spec_mentor_emails", "devrel_emails")
wfv = collections.Counter()
cs_rows, cs_updated, cs_with_email, cs_summary, cs_spec = [], [], 0, 0, []
start, total = 0, None
while total is None or start < total:
    s, b = get("https://chromestatus.com/api/v0/features?num=100&start=%d" % start)
    cs["pages"].append({"start": start, "status": s})
    if s != 200:
        break
    t = b.decode("utf8", "replace")
    d = json.loads(t[t.index("{"):])
    total = d["total_count"]
    if not d["features"]:
        break
    for f in d["features"]:
        cs["features"] += 1
        v = f.get("web_feature")
        wfv[v if v in (None, "", "Missing feature", "TBD") else "<id>"] += 1
        if v and v not in ("Missing feature", "TBD"):
            cs_rows.append((f["id"], v, f.get("name")))
        w = (f.get("updated") or {}).get("when")
        if w:
            cs_updated.append(w[:10])
        if any(f.get(k) for k in EMAIL_FIELDS):
            cs_with_email += 1
        if f.get("summary"):
            cs_summary += 1
        if f.get("spec_link"):
            cs_spec.append(f["spec_link"])
    start += 100
    time.sleep(1)
cs_res = [(i, v, n) for i, v, n in cs_rows if v in wf]
cs_moved = [(i, v, n) for i, v, n in cs_rows if v not in wf and v in wf_all]
cs_un = [(i, v, n) for i, v, n in cs_rows if v not in wf_all]
s_r, b_r = get("https://chromestatus.com/robots.txt")
s_h, b_h = get("https://chromestatus.com/roadmap")
cs.update({
    "total_count": total, "web_feature_field": dict(wfv), "entries_with_a_web_features_id": len(cs_rows), "newest_updated": max(cs_updated, default=None),
    "entries_with_summary_prose": cs_summary, "entries_with_spec_link": len(cs_spec), "entries_with_personal_email_fields_counted_not_written": cs_with_email,
    "robots_txt": {"status": s_r, "body": b_r.decode("utf8", "replace")[:200]},
    "site_html": {"url": "https://chromestatus.com/roadmap", "status": s_h, "bytes": len(b_h), "mentions_terms": bool(re.search(rb"(?i)terms of (use|service)", b_h)),
                  "note": "single-page app shell; no terms or licence wording in the served HTML"},
    "sample": [{"chromestatus_id": i, "web_feature": v, "entry": n, "web_features_entry": wf[v]["name"]} for i, v, n in rng.sample(cs_res, min(10, len(cs_res)))],
})
cs["pages"] = {"requested": len(cs["pages"]), "non_200": [p for p in cs["pages"] if p["status"] != 200]}
out["chromestatus"] = cs
J["chromestatus_web_feature"] = {
    "entries_total": cs["features"], "entries_with_id": len(cs_rows), "resolved_to_feature": len(cs_res), "resolved_to_moved_or_split_entry": len(cs_moved),
    "unresolved": len(cs_un), "unresolved_ids_sample": sorted({v for _, v, _ in cs_un})[:15], "distinct_features_hit": len({v for _, v, _ in cs_res}),
    "features_total": len(wf),
    "spec_link_to_browser_specs": spec_join(cs_spec),
}

# ---------------------------------------------------------------- webstatus.dev (derived view, reachability only)
s, b = get("https://api.webstatus.dev/v1/features?page_size=5")
try:
    d = json.loads(b)
    out["webstatus_dev"] = {"url": "https://api.webstatus.dev/v1/features?page_size=5", "status": s, "total": d.get("metadata", {}).get("total"),
                            "fields": sorted(d["data"][0]), "ids_in_web_features": sum(1 for x in d["data"] if x["feature_id"] in wf), "ids_returned": len(d["data"])}
except Exception:
    out["webstatus_dev"] = {"status": s}

# ---------------------------------------------------------------- GitHub pages the session proxy refuses (recorded, not used)
gated = {}
for u in ("https://api.github.com/repos/web-platform-dx/web-features/releases/latest", "https://github.com/mdn/browser-compat-data/releases/latest"):
    s, b = get(u, tries=1)
    gated[u] = s
out["not_reachable_from_this_session"] = gated


# ---------------------------------------------------------------- candidate: caniuse title = web-features name
def norm(s):
    s = re.sub(r"\([^)]*\)", " ", H.unescape(s or "").lower())
    s = re.sub(r"\b(css3?|html5?|api|the|element|property|javascript|js)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "", s)


byname = collections.defaultdict(list)
for fid, v in wf.items():
    byname[norm(v["name"])].append(fid)
claimed = {c: [f for f, cc in cd if cc == c] for c in cids}
matches = []
for cid, v in ciu.items():
    n = norm(v["title"])
    if n and n in byname:
        for fid in byname[n]:
            matches.append((cid, fid))
agree = [(c, f) for c, f in matches if f in claimed.get(c, [])]
undeclared = [(c, f) for c, f in matches if c not in claimed]
conflict = [(c, f) for c, f in matches if c in claimed and f not in claimed[c]]
pick = rng.sample(sorted(matches), min(20, len(matches)))
J["caniuse_title_candidate"] = {
    "caniuse_features": len(ciu), "title_matches_a_feature": len({c for c, _ in matches}), "pairs": len(matches),
    "pairs_equal_to_a_declared_link": len(agree), "pairs_where_caniuse_id_is_declared_for_another_feature": len(conflict),
    "pairs_with_no_declared_link_for_that_caniuse_id": len(undeclared), "caniuse_features_not_claimed_by_any_feature": len(ciu) - len(set(cids) & set(ciu)),
    "handcheck_pairs": [{
        "caniuse_id": c, "caniuse_title": ciu[c]["title"], "caniuse_description": strip_tags(ciu[c].get("description"))[:220], "caniuse_spec": ciu[c].get("spec"),
        "caniuse_first_chrome": next((ver for ver, st in sorted(ciu[c]["stats"]["chrome"].items(), key=lambda x: float(re.split(r"[-a-zA-Z ]", x[0])[0] or 0) if re.match(r"\d", x[0]) else 1e9) if st.startswith("y")), None),
        "web_features_id": f, "web_features_entry": wf[f]["name"], "web_features_description": (wf[f].get("description") or "")[:220], "web_features_spec": wf[f].get("spec"),
        "web_features_chrome": (wf[f]["status"].get("support") or {}).get("chrome"), "declared_link_exists": f in claimed.get(c, []),
    } for c, f in pick],
}
out["joins"] = J
out["http_non_200"] = {u: s for u, s in STATUS.items() if s != 200}
out["requests"] = NREQ[0]
json.dump(out, open("webf_measure.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in J.items() if k != "caniuse_title_candidate"}, indent=1)[:6000])
print("requests", NREQ[0])
