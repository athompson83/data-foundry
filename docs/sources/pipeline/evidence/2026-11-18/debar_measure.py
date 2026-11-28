#!/usr/bin/env python3
"""Screening 2026-11-18: procurement-debarments (firms excluded from publicly funded contracts). Fetches every source live (stdlib only).
Run from this directory with: python3 -I debar_measure.py   -> writes debar_measure.json (hand-check pairs included; verdicts in debar_handcheck.json)

Personal data: these lists include natural persons. Individuals are separated by the publisher's own flag and are only COUNTED:
  IDB `Entity` = Individual, ADB `entityType` = Individual, Brazil CEIS/CNEP `TIPO DE PESSOA` = F (CPF holder) or blank.
  Lists with no person flag (EU EDES, AIIB) contribute counts, countries, grounds and dates only, never a name, except where the
  same normalised name is a row the IDB or ADB list flags as a Firm. Output holds organisation names, identifiers (CNPJ of legal
  persons), countries, dates, grounds and counts only.

Sources:
  IDB open data (data.iadb.org CKAN): "Dataset of Sanctioned firms and individuals" (CC BY 4.0), datastore API. Carries the
     cross-debarment origin (Source = IDB | WBG/ADB/EBRD/AfDB cross debarment).
  Brazil CGU Portal da Transparencia: CEIS (Cadastro de Empresas Inidoneas e Suspensas) and CNEP daily CSV zips.
  EU EDES public list of excluded economic operators (ec.europa.eu/edes, the page's own JSON endpoint, no key).
  UK Debarment Review Service debarment list (gov.uk PDF, OGL v3).
  Canada PSPC ineligible and suspended suppliers (canada.ca HTML table; PSPC terms forbid commercial redistribution -> parked).
  ADB published sanctions list (sanctions.adb.org -> apim.adb.org published-list, no key; adb.org terms -> parked).
  AIIB debarment list, EIB exclusion list, EBRD ineligible entities: reachability, counts where static, terms (-> parked).
  World Bank debarred firms: the page calls apigwext.worldbank.org with a subscription key embedded in the page script; the
     endpoint answers 401 without it. The embedded key is NOT used (key wall); status and terms recorded (-> parked).
  AfDB and iadb.org web pages: Cloudflare challenge (403), recorded only.
Joins:
  candidate: normalised firm name, IDB firms located in Brazil <-> CEIS legal persons (CNPJ). All pairs written.
  candidate (ADB is parked, measured for the record): normalised firm name, IDB firms <-> ADB firms; 20 seeded pairs written.
  cross-debarment origin: IDB `Source` vs ADB `grounds` / AIIB `DEBARRED BY` on the name-matched rows (agreement counts).
  declared: Sanctions Board decision / case numbers cited in list entries: counted (none of the lists cites one).
"""
import json, re, time, gzip, io, csv, zipfile, zlib, random, datetime, unicodedata, html as H, collections, urllib.request, urllib.error

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}
NREQ = [0]
C = collections.Counter


def get(u, data=None, ctype=None, timeout=180, tries=2):
    for i in range(tries):
        NREQ[0] += 1
        h = {"User-Agent": UA, "Accept": "*/*"}
        if ctype:
            h["Content-Type"] = ctype
        try:
            with urllib.request.urlopen(urllib.request.Request(u, data=data, headers=h), timeout=timeout) as f:
                b = f.read()
                if f.headers.get("Content-Encoding") == "gzip" or b[:2] == b"\x1f\x8b":
                    b = gzip.decompress(b)
                return f.status, f.headers.get("Content-Type", ""), b
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(10)
                continue
            return e.code, e.headers.get("Content-Type", ""), e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, "", str(e).encode()
            time.sleep(5)


def text(b):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", b.decode("utf8", "replace"), flags=re.S)
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", t)))


SUFFIX = r"\b(ltda|ltd|limited|sa|s a|inc|co|corp|corporation|company|llc|me|epp|eireli|cia|srl|sas|gmbh|plc|pvt|private|jsc|llp)\b"
AKA = r"\b(?:f/k/a|a/k/a|d/b/a|formerly known as|also known as|currently doing business as|doing business as)\b"


def norm(s):
    """Normalised firm name: ASCII-folded, lower case, parentheticals and aliases dropped, legal-form words dropped."""
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.split(AKA, s)[0]
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    s = re.sub(SUFFIX, " ", s)
    return " ".join(s.split())


