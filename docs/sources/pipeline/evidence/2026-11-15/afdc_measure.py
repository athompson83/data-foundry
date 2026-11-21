#!/usr/bin/env python3
"""Screening 2026-11-15: electrical-afdc-ev-stations (DISCOVERED -> SCREENED). Fetches every source live (stdlib only).
Run from this directory with: python3 -I afdc_measure.py   -> writes afdc_measure.json
Output holds page statuses, field names, terms text and annual station counts only."""
import io, json, re, time, html, zipfile, urllib.request

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}


def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA}), timeout=60) as f:
            return f.status, f.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()
    except Exception as e:
        return 0, str(e).encode()


def flat(b):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", b.decode("utf8", "replace"), flags=re.S)
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", t)).split())


# 1. Download page: the bulk route is a form that asks for name, email and terms acceptance (no login, no CAPTCHA seen).
s, b = get("https://afdc.energy.gov/data_download")
t = b.decode("utf8", "replace")
form = re.search(r'<form[^>]*action="/data_download".*?</form>', t, re.S)
names = sorted(set(re.findall(r'name="([^"]+)"', form.group(0)))) if form else []
m = re.search(r'id="terms-modal".*?(These data and software code.*?)</p>', t, re.S)
terms = flat(m.group(1).encode()) if m else None
out["data_download"] = {"status": s, "form_fields": [n for n in names if "registration" in n or "format" in n],
                        "captcha_markers": bool(re.search(r"recaptcha|hcaptcha|turnstile", t, re.I)),
                        "terms_first_sentence": terms[:420] if terms else None}

# 2. Field reference for the station download.
s, b = get("https://afdc.energy.gov/data_download/alt_fuel_stations_format")
t = b.decode("utf8", "replace")
out["format_page"] = {"status": s, "fields_mentioned": {f: (f in t) for f in (
    "ev_pricing", "ev_network", "ev_connector_types", "ev_level2_evse_num", "ev_dc_fast_num", "facility_type",
    "date_last_confirmed", "updated_at", "open_date", "nps_unit_name", "access_days_time", "id")}}

# 3. Annual historical station counts workbook (the only open bulk file found without the API).
s, b = get("https://afdc.energy.gov/files/docs/historical-station-counts.xlsx")
wb = {"status": s, "bytes": len(b)}
if s == 200:
    z = zipfile.ZipFile(io.BytesIO(b))
    wb["sheets"] = re.findall(r'<sheet [^>]*name="([^"]+)"', z.read("xl/workbook.xml").decode())
    ss = re.findall(r"<si>(.*?)</si>", z.read("xl/sharedStrings.xml").decode(), re.S)
    ss = [html.unescape("".join(re.findall(r"<t[^>]*>([^<]*)</t>", x))) for x in ss]
    wb["shared_strings_sample"] = ss[:12]
    rels = z.read("xl/_rels/workbook.xml.rels").decode()
    rid = re.search(r'<sheet [^>]*name="2025"[^>]*r:id="([^"]+)"', z.read("xl/workbook.xml").decode()).group(1)
    target = (re.search(r'Id="' + rid + r'"[^>]*Target="([^"]+)"', rels) or re.search(r'Target="([^"]+)"[^>]*Id="' + rid + '"', rels)).group(1)
    rows = []
    for row in re.findall(r"<row[^>]*>(.*?)</row>", z.read("xl/" + target.replace("/xl/", "").lstrip("/")).decode(), re.S):
        vals = []
        for attrs, body in re.findall(r"<c ([^>]*)>(.*?)</c>", row, re.S):
            v = re.search(r"<v>([^<]*)</v>", body)
            v = v.group(1) if v else ""
            vals.append(ss[int(v)] if 't="s"' in attrs and v else v)
        rows.append(vals)
    header = next(r for r in rows if r and r[0] == "State")
    wb["sheet_2025_header"] = header
    wb["sheet_2025_state_rows"] = sum(1 for r in rows if len(r) == len(header) and r[0] not in ("State", "Total", "TOTAL"))
    wb["sheet_2025_total_row"] = next((r for r in rows if r and r[0].strip().lower() == "total"), None)
out["historical_counts_xlsx"] = wb

# 4. The API host (needs an api.data.gov key; DEMO_KEY is the documented public key).
s, b = get("https://developer.nrel.gov/api/alt-fuel-stations/v1/last-month.json?api_key=DEMO_KEY&fuel_type=ELEC&limit=1")
out["api_last_month"] = {"status": s, "body_head": b[:200].decode("utf8", "replace")}
try:
    d = json.loads(b)
    out["api_last_month"]["total_results"] = d.get("total_results")
except Exception:
    pass

json.dump(out, open("afdc_measure.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps(out, ensure_ascii=False)[:2500])
