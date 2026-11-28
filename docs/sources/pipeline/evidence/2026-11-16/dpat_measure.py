#!/usr/bin/env python3
"""Screening 2026-11-16: drug-patent-listings. Fetches every source live (stdlib only).
Run from this directory with: python3 -I dpat_measure.py   -> writes dpat_measure.json
Output holds patent numbers, application numbers, DINs, brand/ingredient names, organisation names and counts only.
Health Canada register contact columns (person names, titles, addresses, phones) are counted, never written.

Members:
  FDA Orange Book data files (products.txt, patent.txt, exclusivity.txt), www.fda.gov/media/76860/download.
  FDA Purple Book patent list (BPPT, biologics), purplebooksearch.fda.gov + monthly data CSV on accessdata.fda.gov.
  Health Canada Patent Register open-data export (Patent.zip, OGL-Canada), pr-rdb.hc-sc.gc.ca.
  Health Canada Drug Product Database API (DIN lookups), health-products.canada.ca.
  CIPO patent bulk data (bibliographic + claims text, OGL-Canada), opic-cipo.ca.
Joins:
  Health Canada register patent number -> CIPO PT_main patent number (declared, Canadian patent number).
  Health Canada register patent number in 2,950,001-3,000,000 -> CIPO claims file (declared).
  Health Canada register DIN -> Drug Product Database (declared, DIN), 40 sampled DINs.
  Orange Book trade name -> Health Canada register brand name, same active moiety (candidate; hand-check file).
Also probes USPTO (Open Data Portal API, PatentsView) for the US full-text member.
"""
import collections, csv, datetime, io, json, re, ssl, time, unicodedata, urllib.request, urllib.error, zipfile
import html as H