CORP = re.compile(r"\b(ltd|limited|ltda|s\.? ?a\.?|s/a|inc|corp|corporation|company|co|llc|gmbh|eireli|sarl|a\.?s\.?|b\.?v\.?|plc|jsc|ojsc|cjsc|pvt|group|branch|sucursal|"
                  r"construtora|constructora|engineering|construction|constructors|services?|enterprises?|international|comercio|mchj|pt|llp|s\.?a\.?s\.?|s\.?r\.?l\.?)\b", re.I)


def corporate(name):
    """True when the name carries a legal-form or organisation word. Names are written to the output only when this holds:
    a sole proprietorship can be registered under its owner's personal name, and when unsure the entry is not written."""
    return bool(CORP.search(unicodedata.normalize("NFKD", name or "").encode("ascii", "ignore").decode()))


def country(s):
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"\*\d|-?non adb member country", " ", s)
    s = re.sub(r"people'?s republic of |republic of |federal democratic |islamic republic of |socialist republic of |, .*$|\bthe\b", " ", s)
    s = re.sub(r"[^a-z ]", " ", s)
    s = {"viet nam": "vietnam", "turkiye": "turkey", "lao pdr": "laos", "lao people s democratic republic": "laos"}.get(" ".join(s.split()), " ".join(s.split()))
    return s


def terms(key, url, quote):
    """Fetch a terms page and record whether the verbatim quote is present in its text."""
    st, _, b = get(url)
    t = text(b) if st == 200 else ""
    out.setdefault("terms", {})[key] = {"url": url, "status": st, "quote": quote, "quote_found": quote in t}
    time.sleep(1)


# ---------------------------------------------------------------- IDB open data (member)
st, _, b = get("https://data.iadb.org/api/3/action/package_show?id=dataset-of-sanctioned-firms-and-individuals")
pk = json.loads(b)["result"]
res = pk["resources"][0]
st2, _, b = get("https://data.iadb.org/api/3/action/datastore_search?resource_id=%s&limit=5000" % res["id"])
ds = json.loads(b)["result"]
IDB = ds["records"]
IDBF = [r for r in IDB if r["Entity"] == "Firm"]
idb_by = collections.defaultdict(list)
for r in IDBF:
    idb_by[norm(r["Title"])].append(r)
out["idb"] = {
    "package_status": st, "datastore_status": st2, "resource_id": res["id"], "doi": pk.get("identifier"),
    "license_id": pk.get("license_id"), "license_title": pk.get("license_title"), "license_url": pk.get("license_url"),
    "metadata_modified": pk.get("metadata_modified"), "resource_last_modified": res.get("last_modified"),
    "fields": [f["id"] for f in ds["fields"]], "rows": ds["total"],
    "firms": len(IDBF), "individuals_counted_not_written": sum(1 for r in IDB if r["Entity"] == "Individual"),
    "other_entity_values": sum(1 for r in IDB if r["Entity"] not in ("Firm", "Individual")),
    "distinct_normalised_firm_names": len(idb_by),
    "firms_by_source": dict(C(r["Source"] for r in IDBF).most_common()),
    "firms_by_idb_sanction_type": dict(C(r["Tipo de sancion del BID"] or "(blank: cross-debarment rows)" for r in IDBF).most_common()),
    "firms_by_idb_sanction_source": dict(C(r["Other Name"] or "(blank)" for r in IDBF).most_common()),
    "firms_by_prohibited_practice_top": dict(C(r["Prohibited Practice"].strip() for r in IDBF).most_common(8)),
    "firms_by_country_top": dict(C(r["Country"].strip() or "(blank)" for r in IDBF).most_common(12)),
    "firms_to_ongoing": sum(1 for r in IDBF if r["To"].strip().lower() == "ongoing"),
    "newest_from": max(r["From"][:10] for r in IDBF if re.match(r"\d{4}-", r["From"])),
    "oldest_from": min(r["From"][:10] for r in IDBF if re.match(r"\d{4}-", r["From"])),
    "newest_firm_rows": [{"firm": r["Title"].strip(), "country": r["Country"].strip(), "from": r["From"][:10], "to": r["To"][:10], "practice": r["Prohibited Practice"].strip(), "source": r["Source"]}
                         for r in [x for x in sorted(IDBF, key=lambda r: r["From"], reverse=True) if corporate(x["Title"])][:8]],
    "firm_rows_without_a_legal_form_word_never_written": sum(1 for r in IDBF if not corporate(r["Title"])),
    "firm_titles_citing_a_registration_number": sum(1 for r in IDBF if re.search(r"(CNPJ|Reg\. No\.)", r["Title"])),
    "firm_rows_citing_decision_or_case_number": sum(1 for r in IDBF if re.search(r"decision no|case no|sanctions board", json.dumps(r), re.I)),
}

