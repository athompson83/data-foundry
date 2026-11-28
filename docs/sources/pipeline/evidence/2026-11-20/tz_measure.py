#!/usr/bin/env python3
"""Round 29 (2026-11-20) screening of `time-zone-rules`.

Re-fetches live: the IANA tz database (data.iana.org/time-zones: tzdb/ files, the release
directory listing and tzdata-latest.tar.gz) and Unicode CLDR supplemental files
(raw.githubusercontent.com/unicode-org/cldr). Measures zone counts, release cadence, the
prose volume of the NEWS file and of the source-file commentary, and the joins on the IANA
time zone identifier between CLDR and tzdb. Writes tz_measure.json next to itself.
Stdlib only; one request at a time.
"""
import collections, hashlib, io, json, os, random, re, tarfile, time, urllib.request
import xml.etree.ElementTree as ET

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
N = 0
def get(url, timeout=120):
    global N
    N += 1
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    time.sleep(0.6)
    return body

IANA = "https://data.iana.org/time-zones/"
CLDR = "https://raw.githubusercontent.com/unicode-org/cldr/main/"
out = {"run_date": "2026-11-20"}

# ---- IANA tzdb -------------------------------------------------------------------------
version = get(IANA + "tzdb/version").decode().strip()
zi = get(IANA + "tzdb/tzdata.zi").decode()
zones, links, rules = set(), {}, collections.Counter()
for line in zi.splitlines():
    p = line.split()
    if not p or line.startswith("#"): continue
    if p[0] == "Z": zones.add(p[1])
    elif p[0] == "L": links[p[2]] = p[1]
    elif p[0] == "R": rules[p[1]] += 1
ids = zones | set(links)
def rows(text): return [l.split("\t") for l in text.splitlines() if l and not l.startswith("#")]
z1970 = rows(get(IANA + "tzdb/zone1970.tab").decode())
ztab = rows(get(IANA + "tzdb/zone.tab").decode())
countries = set(c for r in z1970 for c in r[0].split(","))
lic = get(IANA + "tzdb/LICENSE")
news = get(IANA + "tzdb/NEWS").decode("utf-8", "replace")
out["iana"] = {
    "version": version, "zones": len(zones), "links": len(links), "identifiers": len(ids),
    "link_targets_resolving_to_a_zone": sum(1 for t in links.values() if t in zones),
    "named_rule_sets": len(rules), "rule_lines": sum(rules.values()),
    "zone1970_rows": len(z1970), "zone1970_ids_resolving": sum(1 for r in z1970 if r[2] in zones),
    "zone1970_country_codes": len(countries), "zone1970_rows_with_several_countries": sum(1 for r in z1970 if "," in r[0]),
    "zone_tab_rows": len(ztab), "zone_tab_ids_resolving": sum(1 for r in ztab if r[2] in ids),
    "zone_tab_ids_that_are_links": sum(1 for r in ztab if r[2] in links),
    "by_area": dict(collections.Counter(z.split("/")[0] if "/" in z else "(no area)" for z in zones).most_common()),
    "license_sha256": hashlib.sha256(lic).hexdigest(), "license_bytes": len(lic),
}
listing = get(IANA + "releases/").decode("utf-8", "replace")
data_rel = sorted(set(re.findall(r"tzdata(\d{4}[a-z])\.tar\.gz", listing)))
out["iana"]["data_releases_listed"] = len(data_rel)
out["iana"]["oldest_and_newest_listed"] = [data_rel[0], data_rel[-1]]

# NEWS: one block per release
blocks = re.split(r"(?m)^(?=Release \S+ - )", news)
rel = []
for b in blocks:
    m = re.match(r"Release (\S+) - (\d{4}-\d{2}-\d{2})", b)
    if m: rel.append((m.group(1), m.group(2), b))
