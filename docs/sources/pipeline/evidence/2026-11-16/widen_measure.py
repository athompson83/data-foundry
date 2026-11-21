#!/usr/bin/env python3
"""Screening 2026-11-16 (widening food-and-health-recalls-global): UK MHRA drug and device alerts.
Fetches every source live (stdlib only).
Run from this directory with: python3 -I widen_measure.py [--cache DIR]   -> writes widen_measure.json
Output holds alert references, organisation (firm) names, product names, identifiers and counts only.
Company contact lines in alert bodies (emails, phones) are counted, never written.

Member candidate:
  MHRA drug and device alerts on GOV.UK (format medical_safety_alert, finder /drug-device-alerts):
  GOV.UK search API for the full index + GOV.UK content API per alert (HTML body with DMRC reference,
  PL numbers, SNOMED codes, GTINs and batch tables for medicines recalls).
Join (mode candidate; pairs written for hand-checking):
  MHRA medicines recall / device safety alert -> openFDA drug or device enforcement report (LIVE fda-recalls)
  by recalling-firm core token + a shared distinctive product token + FDA recall initiation within
  -365..+180 days of the MHRA issue date.
Also: MHRA alert bodies citing the FDA or Health Canada; a declared check of MHRA GTINs against FDA code_info.
"""
import json, os, re, sys, time, html as H, urllib.request, urllib.parse, datetime as dt
from collections import Counter

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
CACHE = sys.argv[sys.argv.index("--cache") + 1] if "--cache" in sys.argv else None
out = {"run_date": time.strftime("%Y-%m-%d")}
NREQ = [0]


def get(u, tries=3, timeout=120):
    key = None
    if CACHE:
        os.makedirs(CACHE, exist_ok=True)
        key = os.path.join(CACHE, re.sub(r"[^A-Za-z0-9]+", "_", u)[-180:])
        if os.path.exists(key):
            return 200, open(key, "rb").read()
    for i in range(tries):
        try:
            NREQ[0] += 1
            r = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(r, timeout=timeout) as f:
                b = f.read()
                if key:
                    open(key, "wb").write(b)
                return f.status, b
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, str(e).encode()
            time.sleep(5)
        finally:
            time.sleep(0.3)


def gtin_ok(s):
    if not re.fullmatch(r"\d{8}|\d{12}|\d{13}|\d{14}", s):
        return False
    d = [int(c) for c in s]
    tot = sum(v * (3 if i % 2 == 0 else 1) for i, v in enumerate(reversed(d[:-1])))
    return (10 - tot % 10) % 10 == d[-1]


def text(h):
    h = re.sub(r"<(br|/p|/tr|/h\d|/li|/td|/th)[^>]*>", "\n", h or "")
    return H.unescape(re.sub(r"<[^>]+>", " ", h))


# ---------------------------------------------------------------- 1. GOV.UK search index
FIELDS = "title,link,alert_type,issued_date,public_timestamp,description,medical_specialism"
alerts = []
for start in range(0, 5000, 1000):
    st, b = get(f"https://www.gov.uk/api/search.json?filter_format=medical_safety_alert&count=1000&start={start}&order=-public_timestamp&fields={FIELDS}")
    d = json.loads(b)
    alerts += d["results"]
    if start + 1000 >= d["total"]:
        break
out["mhra_total"] = d["total"]
out["mhra_fetched"] = len(alerts)
out["mhra_by_alert_type"] = dict(Counter(",".join(a.get("alert_type") or ["none"]) for a in alerts).most_common())


def klass(t):
    m = re.search(r"class\s*([1-4])", t, re.I)
    return m.group(1) if m else None


def kind(a):
    t, at = a["title"], (a.get("alert_type") or [""])[0]
    if at == "medicines-recall-notification":
        if re.search(r"company[- ]led", t, re.I):
            return "medicines: company-led recall"
        k = klass(t)
        if k and re.search(r"recall", t, re.I):
            return f"medicines: class {k} recall"
        if k:
            return f"medicines: class {k} defect notification/information"
        return "medicines: other notification"
    return at