INTERMEDIATES = """
-----BEGIN CERTIFICATE-----
MIIGNjCCBB6gAwIBAgIRAIIHau9WPYiNkOddhKBQHE0wDQYJKoZIhvcNAQEMBQAw
XzELMAkGA1UEBhMCR0IxGDAWBgNVBAoTD1NlY3RpZ28gTGltaXRlZDE2MDQGA1UE
AxMtU2VjdGlnbyBQdWJsaWMgU2VydmVyIEF1dGhlbnRpY2F0aW9uIFJvb3QgUjQ2
MB4XDTI0MTIxMTAwMDAwMFoXDTI3MTIxMDIzNTk1OVowUTELMAkGA1UEBhMCQ0Ex
GDAWBgNVBAoTD0VudHJ1c3QgTGltaXRlZDEoMCYGA1UEAxMfRW50cnVzdCBPViBU
TFMgSXNzdWluZyBSU0EgQ0EgMjCCAaIwDQYJKoZIhvcNAQEBBQADggGPADCCAYoC
ggGBAKo4ANoGIiqBGhTl3Wb2KYyxA/2xdrUR6VP+yFWqlm6BKHKib/XHiiE8UmZO
iUQzSWNXKWNRwuVrzq1gzFKLfU8FiV9rCRd+uW5JpzxLVO7Ojzpxj6/9P3oYpiO6
3T51mxqiEv9c2wKrO8aY3d4v/FnzTcbytQI2W4a2vKq+ZV/61Ph3+a26Y16KJMWg
LKKeRNEsOxoa/qr7ro8T0/6CzQhxKnVeuJMsOiVV45WqhFmUUx0FOFbH9wbPG7Fj
ddpkHGUxtdy433BVKvnwbemXDCHy+L1PhidcX3k+vYYD4xbuC3xApQcNBahpn6pG
9AGbbs5vjvs7LAFkewYG+NYH3JcF4f5sPhOFwlEoivxro57coEWzvIheq3dp8U3r
/8GyeK6cWK0fp+0w0JhckdKzMUo0Fxi2dlXsmcRch/Borkh9PXv3NGzs5/gmOYcO
Pa+46gyrlSHr4t7miFahk0Fpii8kBIZ1fBS/J0O4s85e9zgfMhZv0W5A2reGQQjB
9JFO/QIDAQABo4IBeTCCAXUwHwYDVR0jBBgwFoAUVnNYZJX5khqwEioEYnmhQBWI
IUkwHQYDVR0OBBYEFBfRrwB0+VX7UjfYhHYLWxKKUFrFMA4GA1UdDwEB/wQEAwIB
hjASBgNVHRMBAf8ECDAGAQH/AgEAMB0GA1UdJQQWMBQGCCsGAQUFBwMBBggrBgEF
BQcDAjATBgNVHSAEDDAKMAgGBmeBDAECAjBUBgNVHR8ETTBLMEmgR6BFhkNodHRw
Oi8vY3JsLnNlY3RpZ28uY29tL1NlY3RpZ29QdWJsaWNTZXJ2ZXJBdXRoZW50aWNh
dGlvblJvb3RSNDYuY3JsMIGEBggrBgEFBQcBAQR4MHYwTwYIKwYBBQUHMAKGQ2h0
dHA6Ly9jcnQuc2VjdGlnby5jb20vU2VjdGlnb1B1YmxpY1NlcnZlckF1dGhlbnRp
Y2F0aW9uUm9vdFI0Ni5wN2MwIwYIKwYBBQUHMAGGF2h0dHA6Ly9vY3NwLnNlY3Rp
Z28uY29tMA0GCSqGSIb3DQEBDAUAA4ICAQBP/UQxKHBFQTfLCE6B7MkHDnFHqMlk
3boabJl0VxzIyLvMcgY6MVUwG0tOw/0aOPxKMwGTUQ+Mbj06XFQ9zwHP1rWpiGW3
SiJRhsGRY8BXTrU4l34Ysb30q77mTdjLXJfClBXRnVB0Gj/3eQmIIUSG16yjRKm4
g4MMXBK66Egq1VFHDvlSRRwZtiYzgXyv6umJMmtDtWqeyYXK5N1XGQ7UdlPUEpf5
/TI7zsFIR2PpgFmfedXReAtkwfiuwu2lVP5FcUMl9ZJyqSacV0Jd4PXkWKkcIWCb
a5KhD7TCCSyiLQWAbZLBG7TX+HBAaIAuCWPG5CaSK2H5qtIUlkrsw7keWBxW1Q6L
/j8N7vqb5KRAEDeBWIx9u5OqGORvRSo6FqZ7rq4opmXCMgLhJx4Cojccoj0i+p8o
Rfz32Yag1NPGBII2YNvgSbGKcDlpdxtvoKDPXnYn/2KBrJfCssWVadI83XbNc+n+
fdSupnjRzPY0KHx+V0glh3Qx14hYaGFJ0v4Of+kbrUyoHA1Ex5Lb0pZUU6vawIST
2X2bIDtDwJwObKgRRYPwUg+bo1Tp3/JL8uoYfb4ibbQHkMjYgGaartCpFeEZZbHa
ZIT+D2OnrLUsZuM4N5slfyi42i3NVnhmmduazaexMoWDATwL/8v2FH2t5Zrz7l++
qBfllYs4GyW26A==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIEszCCA5ugAwIBAgIQCyWUIs7ZgSoVoE6ZUooO+jANBgkqhkiG9w0BAQsFADBh
MQswCQYDVQQGEwJVUzEVMBMGA1UEChMMRGlnaUNlcnQgSW5jMRkwFwYDVQQLExB3
d3cuZGlnaWNlcnQuY29tMSAwHgYDVQQDExdEaWdpQ2VydCBHbG9iYWwgUm9vdCBH
MjAeFw0xNzExMDIxMjI0MzNaFw0yNzExMDIxMjI0MzNaMGAxCzAJBgNVBAYTAlVT
MRUwEwYDVQQKEwxEaWdpQ2VydCBJbmMxGTAXBgNVBAsTEHd3dy5kaWdpY2VydC5j
b20xHzAdBgNVBAMTFlJhcGlkU1NMIFRMUyBSU0EgQ0EgRzEwggEiMA0GCSqGSIb3
DQEBAQUAA4IBDwAwggEKAoIBAQC/uVklRBI1FuJdUEkFCuDL/I3aJQiaZ6aibRHj
ap/ap9zy1aYNrphe7YcaNwMoPsZvXDR+hNJOo9gbgOYVTPq8gXc84I75YKOHiVA4
NrJJQZ6p2sJQyqx60HkEIjzIN+1LQLfXTlpuznToOa1hyTD0yyitFyOYwURM+/CI
8FNFMpBhw22hpeAQkOOLmsqT5QZJYeik7qlvn8gfD+XdDnk3kkuuu0eG+vuyrSGr
5uX5LRhFWlv1zFQDch/EKmd163m6z/ycx/qLa9zyvILc7cQpb+k7TLra9WE17YPS
n9ANjG+ECo9PDW3N9lwhKQCNvw1gGoguyCQu7HE7BnW8eSSFAgMBAAGjggFmMIIB
YjAdBgNVHQ4EFgQUDNtsgkkPSmcKuBTuesRIUojrVjgwHwYDVR0jBBgwFoAUTiJU
IBiV5uNu5g/6+rkS7QYXjzkwDgYDVR0PAQH/BAQDAgGGMB0GA1UdJQQWMBQGCCsG
AQUFBwMBBggrBgEFBQcDAjASBgNVHRMBAf8ECDAGAQH/AgEAMDQGCCsGAQUFBwEB
BCgwJjAkBggrBgEFBQcwAYYYaHR0cDovL29jc3AuZGlnaWNlcnQuY29tMEIGA1Ud
HwQ7MDkwN6A1oDOGMWh0dHA6Ly9jcmwzLmRpZ2ljZXJ0LmNvbS9EaWdpQ2VydEds
b2JhbFJvb3RHMi5jcmwwYwYDVR0gBFwwWjA3BglghkgBhv1sAQEwKjAoBggrBgEF
BQcCARYcaHR0cHM6Ly93d3cuZGlnaWNlcnQuY29tL0NQUzALBglghkgBhv1sAQIw
CAYGZ4EMAQIBMAgGBmeBDAECAjANBgkqhkiG9w0BAQsFAAOCAQEAGUSlOb4K3Wtm
SlbmE50UYBHXM0SKXPqHMzk6XQUpCheF/4qU8aOhajsyRQFDV1ih/uPIg7YHRtFi
CTq4G+zb43X1T77nJgSOI9pq/TqCwtukZ7u9VLL3JAq3Wdy2moKLvvC8tVmRzkAe
0xQCkRKIjbBG80MSyDX/R4uYgj6ZiNT/Zg6GI6RofgqgpDdssLc0XIRQEotxIZcK
zP3pGJ9FCbMHmMLLyuBd+uCWvVcF2ogYAawufChS/PT61D9rqzPRS5I2uqa3tmIT
44JhJgWhBnFMb7AGQkvNq9KNS9dd3GWc17H/dXa1enoxzWjE0hBdFjxPhUb0W3wi
8o34/m8Fxw==
-----END CERTIFICATE-----
"""


UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d"), "requests": 0}

# pr-rdb.hc-sc.gc.ca and opic-cipo.ca serve only their leaf certificate (no intermediate). We add the two public
# intermediates (fetched from the leaf's Authority Information Access URLs) to the default trust store; verification
# stays on and still chains to the system roots.
CTX = ssl.create_default_context()
CTX.load_verify_locations(cadata=INTERMEDIATES)


def get(u, data=None, timeout=600, tries=3):
    for i in range(tries):
        out["requests"] += 1
        try:
            r = urllib.request.Request(u, data=data, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(r, timeout=timeout, context=CTX) as f:
                return f.status, f.headers.get("Content-Type", ""), f.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, e.headers.get("Content-Type", ""), e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, "", str(e).encode()
            time.sleep(5)


def norm(s):
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "", s)


def ingredients(s):
    """Split an ingredient list ("A; B", "A / B", "A AND B") into normalised words-stripped salts are kept."""
    return {norm(p) for p in re.split(r";|/|,|\band\b", (s or "").lower()) if norm(p)}


SALTS = r"\b(hydrochloride|hcl|sodium|potassium|calcium|magnesium|sulfate|sulphate|mesylate|maleate|fumarate|tartrate|citrate|acetate|besylate|succinate|phosphate|bromide|monohydrate|dihydrate|hemihydrate|anhydrous|hydrobromide|dipropionate|propionate|disodium|trihydrate|hyclate|tosylate)\b"


def moiety(s):
    return {norm(re.sub(SALTS, "", p)) for p in re.split(r";|/|,|\band\b", (s or "").lower()) if norm(re.sub(SALTS, "", p))}


