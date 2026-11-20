#!/usr/bin/env python3
"""Round 29 (2026-11-20) screening of the `public-holidays` data type.

Re-fetches live, one request at a time: the GOV.UK bank-holidays JSON, the UK Banking and
Financial Dealings Act 1971 Schedule 1 (legislation.gov.uk XML), the OPM federal holiday
schedules, 5 U.S.C. 6103 (GovInfo), the French jours-feries API and its data.gouv.fr record,
the Australian public-holidays CKAN dataset, the PyPI record of the `holidays` library
(metadata only: the package is not downloaded or executed) and the Nager.Date terms and
robots.txt (the Nager API itself is not called by this script: its terms are RED).
Writes hol_measure.json next to itself. Stdlib only.
"""
import collections, csv, datetime as dt, hashlib, html, io, json, os, random, re, time, urllib.request

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
N = 0
HERE = os.path.dirname(os.path.abspath(__file__))


def get(url, timeout=90):
    global N
    N += 1
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    time.sleep(0.6)
    return body


def text_of(markup):
    t = re.sub(r"(?s)<(script|style)\b.*?</\1>", " ", markup)
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t))).strip()


def norm(name):
    return re.sub(r"[^a-z0-9]+", " ", name.lower().replace("’", "'").replace("'", "")).strip()


MONTHS = {m: i + 1 for i, m in enumerate("January February March April May June July August September October November December".split())}
ORD = {"first": 1, "second": 2, "third": 3, "fourth": 4}
WD = {d: i for i, d in enumerate("Monday Tuesday Wednesday Thursday Friday Saturday Sunday".split())}


def nth_weekday(year, month, weekday, n):
    d = dt.date(year, month, 1)
    d += dt.timedelta((weekday - d.weekday()) % 7)
    return d + dt.timedelta(7 * (n - 1))


def last_weekday(year, month, weekday):
    d = dt.date(year + (month == 12), month % 12 + 1, 1) - dt.timedelta(1)
    return d - dt.timedelta((d.weekday() - weekday) % 7)