out["mhra_by_kind"] = dict(Counter(kind(a) for a in alerts).most_common())
dates = sorted(a.get("issued_date") or a["public_timestamp"][:10] for a in alerts)
out["mhra_issued_range"] = [dates[0], dates[-1]]
out["mhra_by_year"] = dict(sorted(Counter(x[:4] for x in dates).items()))
newest = max(alerts, key=lambda a: a["public_timestamp"])
out["mhra_newest"] = {"public_timestamp": newest["public_timestamp"], "issued_date": newest.get("issued_date"), "title": newest["title"], "link": newest["link"]}
out["mhra_title_refs"] = {
    "EL(yy)A/n medicines alert reference": sum(1 for a in alerts if re.search(r"EL\s*\(\s*\d\d\s*\)\s*A\s*/\s*\d+", a["title"])),
    "DSI/yyyy/n device safety information reference": sum(1 for a in alerts if re.search(r"DSI\s*/?\s*\d{4}\s*/\s*\d+", a["title"])),
    "NatPSA reference": sum(1 for a in alerts if re.search(r"NatPSA", a["title"])),
}

# ---------------------------------------------------------------- 2. content API per alert (medicines + DSI since 2024)
SINCE = "2024-01-01"
target = [a for a in alerts if (a.get("issued_date") or "") >= SINCE and (a.get("alert_type") or [""])[0] in ("medicines-recall-notification", "device-safety-information", "national-patient-safety")]
# FSN weekly lists issued in the first half of 2026 (old enough for the FDA classification lag)
fsn_recent = sorted([a for a in alerts if (a.get("alert_type") or [""])[0] == "field-safety-notices" and "2026-01-01" <= (a.get("issued_date") or "") <= "2026-06-30"], key=lambda a: a.get("issued_date") or "")
out["content_sample"] = {"since": SINCE, "alerts": len(target), "fsn_weekly_lists": len(fsn_recent)}
recs = []
fld = Counter()
contact_lines = 0
cites = []
for a in target + fsn_recent:
    st, b = get("https://www.gov.uk/api/content" + a["link"])
    if st != 200:
        fld["content_http_" + str(st)] += 1
        continue
    c = json.loads(b)
    body = c.get("details", {}).get("body", "") or ""
    tx = text(body)
    contact_lines += len(re.findall(r"mailto:|telephone|tel\.?\s*[:+0-9]", body, re.I))
    r = {
        "link": a["link"], "title": a["title"].strip(), "kind": kind(a), "issued_date": a.get("issued_date"),
        "description": (a.get("description") or "").strip(),
        "el_ref": (re.search(r"EL\s*\(\s*\d\d\s*\)\s*A\s*/\s*\d+", a["title"]) or [None])[0],
        "dsi_ref": (re.search(r"DSI\s*/?\s*\d{4}\s*/\s*\d+", a["title"]) or [None])[0],
        "dmrc": sorted(set(re.findall(r"DMRC-\d+", tx))),
        "pl": sorted(set(re.sub(r"\s+", " ", x) for x in re.findall(r"\b(?:PL|PLGB|PLNI|PA|EU/\d/\d\d/\d+|THR|NR)\s*:?\s*\d{4,5}\s*/\s*\d{4,5}", tx))),
        "snomed": sorted(set(re.findall(r"SNOMED[^0-9]{0,20}(\d{6,20})", tx))),
        "gtin": sorted(set(g for g in re.findall(r"\b\d{8,14}\b", " ".join(re.findall(r"GTIN[^\n]{0,80}", tx))) if gtin_ok(g))),
        "batch_rows": len(re.findall(r"<tr>", body)),
        "attachments": len(c.get("details", {}).get("attachments", []) or []),
        "change_history": len(c.get("details", {}).get("change_history", []) or []),
        "mah": None,
    }
    m = re.search(r"Marketing Authori[sz]ation Holder\s*\n+\s*([^\n]+)", tx)
    if m:
        r["mah"] = m.group(1).strip()
    for k in ("dmrc", "pl", "snomed", "gtin", "el_ref", "dsi_ref", "mah"):
        if r[k]:
            fld[k] += 1
    if r["batch_rows"]:
        fld["batch_table"] += 1
    if r["kind"] == "field-safety-notices":
        ents = []
        for blk in re.split(r"(?=<h3)", body)[1:]:
            h = re.search(r"<h3[^>]*>(.*?)</h3>", blk, re.S)
            if not h:
                continue
            head = H.unescape(re.sub(r"<[^>]+>", "", h.group(1))).strip()
            mf, _, dev = head.partition(":")
            refs = sorted(set(re.findall(r"\b(\d{4}/\d{3}/\d{3}/\d{3}/\d{3})\b", blk)))
            ents.append({"manufacturer": mf.strip(), "device": dev.strip(), "mhra_refs": refs, "detail": re.sub(r"\s+", " ", text(re.sub(r"<h3.*?</h3>", "", blk, flags=re.S)))[:300]})
        r["fsn_entries"] = ents
    for agency, pat in (("FDA", r"\bFDA\b|Food and Drug Administration"), ("Health Canada", r"Health Canada"), ("TGA", r"\bTGA\b|Therapeutic Goods Administration"), ("EMA", r"\bEMA\b|European Medicines Agency")):
        if re.search(pat, tx):
            ctx = re.search(r"[^.\n]{0,160}(?:" + pat + r")[^.\n]{0,160}", tx).group(0).strip()
            cites.append({"link": a["link"], "issued_date": r["issued_date"], "agency": agency, "context": re.sub(r"\S+@\S+", "[email]", ctx)})
    r["text"] = tx
    recs.append(r)