idre = re.compile(r"\b(?:Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)/[A-Za-z0-9_+\-]+(?:/[A-Za-z0-9_+\-]+)?")
def cited(b): return set(x.rstrip("-") for x in idre.findall(b))
per_year = collections.Counter(d[:4] for _, d, _ in rel)
recent = rel[:40]
cit_all, res_all, with_id = set(), set(), 0
recent_rows = []
for v, d, b in recent:
    c = cited(b); r = {x for x in c if x in ids}
    cit_all |= c; res_all |= r; with_id += bool(r)
    recent_rows.append({"release": v, "date": d, "characters": len(b), "ids_cited": len(c), "ids_resolving": len(r),
                        "changes_future": "Changes to future timestamps" in b, "changes_past": "Changes to past timestamps" in b})
allc = set(); allr = set(); nwith = 0
for v, d, b in rel:
    c = cited(b); allc |= c; r = {x for x in c if x in ids}; allr |= r; nwith += bool(r)
out["iana_news"] = {
    "bytes": len(news.encode()), "releases": len(rel), "oldest": rel[-1][:2], "newest": rel[0][:2],
    "releases_per_year_since_2016": {y: per_year[y] for y in sorted(per_year) if y >= "2016"},
    "median_characters_per_release_block": sorted(len(b) for _, _, b in rel)[len(rel) // 2],
    "releases_with_future_timestamp_changes": sum("Changes to future timestamps" in b for _, _, b in rel),
    "releases_with_past_timestamp_changes": sum("Changes to past timestamps" in b for _, _, b in rel),
    "all_releases": {"with_a_resolving_id": nwith, "distinct_ids_cited": len(allc), "distinct_ids_resolving": len(allr),
                     "unresolved_examples": sorted(allc - allr)[:15]},
    "newest_40_releases": {"with_a_resolving_id": with_id, "distinct_ids_cited": len(cit_all), "distinct_ids_resolving": len(res_all),
                           "unresolved": sorted(cit_all - res_all)},
    "newest_40": recent_rows,
}

# tarball: source commentary
tb = get(IANA + "tzdata-latest.tar.gz", timeout=300)
tf = tarfile.open(fileobj=io.BytesIO(tb))
members = {m.name: tf.extractfile(m).read() for m in tf.getmembers() if m.isfile()}
regional = ["africa", "antarctica", "asia", "australasia", "europe", "northamerica", "southamerica", "etcetera", "backward", "backzone", "factory"]
com = {}
for n in regional:
    if n not in members: continue
    t = members[n].decode("utf-8", "replace").splitlines()
    c = [l for l in t if l.startswith("#")]
    com[n] = {"lines": len(t), "comment_lines": len(c), "comment_characters": sum(len(l) for l in c),
              "from_lines": sum(1 for l in c if re.match(r"#\s*From ", l))}
out["iana_tarball"] = {"bytes": len(tb), "sha256": hashlib.sha256(tb).hexdigest(), "files": len(members),
                       "version_file": members.get("version", b"").decode().strip(), "source_files": com,
                       "comment_lines_total": sum(v["comment_lines"] for v in com.values()),
                       "comment_characters_total": sum(v["comment_characters"] for v in com.values()),
                       "attributed_from_lines_total": sum(v["from_lines"] for v in com.values())}

# ---- CLDR ------------------------------------------------------------------------------
def res(xs): return sum(1 for x in xs if x in ids)
bx = ET.fromstring(get(CLDR + "common/bcp47/timezone.xml"))
types = bx.findall(".//key[@name='tz']/type")
alias_ids, per_type_first = [], []
for t in types:
    a = (t.get("alias") or "").split()
    alias_ids += a
    if a: per_type_first.append(a[0])
al = sorted(set(alias_ids))
wx = ET.fromstring(get(CLDR + "common/supplemental/windowsZones.xml"))
wz = wx.findall(".//mapZone")
w_ids = sorted({i for m in wz for i in m.get("type").split()})
wver = wx.find(".//mapTimezones")
mx = ET.fromstring(get(CLDR + "common/supplemental/metaZones.xml"))
m_tz = sorted({t.get("type") for t in mx.findall(".//metazoneInfo/timezone")})
m_map = mx.findall(".//mapTimezones/mapZone")
m_map_ids = sorted({m.get("type") for m in m_map})
mzones = {u.get("mzone") for u in mx.findall(".//usesMetazone")}
cl = get(CLDR + "LICENSE")
try:
    pkg = json.loads(get("https://raw.githubusercontent.com/unicode-org/cldr-json/main/cldr-json/cldr-core/package.json"))
    cldr_json_version = pkg.get("version")
except Exception as e:
    cldr_json_version = "not measured: %s" % e
canon = set(per_type_first)
out["cldr"] = {
    "cldr_json_core_version": cldr_json_version,
    "bcp47_tz_types": len(types), "bcp47_deprecated_types": sum(1 for t in types if t.get("deprecated") == "true"),
    "bcp47_types_with_alias": len(per_type_first), "bcp47_distinct_alias_ids": len(al),
    "windows_mapzone_rows": len(wz), "windows_zone_names": len({m.get("other") for m in wz}),
    "windows_distinct_tz_ids": len(w_ids),
    "windows_file_declared_versions": dict(wver.attrib) if wver is not None else None,
    "metazone_timezones": len(m_tz), "metazones": len(mzones), "metazone_mapzone_rows": len(m_map),
    "license_sha256": hashlib.sha256(cl).hexdigest(), "license_bytes": len(cl),
}
iana_canon = zones
out["joins"] = {
    "bcp47_alias_id_to_tzdb": {"matched": res(al), "total": len(al), "to_zone": sum(1 for x in al if x in zones),
                               "to_link": sum(1 for x in al if x in links), "unresolved": [x for x in al if x not in ids]},
    "windows_tz_id_to_tzdb": {"matched": res(w_ids), "total": len(w_ids), "to_zone": sum(1 for x in w_ids if x in zones),
                              "to_link": sum(1 for x in w_ids if x in links), "unresolved": [x for x in w_ids if x not in ids]},
    "metazone_timezone_to_tzdb": {"matched": res(m_tz), "total": len(m_tz), "to_zone": sum(1 for x in m_tz if x in zones),
                                  "to_link": sum(1 for x in m_tz if x in links), "unresolved": [x for x in m_tz if x not in ids]},
    "metazone_mapzone_to_tzdb": {"matched": res(m_map_ids), "total": len(m_map_ids)},
    "tzdb_ids_covered_by_cldr_alias": {"matched": sum(1 for x in ids if x in set(al)), "total": len(ids),
                                       "tzdb_only_examples": sorted(x for x in ids if x not in set(al))[:15]},
    "tzdb_zones_with_a_metazone_history": {"matched": sum(1 for z in zones if z in set(m_tz)), "total": len(zones)},
    "cldr_canonical_is_tzdb_zone": {"matched": sum(1 for x in canon if x in zones), "total": len(canon),
                                    "cldr_canonical_is_tzdb_link": sorted(x for x in canon if x in links)[:60],
                                    "count_link": sum(1 for x in canon if x in links)},
    "news_cited_id_to_cldr_alias": {"matched": sum(1 for x in allr if x in set(al)), "total": len(allr)},
}
# seeded sample for the hand-check of the NEWS place-name candidate join
random.seed(20261120)
cand = []
for v, d, b in rel:
    m = re.search(r"Briefly:\n((?:    .*\n?)+)", b)
    if not m: continue
    for z in zones:
        city = z.split("/")[-1].replace("_", " ")
        if len(city) >= 5 and re.search(r"\b%s\b" % re.escape(city), m.group(1)):
            cand.append({"release": v, "date": d, "zone": z})
out["news_briefly_city_name_candidates"] = {"releases_with_briefly": sum(1 for _, _, b in rel if "Briefly:" in b),
                                           "pairs": len(cand), "releases": len({c["release"] for c in cand}),
                                           "seeded_sample_20": random.sample(cand, min(20, len(cand)))}
out["requests"] = N
json.dump(out, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "tz_measure.json"), "w"), indent=1, sort_keys=True)
print(json.dumps({k: v for k, v in out.items() if k != "iana_news"}, indent=1)[:7000])
n = out["iana_news"]; n.pop("newest_40"); print(json.dumps(n, indent=1))