def mdy(s, fmt):
    try:
        return datetime.datetime.strptime(s.strip(), fmt).date().isoformat()
    except Exception:
        return None


# ------------------------------------------------------------- 1. FDA Orange Book data files
st, ct, body = get("https://www.fda.gov/media/76860/download")
z = zipfile.ZipFile(io.BytesIO(body))
ob = {"status": st, "bytes": len(body), "files": {i.filename: {"bytes": i.file_size, "modified": "%04d-%02d-%02d" % i.date_time[:3]} for i in z.infolist()}}


def tilde(name):
    rows = list(csv.reader(io.TextIOWrapper(z.open(name), encoding="latin-1"), delimiter="~"))
    return rows[0], rows[1:]


ph, prod = tilde("products.txt")
th, pat = tilde("patent.txt")
eh, exc = tilde("exclusivity.txt")
ob["products_rows"] = len(prod)
ob["products_columns"] = ph
ob["patent_rows"] = len(pat)
ob["patent_columns"] = th
ob["exclusivity_rows"] = len(exc)
ob["exclusivity_columns"] = eh
P = {c: i for i, c in enumerate(th)}
patnos = [r[P["Patent_No"]] for r in pat]
ob["distinct_patent_numbers"] = len(set(patnos))
ob["patent_number_forms"] = dict(collections.Counter("digits" if re.fullmatch(r"\d{7,8}", p) else re.sub(r"\d", "9", p) for p in set(patnos)).most_common(6))
ob["distinct_applications_with_patents"] = len({(r[0], r[1]) for r in pat})
ob["rows_with_use_code"] = sum(1 for r in pat if r[P["Patent_Use_Code"]].strip())
ob["rows_drug_substance_flag"] = sum(1 for r in pat if r[P["Drug_Substance_Flag"]] == "Y")
ob["rows_drug_product_flag"] = sum(1 for r in pat if r[P["Drug_Product_Flag"]] == "Y")
ob["rows_delist_requested"] = sum(1 for r in pat if r[P["Delist_Flag"]] == "Y")
sub = sorted(d for d in (mdy(r[P["Submission_Date"]], "%b %d, %Y") for r in pat) if d)
ob["newest_patent_submission_date"] = sub[-1] if sub else None
exp = sorted(d for d in (mdy(r[P["Patent_Expire_Date_Text"]], "%b %d, %Y") for r in pat) if d)
ob["patent_expiry_range"] = [exp[0], exp[-1]]
ob["exclusivity_codes_top"] = collections.Counter(re.sub(r"-\d+$", "-n", r[3]) for r in exc).most_common(8)
# declared within FDA: every patent row names a product by application number + product number
pkeys = {(r[ph.index("Appl_Type")], r[ph.index("Appl_No")], r[ph.index("Product_No")]) for r in prod}
ob["patent_rows_resolving_to_products_txt"] = f"{sum(1 for r in pat if (r[0], r[1], r[2]) in pkeys)}/{len(pat)}"
ob["sample_patent_rows"] = [dict(zip(th, r)) for r in pat[:: max(1, len(pat) // 20)][:20]]
out["fda_orange_book"] = ob

# ------------------------------------------------------------- 2. FDA Purple Book patent list + monthly data
st, ct, body = get("https://purplebooksearch.fda.gov/index.cfm?event=patentlist")
t = body.decode("utf-8", "replace")
rows = []
for tr in re.findall(r"<tr.*?</tr>", t, re.S)[1:]:
    cells = [H.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", c))).strip() for c in re.findall(r"<td.*?</td>", tr, re.S)]
    if len(cells) >= 6:
        rows.append({"bla": cells[0], "applicant": cells[1], "proprietary_name": cells[2], "proper_name": cells[3], "patent_number": cells[4].replace(",", ""), "expiry": mdy(cells[5], "%B %d, %Y")})
pb = {"status": st, "rows": len(rows), "distinct_patents": len({r["patent_number"] for r in rows}), "distinct_blas": len({r["bla"] for r in rows}),
      "distinct_proper_names": len({r["proper_name"] for r in rows}), "rows_with_expiry": sum(1 for r in rows if r["expiry"]),
      "patent_number_all_digits": sum(1 for r in rows if re.fullmatch(r"\d{7,8}", r["patent_number"])), "sample": rows[:: max(1, len(rows) // 10)][:10]}
pb["patents_also_in_orange_book"] = len({r["patent_number"] for r in rows} & set(patnos))
st, ct, body = get("https://www.accessdata.fda.gov/drugsatfda_docs/PurpleBook/2026/purplebook-search-October-data-download.csv")
lines = body.decode("utf-8", "replace").splitlines()
pb["monthly_csv_october_2026"] = {"status": st, "bytes": len(body), "lines": len(lines), "title": lines[0].split(",")[0] if lines else None,
                                  "has_patent_list_provided_column": any("Patent List Provided" in l for l in lines[:10])}
out["fda_purple_book"] = pb

# ------------------------------------------------------------- 3. Health Canada Patent Register open-data export
st, ct, body = get("https://pr-rdb.hc-sc.gc.ca/patent/Patent.zip")
hz = zipfile.ZipFile(io.BytesIO(body))
hc = {"status": st, "bytes": len(body), "files": {i.filename: {"bytes": i.file_size, "modified": "%04d-%02d-%02d" % i.date_time[:3]} for i in hz.infolist()}}


def hcsv(name, enc="utf-8"):
    rows = list(csv.reader(io.TextIOWrapper(hz.open(name), encoding=enc, errors="replace")))
    return [c.lstrip("#") for c in rows[0]], rows[1:]


dh, drugs = hcsv("drugs_e.txt", "latin-1")
sh, serv = hcsv("patent_service_e.txt")
ch, subs = hcsv("submission_certif_e.txt")
D = {c: i for i, c in enumerate(dh)}
S = {c: i for i, c in enumerate(sh)}
C = {c: i for i, c in enumerate(ch)}
hc["drugs_rows"] = len(drugs)
hc["drugs_columns"] = dh
hc["patent_rows"] = len(serv)
hc["patent_columns_kept"] = ["DRUG_ID", "FORM_ID", "PATENT_NUMBER", "CATEGORY", "FILING_DATE", "DATE_GRANTED", "EXPIRATION_DATE", "SERVICE_COMPANY_NAME_E"]
hc["patent_columns_personal_never_written"] = ["FIRST_NAME", "LAST_NAME", "POSITION_TITLE", "ADDRESS", "CITY_NAME_E", "PROVINCE_NAME_E", "POSTAL_CODE"]
hc["patent_rows_with_person_name"] = sum(1 for r in serv if r[S["FIRST_NAME"]].strip() or r[S["LAST_NAME"]].strip())
hc["submission_rows"] = len(subs)
hc["submission_columns_personal_never_written"] = ["FIRST_NAME", "LAST_NAME", "ADDRESS", "POSITION_TITLE", "PHONE_NUMBER", "FAX_NUMBER"]
hc["submission_rows_with_person_name"] = sum(1 for r in subs if r[C["FIRST_NAME"]].strip() or r[C["LAST_NAME"]].strip())
hc["submission_rows_with_use_of_mi_text"] = sum(1 for r in subs if r[C["USE_OF_MI"]].strip())
hc["submission_rows_removed"] = sum(1 for r in subs if r[C["REMOVED_DATE"]].strip())
hc_pat = {r[S["PATENT_NUMBER"]] for r in serv}
hc["distinct_patent_numbers"] = len(hc_pat)
hc["patent_number_all_digits"] = sum(1 for p in hc_pat if re.fullmatch(r"\d{7}", p))
hc["drugs_with_din"] = sum(1 for r in drugs if re.fullmatch(r"\d{8}", r[D["DIN"]].strip()))
hc["distinct_dins"] = len({r[D["DIN"]] for r in drugs if r[D["DIN"]].strip()})
added = sorted(d for d in (mdy(r[C["DATE_ADDED_TO_REGISTER"]], "%m/%d/%Y") for r in subs) if d)
hc["newest_date_added"] = added[-1] if added else None
hc["submissions_added_since_2026_10_01"] = sum(1 for d in added if d >= "2026-10-01")
# The export's EXPIRATION_DATE equals DATE_GRANTED on every row (a defect of the export; the web register shows the
# real expiry, e.g. 2952131: filed 2016-12-19, expires 2036-12-19). Canadian patents filed since 1989-10-01 expire 20
# years after filing, so the term is derived from FILING_DATE here and confirmed on the live register page below.
hc["rows_expiration_equals_grant_date"] = f"{sum(1 for r in serv if r[S['EXPIRATION_DATE']] == r[S['DATE_GRANTED']])}/{len(serv)}"


def ca_expiry(r):
    f = mdy(r[S["FILING_DATE"]], "%m/%d/%Y")
    return (str(int(f[:4]) + 20) + f[4:]) if f and f >= "1989-10-01" else None


hexp = sorted(d for d in (ca_expiry(r) for r in serv) if d)
hc["derived_expiry_range_filing_plus_20y"] = [hexp[0], hexp[-1]]
hc["patents_unexpired_on_run_date_derived"] = len({r[S["PATENT_NUMBER"]] for r in serv if (ca_expiry(r) or "") >= out["run_date"]})
st, ct, body = get("https://pr-rdb.hc-sc.gc.ca/pr-rdb/patent_result-resultat_brevet?formId=11461&patentNumber_numeroBrevet=2952131&drugId=5381&din=02544040", timeout=60)
t = H.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body.decode("utf-8", "replace"))))
m = re.search(r"Patent number: (\d+) Date granted: (\S+) Expiration date: (\S+) Filing date: (\S+)", t)
c = re.search(r"Certificate of Supplementary Protection \(CSP\) number: (\d+) CSP Expiration date: (\S+)", t)
row = next(r for r in serv if r[S["PATENT_NUMBER"]] == "2952131")
hc["web_check_2952131"] = {"status": st, "web": m.groups() if m else None, "csp": c.groups() if c else None, "export_expiration": row[S["EXPIRATION_DATE"]], "derived": ca_expiry(row)}
drug_by_id = {r[D["DRUG_ID"]]: r for r in drugs}
hc["patent_rows_resolving_to_drugs_txt"] = f"{sum(1 for r in serv if r[S['DRUG_ID']] in drug_by_id)}/{len(serv)}"
hc["sample_patent_rows"] = [{k: r[S[k]] for k in hc["patent_columns_kept"]} for r in serv[:: max(1, len(serv) // 20)][:20]]
out["hc_patent_register"] = hc

# ------------------------------------------------------------- 4. DIN -> Health Canada Drug Product Database (declared)
dins = sorted({r[D["DIN"]].strip() for r in drugs if re.fullmatch(r"\d{8}", r[D["DIN"]].strip())})
sample = dins[:: max(1, len(dins) // 40)][:40]
matched, brand_same, res = 0, 0, []
brand_of = {r[D["DIN"]].strip(): r[D["BRAND_NAME_E"]] for r in drugs}
for din in sample:
    st, ct, body = get(f"https://health-products.canada.ca/api/drug/drugproduct/?din={din}&lang=en&type=json", timeout=60)
    try:
        js = json.loads(body)
    except Exception:
        js = []
    hit = [p for p in js if p.get("drug_identification_number") == din]
    if hit:
        matched += 1
        if norm(hit[0].get("brand_name")) == norm(brand_of.get(din)):
            brand_same += 1
    res.append({"din": din, "status": st, "dpd_records": len(hit), "dpd_drug_code": hit[0]["drug_code"] if hit else None,
                "register_brand": brand_of.get(din), "dpd_brand": hit[0].get("brand_name") if hit else None, "dpd_last_update": hit[0].get("last_update_date") if hit else None})
    time.sleep(0.5)
out["din_to_dpd"] = {"measured": f"{matched}/{len(sample)}", "same_brand_name": f"{brand_same}/{matched}", "sample": res}

# ------------------------------------------------------------- 5. CIPO patent bulk data (Canadian patent number, declared)
cipo = {}
st, ct, body = get("https://opic-cipo.ca/cipo/client_downloads/Patent_CSV_2024_10_11/PT_main_2000001_to_4000000_2024-10-11.zip")
cipo["main_status"] = st
cipo["main_zip_bytes"] = len(body)
mz = zipfile.ZipFile(io.BytesIO(body))
in_range = {p for p in hc_pat if 2000001 <= int(p) <= 4000000}
found, grant_max, extract_max, titles = {}, "", "", 0
with mz.open(mz.namelist()[0]) as f:
    rd = io.TextIOWrapper(f, encoding="utf-8", errors="replace")
    head = rd.readline().rstrip("\n").split("|")
    cipo["main_columns"] = [h.split(" - ")[0] for h in head]
    n = 0
    for line in rd:
        n += 1
        c = line.rstrip("\n").split("|")
        g = c[2].strip()
        if g > grant_max and g != "NULL":
            grant_max = g
        if c[7] > extract_max:
            extract_max = c[7]
        if c[0] in in_range:
            found[c[0]] = {"grant": g, "status": c[3], "title_en": c[5]}
cipo["main_rows"] = n
cipo["main_newest_grant_date"] = grant_max
cipo["main_newest_extract_date"] = extract_max
granted_after = {p for p in in_range if p not in found}
cut = grant_max
hc_grant = {r[S["PATENT_NUMBER"]]: mdy(r[S["DATE_GRANTED"]], "%m/%d/%Y") for r in serv}
cipo["hc_patents_in_range_2000001_4000000"] = len(in_range)
cipo["hc_patent_to_cipo_main"] = f"{len(found)}/{len(in_range)}"
cipo["hc_patents_granted_on_or_before_newest_cipo_grant"] = sum(1 for p in in_range if (hc_grant.get(p) or "9") <= cut)
cipo["hc_patent_to_cipo_main_granted_before_snapshot"] = f"{sum(1 for p in found if (hc_grant.get(p) or '9') <= cut)}/{cipo['hc_patents_granted_on_or_before_newest_cipo_grant']}"
cipo["grant_date_agrees"] = f"{sum(1 for p, v in found.items() if v['grant'] == hc_grant.get(p))}/{len(found)}"
cipo["unmatched_sample"] = [{"patent": p, "hc_grant": hc_grant.get(p)} for p in sorted(granted_after)[:15]]
cipo["matched_sample"] = [{"patent": p, **found[p], "hc_grant": hc_grant.get(p)} for p in sorted(found)[:: max(1, len(found) // 15)][:15]]
del body, mz
st, ct, body = get("https://opic-cipo.ca/cipo/client_downloads/Patent_CSV_2024_10_11/PT_claim_2950001_to_3000000_2024-10-11.zip")
cipo["claim_status"] = st
cipo["claim_zip_bytes"] = len(body)
cz = zipfile.ZipFile(io.BytesIO(body))
rng = {p for p in hc_pat if 2950001 <= int(p) <= 3000000}
claims, patents_with_claims = collections.Counter(), set()
first_claim = {}
with cz.open(cz.namelist()[0]) as f:
    rd = io.TextIOWrapper(f, encoding="utf-8", errors="replace")
    rd.readline()
    for line in rd:
        c = line.split("|", 3)
        patents_with_claims.add(c[0])
        if c[0] in rng:
            claims[c[0]] += len(c[3])
            if c[1].strip() == "1":
                m = re.search(r"\b1\s*\.\s*(.{0,160})", c[3])
                first_claim[c[0]] = (m.group(1) if m else c[3][:160]).strip()
cipo["claim_file_patents"] = len(patents_with_claims)
cipo["hc_patents_in_range_2950001_3000000"] = len(rng)
cipo["hc_patent_to_cipo_claims"] = f"{len(claims)}/{len(rng)}"
cipo["claims_text_chars_median"] = sorted(claims.values())[len(claims) // 2] if claims else 0
cipo["claim_1_starts_sample"] = [{"patent": p, "claim_1_start": first_claim.get(p)} for p in sorted(claims)[:10]]
out["cipo_patent_data"] = cipo

# ------------------------------------------------------------- 6. US <-> Canada candidate: same brand + same active moiety
ob_by_brand = collections.defaultdict(list)
pat_by_app = collections.defaultdict(list)
for r in pat:
    pat_by_app[(r[0], r[1])].append(r)
for r in prod:
    app = (r[ph.index("Appl_Type")], r[ph.index("Appl_No")])
    if app in pat_by_app:
        ob_by_brand[norm(r[ph.index("Trade_Name")])].append(r)
hc_by_brand = collections.defaultdict(list)
for r in drugs:
    hc_by_brand[norm(r[D["BRAND_NAME_E"]])].append(r)
pat_by_drug = collections.defaultdict(list)
for r in serv:
    pat_by_drug[r[S["DRUG_ID"]]].append(r)
pairs = []
brands_both = sorted(set(ob_by_brand) & set(hc_by_brand))
same_moiety = 0
for b in brands_both:
    o, h = ob_by_brand[b][0], hc_by_brand[b][0]
    mo, mh = moiety(o[0]), moiety(h[D["MEDICINAL_INGREDIENT_E"]])
    ok = bool(mo & mh)
    same_moiety += ok
    usp = sorted({(x[P["Patent_No"]], mdy(x[P["Patent_Expire_Date_Text"]], "%b %d, %Y")) for x in pat_by_app[(o[ph.index("Appl_Type")], o[ph.index("Appl_No")])]}, key=lambda t: t[1] or "")
    cap = sorted({(x[S["PATENT_NUMBER"]], ca_expiry(x)) for hr in hc_by_brand[b] for x in pat_by_drug[hr[D["DRUG_ID"]]]}, key=lambda t: t[1] or "")
    pairs.append({"brand": o[ph.index("Trade_Name")], "us_appl": o[ph.index("Appl_Type")] + o[ph.index("Appl_No")], "us_ingredient": o[0], "us_applicant": o[ph.index("Applicant_Full_Name")],
                  "ca_din": h[D["DIN"]], "ca_ingredient": h[D["MEDICINAL_INGREDIENT_E"]], "moiety_overlap": ok,
                  "us_patents": len(usp), "us_last_expiry": usp[-1][1] if usp else None, "ca_patents": len(cap), "ca_last_expiry_derived": cap[-1][1] if cap else None})
hcb_with_pat = {b for b in hc_by_brand if any(pat_by_drug[r[D["DRUG_ID"]]] for r in hc_by_brand[b])}
out["us_ca_brand_candidate"] = {"orange_book_brands_with_patents": len(ob_by_brand), "hc_register_brands_with_patents": len(hcb_with_pat),
                                "brands_in_both": len(brands_both), "brands_in_both_with_same_active_moiety": same_moiety,
                                "measured": f"{same_moiety}/{len(hcb_with_pat)} Health Canada register brands match an Orange Book brand with the same active moiety"}
out["us_ca_brand_candidate"]["handcheck_pairs"] = [p for p in pairs if p["moiety_overlap"]][:: max(1, same_moiety // 20)][:20]
out["us_ca_brand_candidate"]["moiety_mismatch_sample"] = [p for p in pairs if not p["moiety_overlap"]][:10]

# ------------------------------------------------------------- 7. Purple Book <-> Health Canada (proper name -> ingredient)
pb_names = {norm(re.sub(r"-[a-z]{4}$", "", r["proper_name"].lower())) for r in rows}
hc_ings = {norm(re.sub(SALTS, "", r[D["MEDICINAL_INGREDIENT_E"]].lower())) for r in drugs}
out["purple_book_to_hc_candidate"] = {"purple_book_proper_names": len(pb_names), "also_hc_register_ingredient": len(pb_names & hc_ings),
                                      "examples": sorted(pb_names & hc_ings)[:15]}

# ------------------------------------------------------------- 8. USPTO reachability (the US full-text member)
probes = {}
for u in ["https://api.uspto.gov/api/v1/patent/applications/search?q=patentNumber:7625884",
          "https://s3.amazonaws.com/data.patentsview.org/download/g_patent.tsv.zip",
          "https://search.patentsview.org/api/v1/patent/?q=%7B%22patent_id%22:%227625884%22%7D"]:
    st, ct, body = get(u, timeout=60, tries=1)
    probes[u] = {"status": st, "body_start": body[:80].decode("utf-8", "replace") if st else body[:120].decode("utf-8", "replace")}
out["uspto_probes"] = probes

with open("dpat_measure.json", "w") as f:
    json.dump(out, f, indent=1, ensure_ascii=False)
print(json.dumps({k: (v if not isinstance(v, dict) else {kk: vv for kk, vv in v.items() if not isinstance(vv, (list, dict))}) for k, v in out.items()}, indent=1, ensure_ascii=False))