alerts_c = [r for r in recs if r["kind"] != "field-safety-notices"]
out["content_fields"] = {"fetched": len(alerts_c), **{k: v for k, v in fld.items()}}
out["content_contact_lines_counted_not_written"] = contact_lines
fsn_lists = [r for r in recs if r["kind"] == "field-safety-notices"]
out["fsn_weekly_lists_2026h1"] = {"lists": len(fsn_lists), "entries": sum(len(r["fsn_entries"]) for r in fsn_lists),
    "entries_with_mhra_reference": sum(1 for r in fsn_lists for e in r["fsn_entries"] if e["mhra_refs"]),
    "per_list": [{"link": r["link"], "issued_date": r["issued_date"], "entries": len(r["fsn_entries"])} for r in fsn_lists]}
out["citations_of_other_agencies"] = cites
out["citations_by_agency"] = dict(Counter(c["agency"] for c in cites))
out["sample_records"] = [{k: r[k] for k in ("link", "kind", "issued_date", "el_ref", "dsi_ref", "dmrc", "pl", "snomed", "gtin", "mah", "batch_rows")} for r in alerts_c[:5]]

# ---------------------------------------------------------------- 3. openFDA drug + device enforcement since 2023-01-01
fda = []
for prod in ("drug", "device"):
    skip, total = 0, None
    while True:
        st, b = get(f"https://api.fda.gov/{prod}/enforcement.json?search=report_date:%5B20230101+TO+20261231%5D&limit=1000&skip={skip}")
        d = json.loads(b)
        total = d["meta"]["results"]["total"]
        for x in d["results"]:
            x["_p"] = prod
        fda += d["results"]
        skip += 1000
        if skip >= total:
            break
    out[f"openfda_{prod}_since_2023"] = total
out["openfda_last_updated"] = d["meta"]["last_updated"]
out["openfda_device_rows_naming_uk_distribution"] = sum(1 for x in fda if x["_p"] == "device" and re.search(r"United Kingdom|\bUK\b|England|Great Britain", x.get("distribution_pattern", "")))

# declared check: MHRA GTINs in FDA code_info / product_description (GTIN-13 vs UPC/GTIN-14 by stripping leading zeros)
fda_digits = set()
for x in fda:
    for g in re.findall(r"\d{8,14}", (x.get("code_info", "") + " " + x.get("product_description", "")).replace("-", "")):
        fda_digits.add(g.lstrip("0"))