# ---------------------------------------------------------------- Brazil CGU CEIS + CNEP (member)


def cgu(kind):
    info = {}
    st, _, b = get("https://portaldatransparencia.gov.br/download-de-dados/%s" % kind)
    info["listing_status"] = st
    m = re.search(r'arquivos\.push\(\{"ano" : "(\d+)", "mes" : "(\d+)", "dia" : "(\d+)"', b.decode("utf8", "replace"))
    days = [m.group(1) + m.group(2) + m.group(3)] if m else []
    today = datetime.date.today()
    days += [(today - datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(1, 6)]  # fallback if the listing is challenged
    for d in days:
        u = "https://dadosabertos-download.cgu.gov.br/PortalDaTransparencia/saida/%s/%s_%s.zip" % (kind, d, kind.upper())
        st, _, zb = get(u)
        if st == 200 and zb[:2] == b"PK":
            z = zipfile.ZipFile(io.BytesIO(zb))
            rows = list(csv.reader(io.StringIO(z.read(z.namelist()[0]).decode("latin-1")), delimiter=";"))
            info.update({"file_url": u, "file_date": d, "zip_bytes": len(zb), "columns": rows[0]})
            return info, [dict(zip(rows[0], r)) for r in rows[1:]]
        time.sleep(2)
    info["file_status"] = st
    return info, []


def iso(d):
    return d[6:10] + "-" + d[3:5] + "-" + d[0:2] if re.match(r"\d\d/\d\d/\d{4}", d or "") else ""


ceis_info, CEIS = cgu("ceis")
CEISJ = [r for r in CEIS if r["TIPO DE PESSOA"] == "J"]
ceis_names = collections.defaultdict(set)
for r in CEISJ:
    for k in ("NOME DO SANCIONADO", "RAZÃO SOCIAL - CADASTRO RECEITA", "NOME INFORMADO PELO ÓRGÃO SANCIONADOR", "NOME FANTASIA - CADASTRO RECEITA"):
        n = norm(r[k])
        if len(n) >= 6:
            ceis_names[n].add(r["CPF OU CNPJ DO SANCIONADO"])
ceis_info.update({
    "rows": len(CEIS), "legal_person_rows": len(CEISJ),
    "natural_person_rows_counted_not_written": sum(1 for r in CEIS if r["TIPO DE PESSOA"] == "F"),
    "blank_person_type_rows_dropped": sum(1 for r in CEIS if r["TIPO DE PESSOA"] not in ("J", "F")),
    "distinct_cnpj": len({r["CPF OU CNPJ DO SANCIONADO"] for r in CEISJ}),
    "legal_person_rows_by_category": dict(C(r["CATEGORIA DA SANÇÃO"] for r in CEISJ).most_common()),
    "legal_person_rows_by_sphere": dict(C(r["ESFERA ÓRGÃO SANCIONADOR"] or "(blank)" for r in CEISJ).most_common()),
    "distinct_sanctioning_bodies": len({r["ÓRGÃO SANCIONADOR"] for r in CEISJ}),
    "legal_person_rows_with_process_number": sum(1 for r in CEISJ if r["NÚMERO DO PROCESSO"].strip()),
    "legal_person_rows_with_free_text_observation": sum(1 for r in CEISJ if r["OBSERVAÇÕES"].strip()),
    "newest_sanction_start": max((iso(r["DATA INÍCIO SANÇÃO"]) for r in CEISJ), default=""),
    "newest_publication": max((iso(r["DATA PUBLICAÇÃO"]) for r in CEISJ), default=""),
    "sample_newest_legal_persons": [{"cnpj": r["CPF OU CNPJ DO SANCIONADO"], "firm": r["NOME DO SANCIONADO"], "category": r["CATEGORIA DA SANÇÃO"], "from": iso(r["DATA INÍCIO SANÇÃO"]), "to": iso(r["DATA FINAL SANÇÃO"]), "body": r["ÓRGÃO SANCIONADOR"], "legal_basis": r["FUNDAMENTAÇÃO LEGAL"][:90]}
                                    for r in [x for x in sorted(CEISJ, key=lambda r: iso(r["DATA INÍCIO SANÇÃO"]), reverse=True) if corporate(x["NOME DO SANCIONADO"])][:8]],
    "legal_person_rows_without_a_legal_form_word_never_written": sum(1 for r in CEISJ if not corporate(r["NOME DO SANCIONADO"])),
})
out["ceis"] = ceis_info
time.sleep(2)
cnep_info, CNEP = cgu("cnep")
cnep_info.update({"rows": len(CNEP), "legal_person_rows": sum(1 for r in CNEP if r["TIPO DE PESSOA"] == "J"),
                  "natural_person_or_blank_rows_counted_not_written": sum(1 for r in CNEP if r["TIPO DE PESSOA"] != "J"),
                  "legal_person_rows_by_category": dict(C(r["CATEGORIA DA SANÇÃO"] for r in CNEP if r["TIPO DE PESSOA"] == "J").most_common(6))})
cnep_info.pop("columns", None)
out["cnep"] = cnep_info
# is the portal's own terms page readable?
st, _, b = get("https://portaldatransparencia.gov.br/termos-de-uso", tries=1)
out["ceis"]["terms_page"] = {"url": "https://portaldatransparencia.gov.br/termos-de-uso", "status": st, "human_verification_challenge": b"Human Verification" in b}

# ---------------------------------------------------------------- EU EDES (member)
st, _, b = get("https://ec.europa.eu/edes/api/cases/paginatedList", data=json.dumps({"take": 100, "page": 0, "ecOpName": None, "ecOpCountryCode": None}).encode(), ctype="application/json")
t = b.decode("utf8", "replace")
ed = json.loads(t[t.index("{"):]) if st == 200 else {"content": []}


def ms(v):
    return datetime.datetime.fromtimestamp(v / 1000, datetime.timezone.utc).strftime("%Y-%m-%d") if v else None


out["edes"] = {
    "status": st, "public_cases": ed.get("totalElements"), "returned": len(ed["content"]),
    "fields": sorted(ed["content"][0].keys()) if ed["content"] else [],
    "note": "no firm/individual flag in the payload: operator names are not written",
    "cases": [{"country": c["ecOpCountryCode"], "type": c["type"], "grounds": c["grounds"], "from": ms(c["from"]), "to": ms(c["to"]), "comments": c["comments"], "financial_penalty": c["fpAmount"]} for c in ed["content"]],
    "newest_from": max((ms(c["from"]) for c in ed["content"]), default=None),
    "names_matching_an_idb_firm": sum(1 for c in ed["content"] if norm(c["ecOpName"]) in idb_by),
}

# ---------------------------------------------------------------- UK debarment list (PDF)
st, _, b = get("https://www.gov.uk/guidance/debarment-review-service-drs")
pg = b.decode("utf8", "replace")
m = re.search(r'https://assets\.publishing\.service\.gov\.uk/media/[0-9a-f]+/[^"]*Debarment_List[^"]*\.pdf', pg)
uk = {"guidance_status": st, "pdf_url": m.group(0) if m else None}
if m:
    st, _, pb = get(m.group(0))
    parts = []
    for s in re.finditer(rb"stream\r?\n(.*?)endstream", pb, flags=re.S):
        try:
            d = zlib.decompress(s.group(1))
        except Exception:
            continue
        for tj in re.findall(rb"\[(.*?)\]\s*TJ|\((.*?)\)\s*Tj", d, flags=re.S):
            parts.append(b"".join(re.findall(rb"\(((?:\\.|[^\\)])*)\)", tj[0])) if tj[0] else tj[1])
    txt = re.sub(r"\s+", " ", b" ".join(parts).decode("latin-1").replace("\\(", "(").replace("\\)", ")"))
    after = txt.split("LINK TO DRS REPORT")[-1].strip() if "LINK TO DRS REPORT" in txt else None
    uk.update({"pdf_status": st, "pdf_bytes": len(pb), "text_chars": len(txt), "header": txt[:110],
               "states_list_will_remain_blank": bool(re.search(r"the list will\s+remain\s+blank", txt)),
               "text_after_column_headers": after, "entries": 0 if after == "" else None})
out["uk_debarment_list"] = uk

# ---------------------------------------------------------------- Canada PSPC (parked on terms)
st, _, b = get("https://www.canada.ca/en/public-services-procurement/services/standards-oversight/supplier-integrity-compliance/ineligible-suspended-suppliers.html")
pg = b.decode("utf8", "replace")
rows = [[H.unescape(re.sub(r"<[^>]+>", "", c)).strip() for c in re.findall(r"<td[^>]*>(.*?)</td>", r, flags=re.S)] for r in re.findall(r"<tr.*?</tr>", pg, flags=re.S)]
rows = [r for r in rows if len(r) >= 5]
mod = re.search(r"Page details\s+(\d{4}-\d\d-\d\d)", text(b))
out["canada_pspc"] = {"status": st, "suppliers": len(rows), "by_status": dict(C(r[2] for r in rows)), "page_date_modified": mod.group(1) if mod else None,
                      "names_matching_an_idb_firm": sum(1 for r in rows if norm(r[0]) in idb_by)}

# ---------------------------------------------------------------- ADB published list (parked on terms; measured for the record)
ADB, adb_meta, pages = [], None, []
for off in range(0, 2600, 100):
    st, _, b = get("https://apim.adb.org/sanctions/lists/v1/published-list?size=100&offset=%d" % off)
    if st != 200:
        pages.append([off, st])
        break
    d = json.loads(b)
    adb_meta = d["meta"].get("totalItems")
    got = d.get("data") or []
    pages.append([off, len(got)])
    ADB += [x["attributes"] for x in got]
    if off + 100 >= (adb_meta or 0):
        break
    time.sleep(1)
ADBF = [a for a in ADB if a["entityType"] == "Firm"]
adb_by = collections.defaultdict(list)
for a in ADBF:
    adb_by[norm(a["name"])].append(a)


def origin(g):
    m = re.search(r"Cross-Debarment:\s*([A-Za-z]+)", g or "")
    return {"WB": "WBG"}.get(m.group(1), m.group(1)) if m else "ADB"  # no cross-debarment tag: ADB's own sanction (incl. "Affiliate of a debarred entity")


out["adb"] = {
    "meta_totalItems": adb_meta, "rows_returned": len(ADB), "pages_offset_rows": pages,
    "firms": len(ADBF), "individuals_counted_not_written": sum(1 for a in ADB if a["entityType"] == "Individual"),
    "distinct_normalised_firm_names": len(adb_by),
    "firms_by_sanction_type": dict(C(a["sanctionType"] for a in ADBF)),
    "firms_by_origin": dict(C(origin(a["grounds"]) for a in ADBF).most_common()),
    "newest_effective": max((a["effectiveDateOfSanction"] or "" for a in ADBF), default=""),
    "newest_change": max((str(a["changesMadeOn"] or "") for a in ADBF), default=""),
    "firm_rows_citing_decision_or_case_number": sum(1 for a in ADBF if re.search(r"decision no|case no|sanctions board", json.dumps(a), re.I)),
    "fields": sorted(ADB[0].keys()) if ADB else [],
}

# ---------------------------------------------------------------- AIIB, EIB, EBRD (parked on terms), World Bank, AfDB, iadb.org
st, _, b = get("https://www.aiib.org/en/about-aiib/who-we-are/debarment-list/_common/js/debarment-list.js")
AIIB = []
if st == 200:
    t = b.decode("utf8", "replace")
    AIIB = json.loads(t[t.index("["):t.rindex("]") + 1])
aiib_by = collections.defaultdict(list)
for a in AIIB:
    aiib_by[norm(a["NAME"])].append(a)
out["aiib"] = {"status": st, "rows_firms_and_individuals_no_flag": len(AIIB), "by_debarred_by": dict(C(a["DEBARRED BY"].upper().replace("AFDB", "AfDB") for a in AIIB).most_common()),
               "newest_date_added": max((a["DATE ADDED BY AIIB"] for a in AIIB), default=""), "fields": sorted(AIIB[0].keys()) if AIIB else [],
               "rows_citing_decision_or_case_number": sum(1 for a in AIIB if re.search(r"decision no|case no|sanctions board", json.dumps(a), re.I))}

st, _, b = get("https://www.eib.org/en/about/accountability/anti-fraud/exclusion/index")
rows = [r for r in re.findall(r"<tr.*?</tr>", b.decode("utf8", "replace"), flags=re.S) if "<td" in r]
out["eib"] = {"status": st, "table_rows": len(rows), "press_release_links": len(set(re.findall(r'https://www\.eib\.org/(?:en/)?press/news/[a-z0-9-]+', b.decode("utf8", "replace"))))}

st, _, b = get("https://www.ebrd.com/home/who-we-are/strategies-governance-compliance/ebrd-sanctions-system/ineligible-entities.html")
m = re.search(r"Last updated on ([0-9/]+)", text(b))
out["ebrd"] = {"status": st, "last_updated": m.group(1) if m else None, "note": "entity cards are rendered by script; not parsed (terms forbid commercial use)"}

st, _, b = get("https://www.worldbank.org/en/projects-operations/procurement/debarred-firms")
pg = b.decode("utf8", "replace")
api = re.search(r'https://apigwext\.worldbank\.org/[A-Za-z0-9_/.]+', pg)
st2, _, b2 = get(api.group(0), tries=1) if api else (None, "", b"")
st3, _, b3 = get("https://datacatalogapi.worldbank.org/ddhxext/Search?qname=dataset&q=debarred&$top=10", tries=1)
out["worldbank"] = {"page_status": st, "page_embeds_subscription_key": bool(re.search(r'ApiKey\s*=\s*"', pg)), "api_url": api.group(0) if api else None,
                    "api_status_without_key": st2, "api_message_without_key": b2.decode("utf8", "replace")[:160],
                    "data_catalog_search_status": st3, "data_catalog_message": b3.decode("utf8", "replace")[:120] if st3 != 200 else "ok",
                    "note": "the key embedded in the page script was not used; list not acquired"}
if st3 == 200:
    try:
        out["worldbank"]["data_catalog_hits"] = [x.get("name") for x in json.loads(b3).get("value", [])][:10]
    except Exception:
        pass
st, _, b = get("https://www.worldbank.org/en/about/unit/sanctions-system/sanctions-board/decisions")
out["worldbank"]["sanctions_board_decisions_page_status"] = st
out["worldbank"]["sanctions_board_decisions_listed_in_html"] = len(set(re.findall(r"Sanctions Board Decision No\.? ?\d+", text(b))))

gated = {}
for k, u in (("afdb", "https://www.afdb.org/en/projects-operations/debarment-and-sanctions-procedures"),
             ("iadb_web", "https://www.iadb.org/en/who-we-are/transparency/sanctions-system/sanctioned-firms-and-individuals"),
             ("adb_lotus_legacy", "https://lnadbg4.adb.org/oga0009p.nsf/sancALLPublic?OpenView&count=999")):
    st, _, b = get(u, tries=1)
    gated[k] = {"url": u, "status": st, "cloudflare_challenge": b"Just a moment" in b or b"Attention Required" in b, "body_head": text(b)[:90]}
    time.sleep(1)
out["gated"] = gated

# ---------------------------------------------------------------- terms (verbatim quotes checked against the live page)
terms("idb_cc_by_4", "https://creativecommons.org/licenses/by/4.0/deed.en", "Share — copy and redistribute the material in any medium or format for any purpose, even commercially.")
terms("idb_dataset_page", "https://data.iadb.org/dataset/dataset-of-sanctioned-firms-and-individuals", "License Creative Commons Attribution 4.0 International")
terms("european_commission", "https://commission.europa.eu/legal-notice_en", "This means that reuse is allowed, provided appropriate credit is given and changes are indicated.")
terms("uk_ogl_v3", "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/", "exploit the Information commercially and non-commercially for example, by combining it with other Information, or by including it in your own product or application.")
terms("canada_pspc", "https://www.canada.ca/en/public-services-procurement/terms.html", "Unless otherwise specified, you may not reproduce materials on this site, in whole or in part, for the purposes of commercial redistribution without prior written permission from the copyright administrator.")
terms("adb", "https://www.adb.org/terms-use", "Users are restricted from reselling, redistributing or creating derivative works for commercial purposes without the express, written consent of ADB.")
terms("aiib", "https://www.aiib.org/en/general/copyright/index.html", "Users are restricted from making any derivative work or commercial use thereof, including without limitation reselling, redistributing or creating derivative work for commercial purposes without the prior written consent of the AIIB.")
terms("eib", "https://www.eib.org/en/terms-of-use.htm", "You may not modify, publish, transmit, display, participate in the transfer or sale, create derivative works, or in any way commercially exploit the content of this website without the express prior written permission of EIB")
terms("ebrd", "https://www.ebrd.com/home/terms-and-conditions.html", "for your personal, non-commercial use, without any right to resell, redistribute or create derivative works therefrom")
terms("worldbank", "https://www.worldbank.org/ext/en/legal/terms-conditions", "you may not make any derivative work or commercial use, including without limitation reselling them, charging to access them, charging to redistribute them, or charging for derivative works based on them, without the prior written consent of the relevant member institution(s).")

# ---------------------------------------------------------------- joins
J = {}
# 1. IDB firms located in Brazil <-> CEIS legal persons, normalised name (candidate). All pairs written.
idb_br = [r for r in IDBF if "brazil" in (r["Country"] + " " + r["Nationality"]).lower()]
pairs = []
for r in idb_br:
    n = norm(r["Title"])
    if n in ceis_names and not corporate(r["Title"]):
        J.setdefault("idb_ceis_matches_not_written_no_legal_form_word", 0)
        J["idb_ceis_matches_not_written_no_legal_form_word"] += 1
    if n in ceis_names and corporate(r["Title"]):
        cr = [c for c in CEISJ if n in {norm(c[k]) for k in ("NOME DO SANCIONADO", "RAZÃO SOCIAL - CADASTRO RECEITA", "NOME INFORMADO PELO ÓRGÃO SANCIONADOR", "NOME FANTASIA - CADASTRO RECEITA")}]
        pairs.append({
            "normalised": n,
            "idb": {"id": r["_id"], "firm": r["Title"].strip(), "country": r["Country"].strip(), "nationality": r["Nationality"].strip(), "from": r["From"][:10], "to": r["To"][:10], "practice": r["Prohibited Practice"].strip(), "source": r["Source"]},
            "ceis": [{"sanction_code": c["CÓDIGO DA SANÇÃO"], "cnpj": c["CPF OU CNPJ DO SANCIONADO"], "firm": c["NOME DO SANCIONADO"], "registry_legal_name": c["RAZÃO SOCIAL - CADASTRO RECEITA"], "category": c["CATEGORIA DA SANÇÃO"], "from": iso(c["DATA INÍCIO SANÇÃO"]), "to": iso(c["DATA FINAL SANÇÃO"]),
                      "body": c["ÓRGÃO SANCIONADOR"], "body_state": c["UF ÓRGÃO SANCIONADOR"], "legal_basis": c["FUNDAMENTAÇÃO LEGAL"][:100], "observation": c["OBSERVAÇÕES"][:260]} for c in cr[:3]],
            "ceis_rows": len(cr),
        })
cnpj_cited = [re.sub(r"\D", "", m.group(1)) for r in IDBF for m in [re.search(r"CNPJ:?\s*([\d. /-]{14,22})", r["Title"])] if m]
J["idb_ceis_name"] = {"mode": "candidate", "idb_firms_located_in_brazil": len(idb_br), "matched": sum(1 for r in idb_br if norm(r["Title"]) in ceis_names), "pairs_written": len(pairs),
                      "idb_firms_any_country_with_name_in_ceis": sum(1 for n in idb_by if n in ceis_names),
                      "idb_titles_citing_a_cnpj": len(cnpj_cited), "of_which_cnpj_in_ceis": sum(1 for c in cnpj_cited if c in {x["CPF OU CNPJ DO SANCIONADO"] for x in CEISJ}),
                      "pairs": pairs}

# 2. IDB firms <-> ADB firms, normalised name (candidate; ADB parked). Seeded sample of 20 for hand-check.
both = sorted(set(idb_by) & set(adb_by))
agree_country = sum(1 for n in both if ({country(r["Country"]) for r in idb_by[n]} | {country(r["Nationality"]) for r in idb_by[n]}) & {country(a["nationality"]) for a in adb_by[n]})
adb_no_country = sum(1 for n in both if not any(country(a["nationality"]) for a in adb_by[n]))
tot, hit, same_origin, origin_pairs = C(), C(), 0, C()
for n, rs in idb_by.items():
    for r in rs:
        tot[r["Source"]] += 1
        if n in adb_by:
            hit[r["Source"]] += 1
            io_ = r["Source"].replace(" cross debarment", "")
            ao = {origin(a["grounds"]) for a in adb_by[n]}
            origin_pairs[io_ + " -> " + "/".join(sorted(ao))] += 1
            if io_ in ao:
                same_origin += 1
random.seed(20261118)
writable = [n for n in both if all(corporate(r["Title"]) for r in idb_by[n]) and all(corporate(a["name"]) for a in adb_by[n])]
sample = random.sample(writable, min(20, len(writable)))
J["idb_adb_name"] = {
    "mode": "candidate", "note": "ADB is parked (terms); measured to show the cross-debarment overlap",
    "idb_distinct_firm_names": len(idb_by), "adb_distinct_firm_names": len(adb_by), "matched_distinct_names": len(both),
    "matched_names_also_agreeing_on_country": agree_country, "matched_names_where_adb_gives_no_country": adb_no_country,
    "idb_firm_rows_by_source": dict(tot), "idb_firm_rows_matched_by_source": dict(hit),
    "matched_idb_rows": sum(hit.values()), "matched_idb_rows_with_same_declared_origin": same_origin,
    "origin_idb_to_adb_top": dict(origin_pairs.most_common(12)),
    "sample_seed": 20261118, "sample_population_names_with_a_legal_form_word": len(writable),
    "sample_pairs": [{"normalised": n,
                      "idb": [{"firm": r["Title"].strip(), "country": r["Country"].strip(), "nationality": r["Nationality"].strip(), "from": r["From"][:10], "to": r["To"][:10], "practice": r["Prohibited Practice"].strip(), "source": r["Source"]} for r in idb_by[n][:2]],
                      "adb": [{"firm": a["name"].strip(), "nationality": a["nationality"], "from": a["effectiveDateOfSanction"], "to": a["lapseDateOfSanction"], "grounds": a["grounds"], "sanction": a["sanctionType"]} for a in adb_by[n][:2]]} for n in sample],
}

# 3. IDB firms <-> AIIB rows (no person flag on AIIB: only names equal to an IDB Firm row are compared; counts only)
tot3 = hit3 = same3 = 0
for n, rs in idb_by.items():
    if n in aiib_by:
        hit3 += 1
        if {r["Source"].replace(" cross debarment", "").upper() for r in rs} & {a["DEBARRED BY"].upper() for a in aiib_by[n]}:
            same3 += 1
J["idb_aiib_name"] = {"mode": "candidate", "note": "AIIB is parked (terms); counts only", "idb_distinct_firm_names": len(idb_by), "matched_distinct_names": hit3, "matched_with_same_declared_origin": same3}

# 4. declared: decision / case numbers cited in list entries
J["cited_decision_or_case_number"] = {"mode": "declared", "idb_firm_rows_citing": out["idb"]["firm_rows_citing_decision_or_case_number"], "adb_firm_rows_citing": out["adb"]["firm_rows_citing_decision_or_case_number"],
                                      "aiib_rows_citing": out["aiib"]["rows_citing_decision_or_case_number"], "note": "no list entry cites a Sanctions Board decision number or case number; CEIS carries the sanctioning body's own process number only"}
out["joins"] = J
# Probes made by hand earlier the same day while exploring (not re-run by this script), kept so the write-up cites nothing unrecorded.
out["exploration_probes_2026_11_18"] = [
    {"url": "https://www.iadb.org/en/who-we-are/transparency/sanctions-system/sanctioned-firms-and-individuals", "status": 403, "note": "Cloudflare 'Attention Required' on two probes before the final run"},
    {"url": "https://lnadbg4.adb.org/oga0009p.nsf/sancALLPublic?OpenView&count=999", "status": 500, "note": "HCL Notes: You are not authorized to access that database"},
    {"url": "https://commission.europa.eu/strategy-and-policy/eu-budget/how-it-works/annual-lifecycle/implementation/anti-fraud-measures/edes/database_en", "status": 429, "note": "twice"},
    {"url": "https://datacatalogapi.worldbank.org/ddhxext/Search?qname=dataset&q=debarred&$top=10", "status": 429, "note": "three probes, minutes apart"},
    {"url": "https://portaldatransparencia.gov.br/dados-abertos", "status": 405, "note": "AWS WAF Human Verification page; also /api-de-dados, /origem-dos-dados, /sobre/o-que-e-e-como-funciona"},
    {"url": "https://open.canada.ca/data/api/3/action/package_search?q=ineligible+suspended+suppliers&rows=5", "status": 200, "note": "1 hit, a service-standard indicator, not the supplier list: the list is not an Open Government Licence dataset"},
]
out["requests"] = NREQ[0]
json.dump(out, open("debar_measure.json", "w"), ensure_ascii=False, indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ("joins",)}, ensure_ascii=False)[:3000])
print("requests", NREQ[0])
