#!/usr/bin/env python3
"""Screening 2026-11-18: near-earth-objects (one record per near-Earth asteroid/comet). Fetches every source live (stdlib only).
Run from this directory with: python3 -I neo_measure.py   -> writes neo_measure.json (hand-check pairs included; verdicts in neo_handcheck.json)
Output holds minor-planet designations, object names, orbit classes, magnitudes, dates, story ids/headlines and counts only.
No personal data: MPEC observer/measurer credits and news bylines are never written (their presence is only counted).
Optional: set env NEO_SNIPPETS=/some/path/outside/the/repo.json to also dump the text context of the sampled
candidate pairs for the hand-check (that file is not committed; it can contain names of people quoted in a story).

Members measured:
  NASA/JPL SSD + CNEOS APIs (ssd-api.jpl.nasa.gov): sbdb_query (all NEOs), cad (close approaches), sentry (impact risk + removed).
  IAU Minor Planet Center NEA.txt (minorplanetcenter.net/iau/MPCORB/NEA.txt): orbits of every near-Earth asteroid.
  NEODyS-2 risk list (newton.spacedys.com/neodys, University of Pisa / SpaceDyS): independent impact monitoring.
  JPL CNEOS news archive (cneos.jpl.nasa.gov/news): prose stories that cite designations (the free-text member).
Measured but parked (terms forbid redistribution; see the research record):
  MPC Minor Planet Electronic Circulars (each circular: "must not otherwise be redistributed electronically").
  ESA NEOCC (neo.ssa.esa.int) risk list / close approaches (ESA terms: personal non-commercial use, no redistribution).
  NASA NeoWs (api.nasa.gov): API-key wall, status only.
Joins:
  declared: MPC designation (permanent number, else provisional designation) shared by JPL Sentry, NEODyS, JPL SBDB and MPC NEA.txt;
            MPC designation cited in the prose of a CNEOS news story -> MPC NEA.txt.
  candidate: an MPC object name (e.g. Apophis) mentioned in a CNEOS news story -> the named NEA in NEA.txt (pairs written for hand-check).
"""
import json, os, re, time, random, html as H, collections, urllib.request, urllib.error

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
SEED = 20261118
out = {"run_date": time.strftime("%Y-%m-%d"), "run_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "seed": SEED}
NREQ = [0]
LAST = {}


def get(u, timeout=300, tries=3):
    host = u.split("/")[2]
    for i in range(tries):
        wait = 1.2 - (time.time() - LAST.get(host, 0))
        if wait > 0:
            time.sleep(wait)  # one request at a time, spaced, per host (JPL SSD API fair-use policy)
        NREQ[0] += 1
        LAST[host] = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "*/*"}), timeout=timeout) as f:
                return f.status, f.headers.get("Content-Type", ""), f.read(), f.geturl()
        except urllib.error.HTTPError as e:
            if (e.code >= 500 or e.code == 429) and i < tries - 1:
                time.sleep(15 * (i + 1))
                continue
            return e.code, e.headers.get("Content-Type", ""), e.read(), u
        except Exception as e:
            if i == tries - 1:
                return 0, "", str(e).encode(), u
            time.sleep(10)


def text(b, enc="utf8"):
    t = b.decode(enc, "replace") if isinstance(b, bytes) else b
    t = re.sub(r"<script.*?</script>|<style.*?</style>|<!--.*?-->", " ", t, flags=re.S)
    t = re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", t)))
    return re.sub(r" ([.,;:])", r"\1", t).strip()


PROV = re.compile(r"^((?:1[89]|20)\d\d) ?([A-Z]{2}\d{0,4})$")


def key(des):
    """Normalise a designation: permanent number as digits, else provisional designation without spaces."""
    d = des.strip().strip("()").strip()
    if re.fullmatch(r"\d+", d):
        return str(int(d))
    m = PROV.match(d)
    if m:
        return m.group(1) + m.group(2)
    return re.sub(r"\s+", "", d).upper()


def num(x):
    try:
        return float(x)
    except Exception:
        return None


def sample(seq, n, salt=0):
    seq = sorted(seq)
    return random.Random(SEED + salt).sample(seq, min(n, len(seq)))