mg = [(r["link"], g) for r in alerts_c for g in r["gtin"]]
out["declared_gtin_check"] = {"mhra_gtins": len(mg), "alerts_with_gtin": sum(1 for r in alerts_c if r["gtin"]), "found_in_openfda": [x for x in mg if x[1].lstrip("0") in fda_digits]}

# ---------------------------------------------------------------- 4. candidate join
STOP_FIRM = set("inc llc ltd limited corp corporation co company plc gmbh ag sa spa bv nv uk usa us the and of pharmaceuticals pharmaceutical pharma healthcare health medical international group holdings laboratories laboratory labs products industries services europe global".split())
STOP_PROD = set("""tablets tablet capsules capsule injection solution suspension film coated oral cream ointment infusion powder concentrate
 prolonged release modified hard gastro resistant syrup drops sterile single dose doses containers container bottle bottles vials vial ampoules
 syringe syringes pre filled prefilled pack packs strength strengths batch batches medicines medicine recall class defect notification information
 update company products product device devices system systems specific stock patients patient after units affected manufactured various
 water sodium chloride potassium hydrochloride usp""".split())


def toks(s, stop, n=4):
    return [w for w in re.findall(r"[a-z][a-z0-9]+", (s or "").lower()) if len(w) >= n and w not in stop]


def firm_of(r):
    if r["mah"]:
        return r["mah"]
    m = re.match(r"\s*(?:UPDATE:\s*)?(?:Class \d[^:]*|Company[- ]led[^:]*):\s*([^,]+),", r["title"], re.I)
    return m.group(1) if m else r["title"].split(":")[0]


def d8(s):
    return dt.date(int(s[:4]), int(s[4:6]), int(s[6:8]))


def prod_tokens(r, ft):
    t = re.sub(r"EL\s*\(.*$", "", r["title"])
    t = t.split(":", 1)[1] if ":" in t else t
    extra = " ".join(re.findall(r"Active ingredients?:\s*([^\n]+)", r["text"]))
    return set(toks(t + " " + extra, STOP_PROD | STOP_FIRM | set(ft), 5))


def match(units, want, lo, hi):
    pairs = []
    for u in units:
        ft = toks(u["firm"], STOP_FIRM, 3)
        if not ft:
            continue
        pt = u["ptoks"] - set(ft)
        idate = dt.date.fromisoformat(u["date"])
        best = []
        for x in fda:
            if x["_p"] != want:
                continue
            xf = toks(x.get("recalling_firm"), STOP_FIRM, 3)
            if not xf or xf[0] != ft[0]:
                continue
            shared = pt & set(toks(x.get("product_description", ""), set(), 5))
            if not shared:
                continue
            delta = (d8(x.get("recall_initiation_date") or x["report_date"]) - idate).days
            if lo <= delta <= hi:
                best.append((len(shared), -abs(delta), x, sorted(shared), delta))
        if best:
            best.sort(key=lambda t: (t[0], t[1]), reverse=True)
            n, _, x, shared, delta = best[0]
            pairs.append({**u["out"], "fda_recall_number": x["recall_number"], "fda_event_id": x.get("event_id"), "fda_firm": x["recalling_firm"],
                "fda_initiation": x.get("recall_initiation_date"), "fda_report_date": x["report_date"], "fda_classification": x["classification"],
                "fda_product": x["product_description"][:300], "fda_reason": x["reason_for_recall"][:300],
                "fda_distribution": x.get("distribution_pattern", "")[:160], "shared_tokens": shared,
                "days_fda_initiation_minus_mhra": delta, "other_fda_rows_for_unit": len(best) - 1})
    return pairs


med_units = []
for r in alerts_c:
    ft = toks(firm_of(r), STOP_FIRM, 3)
    med_units.append({"firm": firm_of(r), "date": r["issued_date"], "ptoks": prod_tokens(r, ft),
        "out": {"side": "alert", "mhra_link": r["link"], "mhra_ref": r["el_ref"] or r["dsi_ref"], "mhra_kind": r["kind"], "mhra_issued": r["issued_date"],
                "mhra_firm": firm_of(r).strip(), "mhra_title": r["title"], "mhra_description": r["description"][:300]}})