def easter(year):
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    g = (b - (b + 8) // 25 + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return dt.date(year, month, day + 1)


out = {"run_date": "2026-11-20", "user_agent": UA}

# ---------------------------------------------------------------- United Kingdom, GOV.UK
uk = json.loads(get("https://www.gov.uk/bank-holidays.json"))
uk_events = {div: [(e["date"], e["title"], e["notes"]) for e in v["events"]] for div, v in uk.items()}
out["uk_gov_bank_holidays"] = {
    "divisions": {div: {"events": len(ev), "first": min(e[0] for e in ev), "last": max(e[0] for e in ev),
                        "with_notes": sum(1 for e in ev if e[2]), "substitute_day_notes": sum(1 for e in ev if "ubstitute" in e[2])}
                  for div, ev in uk_events.items()},
    "events_total": sum(len(ev) for ev in uk_events.values()),
    "distinct_titles": len({norm(e[1]) for ev in uk_events.values() for e in ev}),
    "fields": sorted({k for v in uk.values() for e in v["events"] for k in e}),
}
page = get("https://www.gov.uk/bank-holidays").decode("utf-8", "replace")
out["uk_gov_bank_holidays"]["page_states_ogl_v3"] = "All content is available under the Open Government Licence v3.0, except where otherwise stated" in text_of(page).replace(" ,", ",")

# ---------------------------------------------------------------- UK statute, Schedule 1
act_raw = get("https://www.legislation.gov.uk/ukpga/1971/80/schedule/1/data.xml").decode("utf-8", "replace")
act = text_of(act_raw).replace("’", "'")
paras = {}
for num, div in (("1", "england-and-wales"), ("2", "scotland"), ("3", "northern-ireland")):
    m = re.search(r"\b%s The following are to be bank holidays in [A-Za-z ]+:— (.*?)(?= \d The following| Words in )" % num, act)
    items = [s.strip() for s in re.findall(r"[^.]+\.", m.group(1))]
    paras[div] = items
out["uk_statute_schedule_1"] = {"bytes": len(act_raw), "characters": len(act), "items_per_division": {d: len(v) for d, v in paras.items()},
                                "items": paras, "sha256": hashlib.sha256(act_raw.encode()).hexdigest()}
leg_page = text_of(get("https://www.legislation.gov.uk/ukpga/1971/80/schedule/1").decode("utf-8", "replace"))
out["uk_statute_schedule_1"]["page_states_ogl_v3"] = "All content is available under the Open Government Licence v3.0 except where otherwise stated" in leg_page


def uk_rule_dates(item, year):
    """Dates a Schedule 1 item can designate in `year` (the day itself and any stated alternative)."""
    s = item.rstrip(".")
    dates = set()
    if s.startswith("Easter Monday"):
        dates.add(easter(year) + dt.timedelta(1))
    elif s.startswith("Good Friday"):
        dates.add(easter(year) - dt.timedelta(2))
    m = re.match(r"The (last|first) Monday in (\w+)", s)
    if m:
        dates.add(last_weekday(year, MONTHS[m.group(2)], 0) if m.group(1) == "last" else nth_weekday(year, MONTHS[m.group(2)], 0, 1))
    base = None
    if s.startswith("New Year's Day"):
        base = dt.date(year, 1, 1)
    elif s.startswith("Christmas Day"):
        base = dt.date(year, 12, 25)
    else:
        m = re.match(r"(\d+)(?:st|nd|rd|th) (\w+)", s)
        if m:
            base = dt.date(year, MONTHS[m.group(2)], int(m.group(1)))
    if base:
        cond = re.search(r"in a year in which (\d+)th or (\d+)th December is a Sunday", s)
        if cond:
            if any(dt.date(year, 12, int(x)).weekday() == 6 for x in cond.groups()):
                dates.add(base)
        elif "if it be not a Sunday or, if it be a Sunday," in s:
            alt = re.search(r"if it be a Sunday, (\d+)(?:st|nd|rd|th) (\w+)", s)
            dates.add(base if base.weekday() != 6 else dt.date(year, MONTHS[alt.group(2)], int(alt.group(1))))
        elif "if it is not a Saturday or Sunday" in s:
            dates.add(base if base.weekday() < 5 else base + dt.timedelta(7 - base.weekday()))
        elif "if it be not a Sunday" in s:
            if base.weekday() != 6:
                dates.add(base)
        else:
            dates.add(base)
    return dates


uk_pairs, uk_unmatched = [], collections.Counter()
uk_join = {}
for div, events in uk_events.items():
    hit = 0
    for date, title, notes in events:
        d = dt.date.fromisoformat(date)
        found = [it for it in paras[div] if d in uk_rule_dates(it, d.year)]
        if found:
            hit += 1
            uk_pairs.append({"jurisdiction": "GB/" + div, "list_date": date, "list_title": title, "list_notes": notes, "statute_item": found[0]})
        else:
            uk_unmatched[norm(title)] += 1
    uk_join[div] = {"matched": hit, "total": len(events)}
out["join_uk_statute_rule_to_list"] = {"per_division": uk_join, "matched": sum(v["matched"] for v in uk_join.values()),
                                       "total": sum(v["total"] for v in uk_join.values()),
                                       "unmatched_titles": dict(uk_unmatched.most_common())}

# ---------------------------------------------------------------- United States, OPM
opm_raw = get("https://www.opm.gov/policy-data-oversight/pay-leave/federal-holidays/").decode("utf-8", "replace")
opm_rows = []
for cap, body in re.findall(r"(?s)<caption>(\d{4}) Holiday Schedule</caption>(.*?)</table>", opm_raw):
    year = int(cap)
    for tr in re.findall(r"(?s)<tr>(.*?)</tr>", body):
        cells = [text_of(c) for c in re.findall(r"(?s)<td[^>]*>(.*?)</td>", tr)]
        if len(cells) != 2:
            continue
        m = re.match(r"(\w+), (\w+) (\d+)", cells[0])
        date = None
        for y in (year, year - 1, year + 1):
            cand = dt.date(y, MONTHS[m.group(2)], int(m.group(3)))
            if cand.weekday() == WD[m.group(1)]:
                date = cand
                break
        opm_rows.append({"schedule_year": year, "date": date.isoformat() if date else None, "holiday": cells[1], "footnoted": "*" in cells[0]})
years = sorted({r["schedule_year"] for r in opm_rows})
out["us_opm_federal_holidays"] = {"bytes": len(opm_raw), "schedule_years": [years[0], years[-1]], "schedules": len(years), "rows": len(opm_rows),
                                  "rows_without_resolved_date": sum(1 for r in opm_rows if not r["date"]),
                                  "footnoted_rows": sum(1 for r in opm_rows if r["footnoted"]),
                                  "distinct_holiday_names": sorted({r["holiday"].replace("’", "'") for r in opm_rows}),
                                  "ics_link_present": "federal-holidays/holidays.ics" in opm_raw}

# ---------------------------------------------------------------- United States, 5 U.S.C. 6103
usc_raw = get("https://www.govinfo.gov/link/uscode/5/6103?type=usc&year=mostrecent&link-type=html").decode("utf-8", "replace")
usc = text_of(usc_raw)
sub_a = re.search(r"\(a\) The following are legal public holidays: (.*?) \(b\)", usc).group(1)
statute = []
for name, rule in re.findall(r"\s*(.+?), ((?:the \w+ \w+ in )?(?:%s)(?: \d+)?)\." % "|".join(MONTHS), sub_a):
    statute.append({"name": name.strip(), "rule": rule})
edition = re.search(r"United States Code, (\d{4}) Edition", usc)
out["us_statute_5usc6103"] = {"bytes": len(usc_raw), "characters": len(usc), "edition": edition.group(1) if edition else None,
                              "subsection_a_holidays": statute, "sha256": hashlib.sha256(usc_raw.encode()).hexdigest(),
                              "mentions_inauguration_day": "Inauguration Day" in usc, "mentions_saturday_rule": "occurs on a Saturday" in usc}
pol = text_of(get("https://www.govinfo.gov/about/policies").decode("utf-8", "replace"))
out["us_statute_5usc6103"]["govinfo_policy_quote_present"] = "Copyright protection under this title is not available for any work of the United States Government" in pol


def us_rule_date(rule, year):
    m = re.match(r"the (\w+) (\w+) in (\w+)", rule)
    if m:
        wd, mon = WD[m.group(2)], MONTHS[m.group(3)]
        return last_weekday(year, mon, wd) if m.group(1) == "last" else nth_weekday(year, mon, wd, ORD[m.group(1)])
    m = re.match(r"(\w+) (\d+)", rule)
    return dt.date(year, MONTHS[m.group(1)], int(m.group(2)))


def observed(d):  # 6103(b)(1) Saturday -> Friday; Executive Order 11582 Sunday -> Monday
    return d - dt.timedelta(1) if d.weekday() == 5 else d + dt.timedelta(1) if d.weekday() == 6 else d


us_pairs, us_unmatched = [], collections.Counter()
name_only = 0
for r in opm_rows:
    if not r["date"]:
        us_unmatched[r["holiday"].replace("\u2019", "'") + " (date not resolved)"] += 1
        continue
    d = dt.date.fromisoformat(r["date"])
    hit = None
    for s in statute:
        if norm(s["name"]) != norm(r["holiday"]):
            continue
        name_only += 1
        for y in (d.year, d.year + 1):
            if observed(us_rule_date(s["rule"], y)) == d:
                hit = s
        break
    if hit:
        us_pairs.append({"jurisdiction": "US", "list_date": r["date"], "list_title": r["holiday"], "list_notes": "footnoted" if r["footnoted"] else "",
                         "statute_item": "%s, %s." % (hit["name"], hit["rule"])})
    else:
        us_unmatched[r["holiday"].replace("’", "'")] += 1
out["join_us_statute_rule_to_list"] = {"matched": len(us_pairs), "total": len(opm_rows), "rows_whose_name_equals_a_statute_name": name_only,
                                       "unmatched_holidays": dict(us_unmatched.most_common())}

# ---------------------------------------------------------------- France
fr = {}
for zone in ("metropole", "alsace-moselle"):
    data = json.loads(get("https://calendrier.api.gouv.fr/jours-feries/%s.json" % zone))
    fr[zone] = {"days": len(data), "first": min(data), "last": max(data), "distinct_names": len(set(data.values())),
                "per_year_2026": sum(1 for d in data if d.startswith("2026"))}
dg = json.loads(get("https://www.data.gouv.fr/api/1/datasets/jours-feries-en-france/"))
fr_csv = get("https://etalab.github.io/jours-feries-france-data/csv/jours_feries_metropole.csv").decode("utf-8")
rows = list(csv.DictReader(io.StringIO(fr_csv)))
out["fr_jours_feries"] = {"api_zones_fetched": fr, "datagouv": {"license": dg.get("license"), "last_modified": dg.get("last_modified"),
                          "organization": (dg.get("organization") or {}).get("name"), "resources": len(dg.get("resources", []))},
                          "csv_metropole": {"rows": len(rows), "first": rows[0]["date"], "last": rows[-1]["date"], "columns": list(rows[0])}}
lo = get("https://raw.githubusercontent.com/etalab/licence-ouverte/master/open-licence.md").decode("utf-8", "replace")
out["fr_jours_feries"]["open_licence_mentions_commercial_use"] = "for commercial purposes" in re.sub(r"\s+", " ", lo)

# ---------------------------------------------------------------- Australia
ck = json.loads(get("https://data.gov.au/data/api/3/action/package_show?id=australian-holidays-machine-readable-dataset"))["result"]
res = sorted(ck["resources"], key=lambda r: r.get("last_modified") or "")
combined = next(r for r in ck["resources"] if "combined" in r["name"].lower())
au_csv = get(combined["url"]).decode("utf-8-sig", "replace")
au = list(csv.DictReader(io.StringIO(au_csv)))
out["au_public_holidays"] = {"license_id": ck["license_id"], "license_title": ck["license_title"], "organization": ck["organization"]["title"],
                             "metadata_modified": ck["metadata_modified"], "resources": len(ck["resources"]),
                             "newest_resource": {"name": res[-1]["name"], "last_modified": res[-1].get("last_modified")},
                             "combined_csv": {"name": combined["name"], "rows": len(au), "columns": list(au[0]),
                                              "rows_without_date": sum(1 for r in au if not r["Date"].strip()), "first": min(r["Date"] for r in au if r["Date"].strip()), "last": max(r["Date"] for r in au),
                                              "by_jurisdiction": dict(collections.Counter(r["Jurisdiction"].lower() for r in au).most_common()),
                                              "rows_with_information_text": sum(1 for r in au if (r.get("Information") or "").strip())}}

# ---------------------------------------------------------------- `holidays` library (metadata only)
py = json.loads(get("https://pypi.org/pypi/holidays/json"))
stable = sorted((v[0]["upload_time"][:10], k) for k, v in py["releases"].items() if v and re.fullmatch(r"[\d.]+", k))
out["vacanza_holidays_library"] = {"version": py["info"]["version"], "license": py["info"].get("license") or py["info"].get("license_expression"),
                                   "stable_releases": len(stable), "stable_releases_last_365_days": sum(1 for s in stable if s[0] >= "2025-11-20"),
                                   "newest_stable": list(stable[-1]), "wheel": [{"filename": u["filename"], "bytes": u["size"], "sha256": u["digests"]["sha256"]} for u in py["urls"] if u["filename"].endswith(".whl")],
                                   "note": "metadata only; the package was not downloaded or executed, so its dates were not compared"}
mit = get("https://raw.githubusercontent.com/vacanza/holidays/dev/LICENSE").decode("utf-8", "replace")
out["vacanza_holidays_library"]["license_file_grants_sublicense_and_sell"] = "sublicense, and/or sell" in re.sub(r"\s+", " ", mit)

# ---------------------------------------------------------------- Nager.Date (terms only)
tos = text_of(get("https://nagerholidays.com/legal/termsofservice").decode("utf-8", "replace"))
robots = get("https://nagerholidays.com/robots.txt").decode("utf-8", "replace")
out["nager_date"] = {"terms_last_updated": (re.search(r"Last Updated: (\d{4}-\d{2}-\d{2})", tos) or [None, None])[1],
                     "terms_require_sponsorship_for_commercial_use": "For commercial purposes we require active sponsorship." in tos,
                     "terms_forbid_own_holiday_portal": "It is not allowed to use the holiday information to publish or operate your own holiday portal." in tos,
                     "robots_disallows_api": "Disallow: /api/v" in robots,
                     "note": "API not called by this script"}

# ---------------------------------------------------------------- hand-check sample (seeded)
rng = random.Random(20261120)
sample = rng.sample(us_pairs, 10) + rng.sample(uk_pairs, 10)
out["handcheck_sample"] = sample
out["requests"] = N
json.dump(out, open(os.path.join(HERE, "hol_measure.json"), "w"), indent=1, sort_keys=True, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k != "handcheck_sample"}, indent=1, ensure_ascii=False)[:9000])
print(json.dumps(sample, indent=0, ensure_ascii=False))