# ---------------------------------------------------------------- JPL SBDB (all NEOs)
SBDB_URL = "https://ssd-api.jpl.nasa.gov/sbdb_query.api?fields=spkid,pdes,name,full_name,kind,neo,pha,class,H,diameter,albedo,moid,first_obs,last_obs&sb-group=neo"
st, ct, b, _ = get(SBDB_URL)
j = json.loads(b)
F = j["fields"]
rows = [dict(zip(F, r)) for r in j["data"]]
sb_by = {}      # key -> row  (primary designation)
sb_alias = {}   # provisional designation in the full name's parentheses -> row (numbered objects)
for r in rows:
    sb_by[key(r["pdes"])] = r
    m = re.search(r"\(([^()]+)\)\s*$", r["full_name"] or "")
    if m and r["pdes"].isdigit():
        sb_alias[key(m.group(1))] = r
ast = [r for r in rows if r["kind"].startswith("a")]
today = out["run_date"]
out["jpl_sbdb"] = {
    "url": SBDB_URL, "status": st, "signature": j.get("signature"), "count": j["count"], "rows": len(rows),
    "asteroids": len(ast), "comets": len(rows) - len(ast),
    "numbered": sum(1 for r in rows if r["kind"] in ("an", "cn")),
    "orbit_class": dict(collections.Counter(r["class"] for r in rows).most_common()),
    "pha": sum(1 for r in rows if r["pha"] == "Y"),
    "with_name": sum(1 for r in rows if r["name"]),
    "with_H": sum(1 for r in rows if r["H"] is not None),
    "with_diameter": sum(1 for r in rows if r["diameter"] is not None),
    "with_albedo": sum(1 for r in rows if r["albedo"] is not None),
    "with_moid": sum(1 for r in rows if r["moid"] is not None),
    "oldest_first_obs": min(r["first_obs"] for r in rows if r["first_obs"] and re.match(r"\d{4}-\d\d-\d\d$", r["first_obs"])),
    "newest_first_obs": max(r["first_obs"] for r in rows if r["first_obs"] and re.match(r"\d{4}-\d\d-\d\d$", r["first_obs"])),
    "newest_last_obs": max(r["last_obs"] for r in rows if r["last_obs"] and re.match(r"\d{4}-\d\d-\d\d$", r["last_obs"])),
    "first_obs_in_run_month": sum(1 for r in rows if (r["first_obs"] or "").startswith(today[:7])),
    "first_obs_in_run_year": sum(1 for r in rows if (r["first_obs"] or "").startswith(today[:4])),
    "sample": [{k: r[k] for k in ("pdes", "name", "kind", "class", "pha", "H", "diameter", "first_obs", "last_obs")} for r in (rows[0], sb_by.get("2024YR4", rows[1]), rows[-1])],
}