drug_units = [u for u in med_units if u["out"]["mhra_kind"].startswith("medicines")]
dev_units = [u for u in med_units if not u["out"]["mhra_kind"].startswith("medicines")]
fsn_units = []
for r in fsn_lists:
    for e in r["fsn_entries"]:
        fsn_units.append({"firm": e["manufacturer"], "date": r["issued_date"], "ptoks": set(toks(e["device"] + " " + e["detail"], STOP_PROD | STOP_FIRM, 5)),
            "out": {"side": "fsn", "mhra_link": r["link"], "mhra_ref": ",".join(e["mhra_refs"]), "mhra_kind": "field-safety-notice entry", "mhra_issued": r["issued_date"],
                    "mhra_firm": e["manufacturer"], "mhra_title": e["device"], "mhra_description": e["detail"]}})
pairs = match(drug_units, "drug", -365, 180) + match(dev_units, "device", -365, 180) + match(fsn_units, "device", -120, 120)
out["candidate_join"] = {
    "rule": "recalling firm core token equal + >=1 shared product token (>=5 letters from the title product part and active ingredient, or the FSN device heading and detail; generic dosage-form words removed) + FDA recall initiation within -365..+180 days of the MHRA alert date (FSN entries: -120..+120 days of the weekly list date); best-scoring FDA row per MHRA unit",
    "fda_rows": len(fda),
    "medicines_alerts": len(drug_units), "medicines_alerts_with_pair": sum(1 for p in pairs if p["side"] == "alert" and p["mhra_kind"].startswith("medicines")),
    "device_alerts": len(dev_units), "device_alerts_with_pair": sum(1 for p in pairs if p["side"] == "alert" and not p["mhra_kind"].startswith("medicines")),
    "fsn_entries": len(fsn_units), "fsn_entries_with_pair": sum(1 for p in pairs if p["side"] == "fsn"),
}
out["candidate_pairs"] = pairs
# ---------------------------------------------------------------- 5. terms read live (GOV.UK/OGL for MHRA; second-source screens HSA and HPRA)
def page_text(u):
    st, b = get(u)
    t = b.decode("utf-8", "replace")
    t = re.sub(r"(?s)<script.*?</script>|<style.*?</style>", "", t)
    return st, re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", t)))


TERMS = [
    ("MHRA via GOV.UK", "https://www.gov.uk/help/terms-conditions", "You can reproduce content published on GOV.UK under the OGL as long as you follow the licence’s conditions."),
    ("MHRA via GOV.UK", "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/", "exploit the Information commercially and non-commercially for example, by combining it with other Information, or by including it in your own product or application."),
    ("Singapore HSA", "https://www.hsa.gov.sg/terms-of-use/", "In particular, the reproduction or use of information or material from this Website for commercial purposes, or to advertise or promote the sale of any product or service, is prohibited."),
    ("Ireland HPRA", "https://www.hpra.ie/terms-of-use", "You agree not to reproduce, duplicate, copy, republish, redistribute, transmit, alter, edit, re-sell, engage in any large scale collecting or harvesting of data (whether by automated or manual means) for commercial means, or otherwise exploit any part of our website in contravention of the provisions of these terms without the express written permission of the HPRA."),
]
out["terms_checked"] = []
for who, u, q in TERMS:
    st, t = page_text(u)
    out["terms_checked"].append({"publisher": who, "url": u, "http": st, "quote_found_verbatim": q in t, "quote": q})
st, t = page_text("https://www.hpra.ie/safety-information/safety-notices")
out["hpra_safety_notices_page"] = {"http": st, "client_side_listing_endpoint_seen": "safety-notices/safetynotices?$select=" in get("https://www.hpra.ie/safety-information/safety-notices")[1].decode("utf-8", "replace")}
out["requests"] = NREQ[0]
json.dump(out, open("widen_measure.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: v for k, v in out.items() if k not in ("candidate_pairs", "citations_of_other_agencies", "sample_records", "fsn_weekly_lists_2026h1")}, indent=1))
print(len(pairs), "pairs;", len(cites), "citations")