# ---------------------------------------------------------------- JPL CAD (close approaches to Earth within 0.05 au, 1900-2200)
CAD_URL = "https://ssd-api.jpl.nasa.gov/cad.api?date-min=1900-01-01&date-max=2200-01-01&dist-max=0.05"
st, ct, b, _ = get(CAD_URL)
j = json.loads(b)
CF = j["fields"]
cad = [dict(zip(CF, r)) for r in j["data"]]
MON = {m: i + 1 for i, m in enumerate("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split())}


def cad_date(s):
    y, m, d = s.split(" ")[0].split("-")
    return "%s-%02d-%s" % (y, MON[m], d)


for r in cad:
    r["date"] = cad_date(r["cd"])
cad_des = {key(r["des"]) for r in cad}
out["jpl_cad"] = {
    "url": CAD_URL, "status": st, "signature": j.get("signature"), "count": int(j["count"]), "fields": CF,
    "distinct_objects": len(cad_des),
    "objects_resolving_to_sbdb_neo": sum(1 for d in cad_des if d in sb_by or d in sb_alias),
    "first_date": min(r["date"] for r in cad), "last_date": max(r["date"] for r in cad),
    "approaches_before_run_date": sum(1 for r in cad if r["date"] < today),
    "approaches_from_run_date": sum(1 for r in cad if r["date"] >= today),
    "approaches_in_run_month": sum(1 for r in cad if r["date"].startswith(today[:7])),
    "within_1_lunar_distance": sum(1 for r in cad if float(r["dist"]) < 0.00257),
    "sample": [{k: r[k] for k in ("des", "cd", "dist", "v_rel", "h")} for r in cad if r["date"] >= today][:3],
}
del cad

# ---------------------------------------------------------------- JPL Sentry (impact risk) + removed objects
SENTRY_URL = "https://ssd-api.jpl.nasa.gov/sentry.api"
st, ct, b, _ = get(SENTRY_URL)
j = json.loads(b)
sentry = {key(r["des"]): r for r in j["data"]}
st2, ct, b, _ = get(SENTRY_URL + "?removed=1")
j2 = json.loads(b)
out["jpl_sentry"] = {
    "url": SENTRY_URL, "status": st, "signature": j.get("signature"), "count": int(j["count"]), "distinct": len(sentry),
    "fields": sorted(j["data"][0].keys()),
    "numbered": sum(1 for k in sentry if k.isdigit()),
    "torino_scale_above_0": sum(1 for r in sentry.values() if (r.get("ts_max") or "0") not in ("0", "", None)),
    "palermo_cum_above_minus_3": sum(1 for r in sentry.values() if num(r.get("ps_cum")) is not None and num(r["ps_cum"]) > -3),
    "newest_last_obs": max(r["last_obs"][:10] for r in sentry.values() if re.match(r"\d{4}-\d\d-\d\d", r.get("last_obs") or "")),
    "resolving_to_sbdb_neo": sum(1 for k in sentry if k in sb_by or k in sb_alias),
    "removed_url": SENTRY_URL + "?removed=1", "removed_status": st2, "removed_count": int(j2["count"]),
    "removed_newest": max(r["removed"] for r in j2["data"]), "removed_oldest": min(r["removed"] for r in j2["data"]),
    "removed_in_run_month": sum(1 for r in j2["data"] if r["removed"].startswith(today[:7])),
    "top5_by_cumulative_palermo": [{k: r.get(k) for k in ("des", "ip", "ps_cum", "ts_max", "h", "diameter", "range", "n_imp", "last_obs")}
                                    for r in sorted(sentry.values(), key=lambda r: -(num(r.get("ps_cum")) or -99))[:5]],
}

# ---------------------------------------------------------------- MPC NEA.txt
MPC_URL = "https://www.minorplanetcenter.net/iau/MPCORB/NEA.txt"
st, ct, b, _ = get(MPC_URL)
mpc_by, mpc_names, mpc = {}, {}, []
TYPES = {1: "Atira", 2: "Aten", 3: "Apollo", 4: "Amor"}
for ln in b.decode("latin1").splitlines():
    if len(ln) < 194:
        continue
    rd = ln[166:194].strip()
    m = re.match(r"\((\d+)\)\s*(.*)$", rd)
    flags = int(ln[161:165], 16)
    r = {"readable": rd, "number": m.group(1) if m else None, "rest": (m.group(2) if m else rd).strip(), "H": num(ln[8:13]),
         "type": TYPES.get(flags & 0x3F, "other"), "pha": bool(flags & 0x8000), "last_obs": ln[194:202].strip(), "arc": ln[127:136].strip(), "nobs": ln[117:122].strip()}
    mpc.append(r)
    if r["number"]:
        mpc_by[key(r["number"])] = r
        if PROV.match(r["rest"]):
            mpc_by.setdefault(key(r["rest"]), r)
        elif r["rest"]:
            mpc_names[r["rest"]] = r
    else:
        mpc_by[key(r["rest"])] = r
out["mpc_nea"] = {
    "url": MPC_URL, "status": st, "bytes": len(b), "rows": len(mpc),
    "numbered": sum(1 for r in mpc if r["number"]), "named": len(mpc_names),
    "orbit_type": dict(collections.Counter(r["type"] for r in mpc).most_common()),
    "pha": sum(1 for r in mpc if r["pha"]), "with_H": sum(1 for r in mpc if r["H"] is not None),
    "newest_last_obs": max(r["last_obs"] for r in mpc if re.match(r"\d{8}$", r["last_obs"])),
    "last_obs_in_run_month": sum(1 for r in mpc if r["last_obs"].startswith(today[:7].replace("-", ""))),
    "sample": [{k: r[k] for k in ("readable", "H", "type", "pha", "arc", "last_obs")} for r in (mpc[0], mpc_by.get("2024YR4", mpc[1]), mpc[-1])],
}
st, ct, b, _ = get("https://www.minorplanetcenter.net/")
t = text(b)
m = re.search(r"Near-Earth Objects Discovered THIS MONTH: (\d+) THIS YEAR: (\d+) ALL TIME: (\d+)", t)
out["mpc_nea"]["home_page_running_tally"] = {"status": st, "this_month": int(m.group(1)), "this_year": int(m.group(2)), "all_time": int(m.group(3))} if m else {"status": st}
out["mpc_nea"]["home_page_has_licence_wording"] = bool(re.search(r"(?i)licen[cs]e|copyright|creative commons|terms of use", t))

# ---------------------------------------------------------------- NEODyS risk list
NEODYS_URL = "https://newton.spacedys.com/neodys/index.php?pc=4.1"
st, ct, b, _ = get(NEODYS_URL)
raw = b.decode("utf8", "replace")
neodys = {}
for m in re.finditer(r'href="index\.php\?pc=1\.1\.0&(?:amp;)?n=([^"]+)">([^<]+)</a></td>\s*<td[^>]*>.*?</td>\s*<td[^>]*>([^<]*)</td>\s*<td[^>]*>([^<]*)</td>\s*<td[^>]*>([^<]*)</td>\s*<td[^>]*>([^<]*)</td>', raw, flags=re.S):
    shown = H.unescape(m.group(2)).strip()
    mm = re.match(r"\((\d+)\)", shown)
    k = key(mm.group(1)) if mm else key(shown)
    neodys[k] = {"shown": shown, "H": num(m.group(3)), "ps_max": num(m.group(4)), "ts_max": m.group(5).strip(), "status": m.group(6).strip()}
t = text(raw)
m1 = re.search(r"Last updated: ([\d-]+ [\d:]+ UTC)", t)
m2 = re.search(r"There are currently (\d+) NEAs in the NEODyS risk list", t)
out["neodys_risk"] = {
    "url": NEODYS_URL, "status": st, "last_updated": m1.group(1) if m1 else None, "stated_count": int(m2.group(1)) if m2 else None,
    "parsed_rows": len(neodys), "numbered": sum(1 for k in neodys if k.isdigit()),
    "status_counts": dict(collections.Counter(r["status"] for r in neodys.values()).most_common()),
    "sample": [neodys[k] for k in sorted(neodys)[:3]],
}
st, ct, b, _ = get("https://newton.spacedys.com/neodys/index.php?pc=7.0")
out["neodys_risk"]["info_credits_page"] = {"url": "https://newton.spacedys.com/neodys/index.php?pc=7.0", "status": st, "chars": len(text(b)),
                                           "has_licence_wording": bool(re.search(r"(?i)licen[cs]e|copyright|creative commons|terms of use|non-commercial", text(b)))}

# ---------------------------------------------------------------- CNEOS news (free text)
NEWS_URL = "https://cneos.jpl.nasa.gov/news/news.json"
st, ct, b, _ = get(NEWS_URL)
news = json.loads(b)["news"]
internal = [n for n in news if re.fullmatch(r"/news/news\d+", n["id"])]
DES_RE = re.compile(r"(?<![A-Za-z0-9/])((?:19|20)\d\d) ([A-Z]{2}\d{0,3})(?![A-Za-z0-9])")
NUM_RE = re.compile(r"(?<![A-Za-z0-9])\(?(\d{3,6})\)? ([A-Z][a-z]{3,})")
stories, cited, name_pairs, snippets = [], collections.defaultdict(set), [], {}
long_names = {n: r for n, r in mpc_names.items() if len(n) >= 4}
NAME_RE = re.compile(r"(?<![A-Za-z'-])(" + "|".join(sorted(map(re.escape, long_names), key=len, reverse=True)) + r")(?![A-Za-z-])")
for n in internal:
    u = "https://cneos.jpl.nasa.gov" + n["id"] + ".html"
    s, ct, b, _ = get(u)
    if s != 200:
        stories.append({"id": n["id"], "date": n["date"], "status": s})
        continue
    rawp = b.decode("utf8", "replace")
    i, e = rawp.find('class="px-4"'), rawp.find("site-footer")
    body = text(rawp[rawp.find(">", i) + 1 if i > 0 else 0:e if e > 0 else len(rawp)])
    body = re.sub(r"\s*Site Map Privacy Image Policy.*$", "", body)
    ds = {key(a + " " + c) for a, c in DES_RE.findall(body)}
    for a, nm in NUM_RE.findall(body):
        if key(a) in mpc_by and mpc_by[key(a)]["rest"] == nm:   # "99942 Apophis": number followed by that object's own name
            ds.add(key(a))
    for d in ds:
        cited[d].add(n["id"])
    hits = collections.Counter(NAME_RE.findall(body))
    for nm, c in hits.items():
        r = long_names[nm]
        pos = [m.start() for m in NAME_RE.finditer(body) if m.group(1) == nm]
        pre = [body[max(0, p - 30):p].lower() for p in pos]
        name_pairs.append({"story_id": n["id"], "story_date": n["date"], "story_headline": n["title"], "mention": nm, "mentions_in_story": c,
                           "mpc_number": r["number"], "mpc_readable": r["readable"], "mpc_orbit_type": r["type"],
                           "story_cites_mpc_number": bool(re.search(r"(?<!\d)" + r["number"] + r"(?!\d)", body)),
                           "preceded_by_object_word": any(re.search(r"(asteroid|comet|object|planet|nea|neo)s?,? (\(?\d+\)? )?$", x) for x in pre)})
        snippets[n["id"] + "|" + nm] = [body[max(0, p - 160):p + 160] for p in pos[:3]]
    stories.append({"id": n["id"], "date": n["date"], "status": s, "chars": len(body), "words": len(body.split()), "designations_cited": sorted(ds), "object_names_mentioned": len(hits)})
ok = [s for s in stories if s.get("chars")]
chars = sorted(s["chars"] for s in ok)
out["cneos_news"] = {
    "url": NEWS_URL, "status": st, "stories_listed": len(news), "newest": max(n["date"] for n in news), "oldest": min(n["date"] for n in news),
    "by_year_last_6": dict(sorted(collections.Counter(n["date"][:4] for n in news).items())[-6:]),
    "listed_by_source_organisation": dict(collections.Counter((n["org_name"] or "none") for n in news).most_common(6)),
    "hosted_on_cneos": len(internal), "hosted_fetched_ok": len(ok),
    "hosted_newest": max(n["date"] for n in internal), "hosted_oldest": min(n["date"] for n in internal),
    "chars_min": chars[0], "chars_median": chars[len(chars) // 2], "chars_max": chars[-1], "chars_total": sum(chars),
    "words_median": sorted(s["words"] for s in ok)[len(ok) // 2],
    "stories_citing_a_designation": sum(1 for s in ok if s["designations_cited"]),
    "stories_mentioning_an_mpc_object_name": sum(1 for s in ok if s["object_names_mentioned"]),
    "distinct_designations_cited": len(cited),
    "stories": [{k: s.get(k) for k in ("id", "date", "status", "chars", "designations_cited")} for s in stories],
}

# ---------------------------------------------------------------- joins
J = {}


def hdiff(pairs):
    d = [abs(a - b) for a, b in pairs if a is not None and b is not None]
    return {"compared": len(d), "abs_H_difference_le_0.5": sum(1 for x in d if x <= 0.5), "abs_H_difference_gt_1.0": sum(1 for x in d if x > 1.0)}


# Sentry -> MPC NEA.txt
m_ = [k for k in sentry if k in mpc_by]
J["sentry_to_mpc"] = {"key": "MPC designation", "total_sentry": len(sentry), "matched": len(m_), "unmatched": sorted(sentry[k]["des"] for k in sentry if k not in mpc_by)[:25],
                      "H_agreement": hdiff([(num(sentry[k]["h"]), mpc_by[k]["H"]) for k in m_]), "sample_matched": [sentry[k]["des"] for k in sample(m_, 10, 1)]}
# Sentry <-> NEODyS
both = [k for k in sentry if k in neodys]
J["sentry_neodys"] = {"key": "MPC designation", "total_sentry": len(sentry), "total_neodys": len(neodys), "in_both": len(both),
                      "sentry_only": len(sentry) - len(both), "neodys_only": len(neodys) - len(both), "union": len(set(sentry) | set(neodys)),
                      "H_agreement": hdiff([(num(sentry[k]["h"]), neodys[k]["H"]) for k in both]),
                      "ps_max_abs_difference_le_1.0": sum(1 for k in both if num(sentry[k].get("ps_max")) is not None and neodys[k]["ps_max"] is not None and abs(num(sentry[k]["ps_max"]) - neodys[k]["ps_max"]) <= 1.0),
                      "sample_in_both": [{"des": sentry[k]["des"], "sentry_H": sentry[k]["h"], "neodys_H": neodys[k]["H"], "sentry_ps_max": sentry[k].get("ps_max"), "neodys_ps_max": neodys[k]["ps_max"]} for k in sample(both, 20, 2)],
                      "sample_sentry_only": [sentry[k]["des"] for k in sample([k for k in sentry if k not in neodys], 10, 3)],
                      "sample_neodys_only": [neodys[k]["shown"] for k in sample([k for k in neodys if k not in sentry], 10, 4)]}
# NEODyS -> MPC
m_ = [k for k in neodys if k in mpc_by]
J["neodys_to_mpc"] = {"key": "MPC designation", "total_neodys": len(neodys), "matched": len(m_), "unmatched": sorted(neodys[k]["shown"] for k in neodys if k not in mpc_by)[:25],
                      "H_agreement": hdiff([(neodys[k]["H"], mpc_by[k]["H"]) for k in m_])}
# NEODyS -> JPL SBDB
J["neodys_to_sbdb"] = {"key": "MPC designation", "total_neodys": len(neodys), "matched": sum(1 for k in neodys if k in sb_by or k in sb_alias)}
# JPL SBDB NEAs <-> MPC NEA.txt
ast_keys = {key(r["pdes"]): r for r in ast}
strict = [k for k in ast_keys if k in mpc_by]
alias_extra = []
for k, r in ast_keys.items():
    if k in mpc_by:
        continue
    mm = re.search(r"\(([^()]+)\)\s*$", r["full_name"] or "")
    if mm and key(mm.group(1)) in mpc_by:
        alias_extra.append(k)
mpc_keys = {(key(r["number"]) if r["number"] else key(r["rest"])): r for r in mpc}
mpc_in_sb = sum(1 for k, r in mpc_keys.items() if k in sb_by or k in sb_alias or (r["number"] and PROV.match(r["rest"]) and key(r["rest"]) in sb_by))
J["sbdb_mpc"] = {"key": "MPC designation", "total_sbdb_near_earth_asteroids": len(ast_keys), "matched_on_primary_designation": len(strict),
                 "matched_only_via_provisional_designation_of_a_numbered_object": len(alias_extra),
                 "sbdb_asteroids_not_in_nea_txt": len(ast_keys) - len(strict) - len(alias_extra),
                 "sample_sbdb_not_in_nea_txt": [ast_keys[k]["pdes"] for k in sample([k for k in ast_keys if k not in mpc_by and k not in alias_extra], 10, 5)],
                 "total_mpc_nea_rows": len(mpc_keys), "mpc_rows_found_in_sbdb_neo": mpc_in_sb,
                 "sample_mpc_not_in_sbdb_neo": [r["readable"] for k, r in sorted(mpc_keys.items()) if not (k in sb_by or k in sb_alias or (r["number"] and PROV.match(r["rest"]) and key(r["rest"]) in sb_by))][:10],
                 "H_agreement": hdiff([(num(ast_keys[k]["H"]), mpc_by[k]["H"]) for k in strict]),
                 "pha_flag_equal": sum(1 for k in strict if (ast_keys[k]["pha"] == "Y") == mpc_by[k]["pha"]),
                 "orbit_class_equal": sum(1 for k in strict if {"APO": "Apollo", "ATE": "Aten", "AMO": "Amor", "IEO": "Atira"}.get(ast_keys[k]["class"]) == mpc_by[k]["type"])}
# CNEOS news cited designations -> MPC NEA.txt (cross-publisher) and -> SBDB NEO (same publisher)
cm = [d for d in cited if d in mpc_by]
J["news_designation_to_mpc"] = {"key": "MPC designation cited in the story text", "distinct_designations_cited": len(cited), "matched_mpc_nea": len(cm),
                                "matched_sbdb_neo": sum(1 for d in cited if d in sb_by or d in sb_alias),
                                "stories_with_a_resolving_designation": len({s for d in cm for s in cited[d]}), "stories_fetched": len(ok),
                                "matched": sorted(cm), "unmatched": sorted(d for d in cited if d not in mpc_by),
                                "unmatched_resolving_in_sbdb_as": {d: (sb_by.get(d) or sb_alias[d])["full_name"].strip() for d in sorted(cited) if d not in mpc_by and (d in sb_by or d in sb_alias)},
                                "cited_also_on_sentry": sorted(d for d in cited if d in sentry), "cited_also_on_neodys_risk": sorted(d for d in cited if d in neodys)}
# candidate: object-name mention in a story -> named NEA
name_pairs.sort(key=lambda p: (p["story_id"], p["mention"]))
picked = random.Random(SEED).sample(name_pairs, min(20, len(name_pairs)))
J["news_name_mention_to_mpc"] = {"key": "object name mentioned in the story text (candidate)", "named_neas_in_nea_txt_with_4plus_letters": len(long_names),
                                 "story_name_pairs": len(name_pairs), "distinct_names_mentioned": len({p["mention"] for p in name_pairs}),
                                 "stories_with_a_mention": len({p["story_id"] for p in name_pairs}), "stories_fetched": len(ok),
                                 "pairs_where_story_also_cites_the_number": sum(1 for p in name_pairs if p["story_cites_mpc_number"]),
                                 "mention_counts": dict(collections.Counter(p["mention"] for p in name_pairs).most_common(25)),
                                 "sampled_pairs_for_handcheck": picked}
if os.environ.get("NEO_SNIPPETS"):
    with open(os.environ["NEO_SNIPPETS"], "w") as f:
        json.dump({p["story_id"] + "|" + p["mention"]: snippets[p["story_id"] + "|" + p["mention"]] for p in picked}, f, indent=1)

# ---------------------------------------------------------------- parked: MPC MPECs
MPEC_LIST = "https://www.minorplanetcenter.net/mpec/RecentMPECs.html"
st, ct, b, _ = get(MPEC_LIST)
flat = re.sub(r"\s+", " ", b.decode("latin1"))
items = re.findall(r'<a href="(/mpec/K\d\d/K\d\d\w+\.html)"><i>MPEC</i> ([\w-]+)</a> \((\d{4} \w+ \d+)\)\s*<ul>\s*<li>(.*?)\s*</ul>', flat)
MONTHS = {m: i + 1 for i, m in enumerate("January February March April May June July August September October November December".split())}


def iso(s):
    y, m, d = s.split()
    return "%s-%02d-%02d" % (y, MONTHS[m], int(d))


mp = [{"path": p, "id": i, "date": iso(d), "heading": text(h)} for p, i, d, h in items]
single = [x for x in mp if PROV.match(x["heading"])]
NOTICE = "may be linked-to from your own Web pages, but must not otherwise be redistributed electronically"
lens, notice, observer, sampled = [], 0, 0, []
for x in sample([x["path"] for x in mp], 20, 6):
    s, ct, b, _ = get("https://www.minorplanetcenter.net" + x)
    tt = text(b, "latin1")
    i = tt.find("M.P.E.C. ")
    body = tt[i:] if i > 0 else tt
    body = re.sub(r"\s*Read MPEC [\w-]+ Read MPEC.*$", "", body)
    lens.append(len(body))
    notice += NOTICE in tt
    observer += "Observer details" in tt
    sampled.append({"path": x, "status": s, "chars": len(body)})
lens.sort()
by_day = collections.Counter(x["date"] for x in mp)
out["mpc_mpec_parked"] = {
    "url": MPEC_LIST, "status": st, "circulars_listed": len(mp), "newest": max(x["date"] for x in mp), "oldest": min(x["date"] for x in mp),
    "days_spanned": len(by_day), "per_day_max": max(by_day.values()),
    "single_provisional_designation_headings": len(single), "daily_orbit_update_headings": sum(1 for x in mp if x["heading"].startswith("DAILY ORBIT UPDATE")),
    "heading_designations_in_mpc_nea_txt": sum(1 for x in single if key(x["heading"]) in mpc_by),
    "heading_designations_in_jpl_sbdb_neo": sum(1 for x in single if key(x["heading"]) in sb_by or key(x["heading"]) in sb_alias),
    "heading_designations_on_jpl_sentry": sum(1 for x in single if key(x["heading"]) in sentry),
    "sample_headings": [x["id"] + ": " + x["heading"] for x in mp[:6]],
    "sampled_circulars": len(sampled), "sampled": sampled, "chars_min": lens[0], "chars_median": lens[len(lens) // 2], "chars_max": lens[-1],
    "sampled_carrying_the_no_redistribution_notice": notice, "sampled_with_observer_credit_section_personal_data": observer,
    "notice_text": NOTICE,
}

# ---------------------------------------------------------------- parked: ESA NEOCC
ESA = "https://neo.ssa.esa.int/PSDB-portlet/download?file="


def esa_rows(b):
    lines = b.decode("utf8", "replace").splitlines()
    upd = lines[0].replace("Last Update:", "").strip() if lines and lines[0].startswith("Last Update") else None
    rows = []
    for ln in lines:
        p = [c.strip() for c in ln.split("|")]
        if len(p) > 5 and not re.match(r"^(Object|Num/des|A+ )", ln.strip()) and p[0]:
            f = ln[:12].strip() if re.fullmatch(r"\d+", ln[:12].strip()) else p[0].split()[0]
            rows.append((key(f), p))
    return upd, rows


esa = {}
for name in ("esa_risk_list", "esa_special_risk_list", "esa_upcoming_close_app", "esa_recent_close_app"):
    s, ct, b, _ = get(ESA + name)
    upd, rws = esa_rows(b) if s == 200 else (None, [])
    esa[name] = {"status": s, "bytes": len(b), "last_update": upd, "rows": len(rws), "keys": [k for k, _ in rws]}
s, ct, b, _ = get(ESA + "allneo.lst")
allneo = [ln.split()[0] for ln in b.decode("utf8", "replace").splitlines() if ln.strip()] if s == 200 else []
esa_risk = set(esa["esa_risk_list"]["keys"]) | set(esa["esa_special_risk_list"]["keys"])
out["esa_neocc_parked"] = {
    "base_url": ESA, "files": {n: {k: v for k, v in d.items() if k != "keys"} for n, d in esa.items()},
    "allneo_lst": {"status": s, "rows": len(allneo)},
    "risk_objects_normal_plus_special": len(esa_risk),
    "risk_in_jpl_sentry": len(esa_risk & set(sentry)), "risk_not_in_jpl_sentry": len(esa_risk - set(sentry)), "jpl_sentry_not_in_esa_risk": len(set(sentry) - esa_risk),
    "risk_in_neodys_risk": len(esa_risk & set(neodys)), "risk_in_mpc_nea_txt": sum(1 for k in esa_risk if k in mpc_by),
    "risk_in_jpl_sbdb_neo": sum(1 for k in esa_risk if k in sb_by or k in sb_alias),
    "in_all_three_risk_lists_jpl_esa_neodys": len(esa_risk & set(sentry) & set(neodys)),
}

# ---------------------------------------------------------------- terms pages (verbatim checks) and gated hosts
TERMS = [
    ("jpl_ssd_api_fair_use", "https://ssd-api.jpl.nasa.gov/doc/", ["You agree to limit requests to those reasonably necessary for your application or use case.",
                                                                    "You agree to submit only one API request at a time (no simultaneous requests).",
                                                                    "You may not embed these APIs in your website (per NASA CORS policy)."]),
    ("jpl_image_use_policy", "https://www.jpl.nasa.gov/jpl-image-use-policy/", []),
    ("mpc_mpec_notice", "https://www.minorplanetcenter.net/mpec/K26/K26W33.html", ["The following Minor Planet Electronic Circular may be linked-to from your own Web pages, but must not otherwise be redistributed electronically."]),
    ("mpc_mpcorb_page", "https://www.minorplanetcenter.net/iau/MPCORB.html", ["The MPC Orbit (MPCORB) database contains orbital elements of minor planets that have been published in the Minor Planet Circulars, the Minor Planet Orbit Supplement and the Minor Planet Electronic Circulars."]),
    ("esa_neocc_terms", "https://neo.ssa.esa.int/terms-conditions", ["Access to, and use of, this ESA website constitutes acceptance of the following general terms and conditions."]),
    ("esa_general_terms", "https://www.esa.int/Services/Terms_and_conditions", ["The contents of the ESA website are intended for the personal and non-commercial use of its users.",
                                                                               "ESA does not grant the right to resell or redistribute any information, documents, images or material from its website or to compile or create derivative works from material on its website."]),
    ("esa_neocc_automated_access", "https://neo.ssa.esa.int/computer-access", ["No authentication is required."]),
    ("nasa_neows_api", "https://api.nasa.gov/neo/rest/v1/neo/browse", []),
]
out["terms"] = {}
for name, u, quotes in TERMS:
    s, ct, b, final = get(u, timeout=90)
    tt = text(b)
    out["terms"][name] = {"url": u, "final_url": final, "status": s, "chars": len(tt), "quotes_found_verbatim": {q: (q in tt) for q in quotes},
                          "licence_words_present": sorted(set(w.lower() for w in re.findall(r"(?i)non-commercial|redistribut\w*|creative commons|public domain|copyright", tt)))}
    if s != 200:
        out["terms"][name]["body_start"] = tt[:160]

out["joins"] = J
out["requests"] = NREQ[0]
with open("neo_measure.json", "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print(json.dumps({k: (v if not isinstance(v, dict) else "...") for k, v in out.items()}, indent=1))
print("bytes", os.path.getsize("neo_measure.json"))
