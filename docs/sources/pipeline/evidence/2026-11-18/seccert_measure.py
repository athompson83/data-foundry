#!/usr/bin/env python3
"""Screening 2026-11-18: security-certified-products (FIPS 140 module validations + Common Criteria certificates). Stdlib only.
Run from this directory with: python3 -I seccert_measure.py   -> writes seccert_measure.json (hand-check pairs included; verdicts in seccert_handcheck.json)
Output holds certificate numbers, organisation (vendor/lab) names, product names, dates and counts only. CMVP certificate pages and the
NIAP product-detail endpoint carry vendor contact persons: they are counted, never written (the NIAP detail endpoint is not used).
Set SECCERT_CACHE=<dir outside the repo> to reuse downloaded files between runs (off by default: everything is fetched live).

Members:
  NIST CMVP validated modules (csrc.nist.gov): search result tables for Active / Historical / Revoked + sampled certificate pages
    (standard, level, caveat prose, sunset date, lab, Security Policy PDF link).
  Common Criteria portal (commoncriteriaportal.org): certified_products.csv + certified_products-archived.csv, and sampled
    Security Target PDFs (free text; inflated with zlib).
  NIAP Product Compliant List (niap-ccevs.org): the open JSON list the public site reads (pcl_products_all, get_pcl_counts).
Parked / not members: Canada CCCS list (canada.ca terms), Spain CCN (legal notice), France ANSSI (Incapsula challenge);
  BSI and the FedRAMP marketplace JSON are reachability notes only.
Joins:
  declared: NIAP VID in the CC portal row's certification-report / security-target file (st_vid<n>-vr.pdf) = NIAP product_id.
  declared: FIPS 140 (CMVP) certificate number cited in a CC Security Target's text = CMVP certificate number.
  candidate: normalised vendor + product tokens, CMVP module <-> CC portal product (pairs written for hand-check).
"""
import json, re, os, sys, time, csv, io, zlib, random, hashlib, html as H, collections, urllib.request, urllib.error, urllib.parse

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}
NREQ = [0]
CACHE = os.environ.get("SECCERT_CACHE")


def get(u, timeout=180, tries=2):
    fn = None
    if CACHE:
        fn = os.path.join(CACHE, hashlib.md5(u.encode()).hexdigest())
        if os.path.exists(fn):
            return 200, "cached", open(fn, "rb").read()
    for i in range(tries):
        NREQ[0] += 1
        try:
            with urllib.request.urlopen(urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "*/*"}), timeout=timeout) as f:
                b = f.read()
                if fn:
                    open(fn, "wb").write(b)
                time.sleep(0.5)
                return f.status, f.headers.get("Content-Type", ""), b
        except urllib.error.HTTPError as e:
            if (e.code >= 500 or e.code == 429) and i < tries - 1:
                time.sleep(15)
                continue
            return e.code, e.headers.get("Content-Type", ""), e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, "", str(e).encode()
            time.sleep(5)


def text(b):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", b.decode("utf8", "replace"), flags=re.S)
    return re.sub(r"\s+", " ", H.unescape(re.sub(r"<[^>]+>", " ", t)))


def iso(mdy):
    m = re.match(r"(\d{1,2})/(\d{1,2})/(\d{4})", mdy or "")
    return "%s-%02d-%02d" % (m.group(3), int(m.group(1)), int(m.group(2))) if m else ""


def pdf_text(b):
    """Crude PDF text: inflate Flate streams, decode Tj/TJ strings; hex strings through the merged ToUnicode maps."""
    streams = []
    for m in re.finditer(rb"stream\r?\n", b):
        e = b.find(b"endstream", m.end())
        if e < 0:
            continue
        try:
            streams.append(zlib.decompressobj().decompress(b[m.end():e]))
        except Exception:
            pass
    cmap = {}
    for st in streams:
        if b"beginbfchar" not in st and b"beginbfrange" not in st:
            continue
        for blk in re.findall(rb"beginbfchar(.*?)endbfchar", st, re.S):
            for a, u in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
                try:
                    cmap.setdefault((len(a), int(a, 16)), bytes.fromhex(u.decode()).decode("utf-16-be", "replace"))
                except Exception:
                    pass
        for blk in re.findall(rb"beginbfrange(.*?)endbfrange", st, re.S):
            for a, z, u in re.findall(rb"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>", blk):
                lo, hi, base = int(a, 16), int(z, 16), int(u, 16)
                if hi - lo > 5000:
                    continue
                for k in range(lo, hi + 1):
                    try:
                        cmap.setdefault((len(a), k), chr(base + k - lo))
                    except Exception:
                        pass
    widths = sorted({w for w, _ in cmap}) or [4]

    def hexs(h):
        h = re.sub(rb"\s", b"", h)
        w = 4 if 4 in widths and len(h) % 4 == 0 else widths[0]
        o = []
        for i in range(0, len(h) - w + 1, w):
            k = int(h[i:i + w], 16)
            o.append(cmap.get((w, k), chr(k) if 32 <= k < 127 else ""))
        return "".join(o)

    def lit(s):
        s = re.sub(rb"\\([0-7]{1,3})", lambda m: bytes([int(m.group(1), 8) & 255]), s)
        s = re.sub(rb"\\([nrtbf()\\])", lambda m: {b"n": b"\n", b"r": b"", b"t": b" ", b"b": b"", b"f": b""}.get(m.group(1), m.group(1)), s)
        return s.decode("latin1")

    o = []
    tok = re.compile(rb"\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|\b(?:Tj|TJ|Td|TD|T\*|ET|Tm)\b|'|-?\d+\.?\d*")
    for st in streams:
        if b"BT" not in st or (b"Tj" not in st and b"TJ" not in st):
            continue
        for m in tok.finditer(st):
            t = m.group(0)
            if t[:1] == b"(":
                o.append(lit(t[1:-1]))
            elif t[:1] == b"<":
                o.append(hexs(t[1:-1]))
            elif t in (b"Td", b"TD", b"T*", b"ET", b"Tm", b"'"):
                o.append(" ")
            elif t not in (b"Tj", b"TJ"):
                try:
                    if float(t) < -200:
                        o.append(" ")
                except Exception:
                    pass
    return re.sub(r"\s+", " ", re.sub(r"\ben-[A-Z]{2}\b", " ", "".join(o)))


# ---------------------------------------------------------------- NIST CMVP
CMVP = "https://csrc.nist.gov/projects/cryptographic-module-validation-program"
cmvp = {}
c = {"lists": {}}
for status in ("Active", "Historical", "Revoked"):
    u = f"{CMVP}/validated-modules/search?SearchMode=Advanced&CertificateStatus={status}&ValidationYear=0"
    st, ct, b = get(u)
    t = b.decode("utf8", "replace")
    m = re.search(r"([\d,]+) certificates? match", t)
    n = 0
    for row in re.findall(r'<tr id="cert-row-\d+">(.*?)</tr>', t, re.S):
        tds = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        if len(tds) < 5:
            continue
        num = re.search(r"certificate/(\d+)", tds[0])
        if not num:
            continue
        dates = sorted(iso(d) for d in re.findall(r"\d{1,2}/\d{1,2}/\d{4}", tds[4]))
        cmvp[int(num.group(1))] = {"status": status, "vendor": text(tds[1].encode()).strip(), "module": text(tds[2].encode()).strip(),
                                   "type": text(tds[3].encode()).strip(), "first": dates[0] if dates else "", "last": dates[-1] if dates else ""}
        n += 1
    c["lists"][status] = {"http": st, "url": u, "bytes": len(b), "stated_total": int(m.group(1).replace(",", "")) if m else None, "rows_parsed": n}
c["certificates"] = len(cmvp)
c["list_rows_total"] = sum(v["rows_parsed"] for v in c["lists"].values())  # a certificate can sit in more than one status list
c["certificate_number_range"] = [min(cmvp), max(cmvp)] if cmvp else None
c["rows_without_vendor"] = sum(1 for v in cmvp.values() if not v["vendor"])
c["distinct_vendors"] = len({v["vendor"] for v in cmvp.values() if v["vendor"]})
c["by_module_type"] = dict(collections.Counter(v["type"] or "(blank)" for v in cmvp.values()).most_common())
c["newest_validation_date"] = max((v["last"] for v in cmvp.values()), default="")
c["oldest_validation_date"] = min((v["first"] for v in cmvp.values() if v["first"]), default="")
c["validated_per_year_last5"] = {y: sum(1 for v in cmvp.values() if v["first"][:4] == y) for y in ("2022", "2023", "2024", "2025", "2026")}
c["newest_rows"] = [{"certificate": k, **{f: cmvp[k][f] for f in ("vendor", "module", "type", "last")}} for k in sorted(cmvp, reverse=True) if cmvp[k]["vendor"]][:5]
# sampled certificate pages: field coverage (contact persons counted only)
random.seed(20261118)
pages = random.sample(sorted(k for k, v in cmvp.items() if v["vendor"]), 20) if len(cmvp) >= 20 else []
cov = collections.Counter()
samples = []
sp_checked = []
for k in pages:
    st, ct, b = get(f"{CMVP}/certificate/{k}")
    x = text(b)
    i = x.find("Certificate #")
    x = x[i:] if i >= 0 else x
    f = {"certificate": k, "http": st}
    for lab, rx in (("standard", r"Standard (FIPS 140-\d)"), ("status", r"Status (Active|Historical|Revoked)"), ("sunset_date", r"Sunset Date (\d{1,2}/\d{1,2}/\d{4})"),
                    ("overall_level", r"Overall Level (\d)"), ("embodiment", r"Embodiment (\S+)")):
        m = re.search(rx, x)
        if m:
            f[lab] = m.group(1)
            cov[lab] += 1
    m = re.search(r"Caveat (.{20,400}?) (?:Security Level Exceptions|Module Type)", x)
    if m:
        f["caveat_chars"] = len(m.group(1))
        cov["caveat_prose"] += 1
    m = re.search(r"Validation History Date Type Lab (\d{1,2}/\d{1,2}/\d{4}) (\w+) (.+?)(?: \d{1,2}/\d{1,2}/\d{4} | Vendor | HEADQUARTERS|$)", x)
    if m:
        f["first_history_row"] = {"date": iso(m.group(1)), "type": m.group(2), "lab": m.group(3).strip()[:80]}
        cov["validation_history_lab"] += 1
    sp = re.search(r'href="([^"]+security-policies/[^"]+\.pdf)"', b.decode("utf8", "replace"))
    if sp:
        f["security_policy"] = "https://csrc.nist.gov" + sp.group(1)
        cov["security_policy_pdf_link"] += 1
    if re.search(r"email-protection|[\w.]+@[\w.]+\.\w+", b.decode("utf8", "replace")):
        cov["pages_with_contact_email_not_written"] += 1
    samples.append(f)
c["certificate_pages_sampled"] = len(pages)
c["certificate_page_field_hits"] = dict(cov)
c["certificate_page_samples"] = samples
for f in samples[:3]:
    if "security_policy" in f:
        st, ct, b = get(f["security_policy"])
        t = pdf_text(b) if b[:4] == b"%PDF" else ""
        sp_checked.append({"url": f["security_policy"], "http": st, "bytes": len(b), "is_pdf": b[:4] == b"%PDF", "text_chars_extracted": len(t),
                           "mentions_non_proprietary_or_reproduced": bool(re.search(r"non-?\s*proprietary|reproduced", t, re.I))})
c["security_policy_pdfs_checked"] = sp_checked
out["nist_cmvp"] = c

# ---------------------------------------------------------------- Common Criteria portal
CCP = "https://www.commoncriteriaportal.org"
cc_rows = []
p = {"files": {}}
for name, arch in (("certified_products.csv", False), ("certified_products-archived.csv", True)):
    st, ct, b = get(f"{CCP}/products/{name}")
    rows = list(csv.DictReader(io.StringIO(b.decode("utf8", "replace")))) if st == 200 else []
    cols = list(rows[0].keys()) if rows else []
    good = [r for r in rows if re.fullmatch(r"[A-Z]{2}", r.get("Scheme") or "")]
    for r in good:
        r["_archived"] = arch
        for k in ("Name", "Manufacturer"):
            r[k] = H.unescape(r.get(k) or "").strip()
    cc_rows += good
    p["files"][name] = {"http": st, "content_type": ct, "bytes": len(b), "rows": len(rows), "rows_with_two_letter_scheme": len(good),
                        "columns": cols, "newest_certification_date": max((iso(r["Certification Date"]) for r in good), default=""),
                        "by_scheme": dict(collections.Counter(r["Scheme"] for r in good).most_common()),
                        "with_security_target_url": sum(1 for r in good if r["Security Target URL"]), "with_certification_report_url": sum(1 for r in good if r["Certification Report URL"]),
                        "with_eal_assurance_level": sum(1 for r in good if re.search(r"EAL\d", r["Assurance Level"] or "")),
                        "with_protection_profile": sum(1 for r in good if r["Protection Profile(s)"]), "with_maintenance_date": sum(1 for r in good if r["Maintenance Date"])}
p["rows_total"] = len(cc_rows)
p["distinct_products"] = len({(r["Scheme"], r["Manufacturer"], r["Name"], r["Certification Date"]) for r in cc_rows})
p["distinct_manufacturers"] = len({r["Manufacturer"] for r in cc_rows})
p["oldest_certification_date"] = min((iso(r["Certification Date"]) for r in cc_rows if iso(r["Certification Date"])), default="")
p["newest_rows"] = [{k: r[k] for k in ("Scheme", "Manufacturer", "Name", "Assurance Level", "Protection Profile(s)", "Certification Date")}
                    for r in sorted(cc_rows, key=lambda r: iso(r["Certification Date"]), reverse=True)[:5]]
st, ct, b = get(f"{CCP}/index.cfm")
x = text(b)
p["terms"] = {"home_http": st, "home_mentions_copyright_or_terms": bool(re.search(r"copyright|terms of use|terms and conditions|disclaimer|legal notice", x, re.I)), "home_visible_text_chars": len(x)}
st, ct, b = get(f"{CCP}/sitemap/index.cfm")
links = sorted(set(re.findall(r'href="(/[^"#]*)"', b.decode("utf8", "replace"))))
p["terms"]["sitemap_http"] = st
p["terms"]["sitemap_links"] = len(links)
p["terms"]["sitemap_links_naming_terms_copyright_legal"] = [l for l in links if re.search(r"terms|copyright|legal|disclaimer|licen", l, re.I)]
out["cc_portal"] = p

# ---------------------------------------------------------------- NIAP PCL
NIAP = "https://www.niap-ccevs.org"
n = {}
st, ct, b = get(f"{NIAP}/api/project/product/pcl_products_all/")
niap = json.loads(b) if st == 200 else []
n["list"] = {"http": st, "content_type": ct, "bytes": len(b), "rows": len(niap), "fields": sorted(niap[0].keys()) if niap else []}
n["by_status"] = dict(collections.Counter(r["status_sort"] for r in niap).most_common())
n["non_integer_product_ids"] = sum(1 for r in niap if not str(r["product_id"]).isdigit())
n["from_cc_portal_flag"] = dict(collections.Counter(str(r["from_cc_portal"]) for r in niap))
n["by_submitting_country"] = dict(collections.Counter(r["submitting_country_id_code"] for r in niap).most_common())
n["newest_certification_date"] = max(((r["certification_date"] or "")[:10] for r in niap), default="")
n["oldest_certification_date"] = min(((r["certification_date"] or "")[:10] for r in niap if r["certification_date"]), default="")
n["with_lab"] = sum(1 for r in niap if r.get("assigned_lab_name"))
n["with_protection_profile"] = sum(1 for r in niap if r.get("protection_profiles"))
n["distinct_vendors"] = len({r["vendor_id_name"] for r in niap})
n["newest_rows"] = [{"product_id": r["product_id"], "vendor": r["vendor_id_name"], "product": r["product_name"], "lab": r["assigned_lab_name"],
                     "certification_date": (r["certification_date"] or "")[:10], "pps": [q["pp_short_name"] for q in r["protection_profiles"]]}
                    for r in sorted((r for r in niap if r["status_sort"] == "Certified"), key=lambda r: r["certification_date"] or "", reverse=True)[:5]]
st, ct, b = get(f"{NIAP}/api/project/product/get_pcl_counts/")
n["counts_endpoint"] = {"http": st, "body": json.loads(b) if st == 200 else None}
st, ct, b = get(f"{NIAP}/robots.txt")
n["robots_txt"] = {"http": st, "body": b.decode("utf8", "replace")[:200]}
st, ct, b = get(f"{NIAP}/products")
n["site_shell"] = {"http": st, "bytes": len(b), "is_javascript_app_shell": b"enable JavaScript" in b, "visible_text_chars": len(text(b).strip())}
n["note"] = "the per-product detail endpoint (pcl_products/<id>/) returns vendor contact persons; it is not used here"
out["niap_pcl"] = n

# ---------------------------------------------------------------- join A: NIAP VID (declared)
niap_by_id = {str(r["product_id"]): r for r in niap}


def vid(r):
    m = re.search(r"vid(\d{3,5})", (r["Certification Report URL"] or "") + " " + (r["Security Target URL"] or ""), re.I)
    return m.group(1).lstrip("0") if m else None


def nv(s):
    s = re.sub(r"[^a-z0-9 ]", " ", H.unescape(s or "").lower().replace("&", " "))
    drop = {"inc", "incorporated", "corp", "corporation", "ltd", "limited", "llc", "co", "company", "gmbh", "ag", "sa", "sas", "bv", "nv", "plc", "the", "lp",
            "a", "an", "of", "and", "pte", "pty", "kk", "srl", "spa", "ab", "as", "oy", "holdings", "international", "development"}
    return " ".join(w for w in s.split() if w not in drop)


ja = {}
us = [r for r in cc_rows if r["Scheme"] == "US"]
us_keyed = {}
for r in us:
    us_keyed.setdefault((r["Name"], r["Certification Date"], r["_archived"]), r)
us_d = list(us_keyed.values())
with_vid = [(r, vid(r)) for r in us_d if vid(r)]
matched = [(r, v) for r, v in with_vid if v in niap_by_id]
ja["cc_us_rows"] = len(us)
ja["cc_us_distinct_products"] = len(us_d)
ja["cc_us_distinct_with_vid_in_file"] = len(with_vid)
ja["matched_to_niap_product_id"] = len(matched)
ja["matched_active"] = sum(1 for r, v in matched if not r["_archived"])
ja["active_with_vid"] = sum(1 for r, v in with_vid if not r["_archived"])
ja["matched_archived"] = sum(1 for r, v in matched if r["_archived"])
ja["archived_with_vid"] = sum(1 for r, v in with_vid if r["_archived"])
ja["distinct_vids_matched"] = len({v for r, v in matched})
ja["matched_same_certification_date"] = sum(1 for r, v in matched if iso(r["Certification Date"]) == (niap_by_id[v]["certification_date"] or "")[:10])
ja["matched_same_normalised_vendor"] = sum(1 for r, v in matched if nv(r["Manufacturer"]) == nv(niap_by_id[v]["vendor_id_name"]))
ja["unmatched_vids_sample"] = sorted({v for r, v in with_vid if v not in niap_by_id})[:15]
niap_us = {str(r["product_id"]) for r in niap if not r["from_cc_portal"] and r["status_sort"] != "In Progress"}
ja["niap_us_certified_or_archived"] = len(niap_us)
ja["niap_us_ids_found_in_cc_portal"] = len(niap_us & {v for r, v in with_vid})
random.seed(20261118)
ja["sample"] = [{"vid": v, "cc_name": r["Name"][:90], "cc_manufacturer": r["Manufacturer"], "cc_date": iso(r["Certification Date"]),
                 "niap_product": niap_by_id[v]["product_name"][:90], "niap_vendor": niap_by_id[v]["vendor_id_name"], "niap_date": (niap_by_id[v]["certification_date"] or "")[:10]}
                for r, v in random.sample(matched, min(8, len(matched)))]
out["join_niap_vid"] = ja

# ---------------------------------------------------------------- join B: CMVP certificate number cited in CC Security Targets (declared)
RX = re.compile(r"(?:FIPS\s*(?:PUB\s*)?140\s*-\s*[23]|CMVP)[^.]{0,120}?(?:cert(?:ificate)?s?\.?|validation)\s*(?:no\.?|number|num\.?|#)?\s*:?\s*#?\s*(\d{3,4})\b", re.I)
pool = {}
for r in cc_rows:
    if r["Scheme"] in ("US", "CA") and (r["Security Target URL"] or "").lower().endswith(".pdf"):
        pool.setdefault(r["Security Target URL"], r)
random.seed(20261118)
picks = random.sample(sorted(pool), min(60, len(pool)))
jb = {"pool_distinct_security_targets_us_ca": len(pool), "sampled": len(picks), "fetched_pdf": 0, "text_extracted": 0, "mention_fips_140": 0,
      "cite_a_certificate_number": 0, "cite_a_number_present_in_cmvp": 0, "cited_numbers": 0, "cited_numbers_in_cmvp": 0, "hits": [], "failures": []}
for su in picks:
    r = pool[su]
    u = urllib.parse.quote(su.replace("http://www.commoncriteriaportal.org:443", CCP), safe=":/%")
    st, ct, b = get(u)
    if st != 200 or b[:4] != b"%PDF":
        jb["failures"].append({"url": u, "http": st})
        continue
    jb["fetched_pdf"] += 1
    t = pdf_text(b)
    if len(t) < 2000:
        continue
    jb["text_extracted"] += 1
    if re.search(r"FIPS\s*(?:PUB\s*)?140", t):
        jb["mention_fips_140"] += 1
    cites = {}
    for m in RX.finditer(t):
        cites.setdefault(int(m.group(1)), t[max(0, m.start() - 40):m.end() + 30].strip())
    if not cites:
        continue
    jb["cite_a_certificate_number"] += 1
    jb["cited_numbers"] += len(cites)
    ok = {k: v for k, v in cites.items() if k in cmvp}
    jb["cited_numbers_in_cmvp"] += len(ok)
    if ok:
        jb["cite_a_number_present_in_cmvp"] += 1
    for k, ctx in cites.items():
        jb["hits"].append({"cc_scheme": r["Scheme"], "cc_manufacturer": r["Manufacturer"], "cc_name": r["Name"][:100], "cc_date": iso(r["Certification Date"]),
                           "security_target": u, "cited_certificate": k, "context": ctx, "in_cmvp": k in cmvp,
                           "cmvp_vendor": cmvp.get(k, {}).get("vendor"), "cmvp_module": cmvp.get(k, {}).get("module"), "cmvp_status": cmvp.get(k, {}).get("status"),
                           "cmvp_first_validated": cmvp.get(k, {}).get("first")})
out["join_cmvp_number_cited_in_st"] = jb

# ---------------------------------------------------------------- join C: vendor + product tokens (candidate)
STOP = set("cryptographic crypto module modules fips version versions software hardware firmware series with and the for security secure library object "
           "kernel system systems api core engine provider services service running platform family edition release build models model v on in by".split())


def toks(s, vendor):
    vt = set(nv(vendor).split())
    w = re.sub(r"[^a-z0-9 ]", " ", H.unescape(s or "").lower()).split()
    return {x for x in w if len(x) >= 3 and x not in STOP and x not in vt and not x.isdigit() and not re.fullmatch(r"v?\d[\d.x]*", x)}


cc_by_vendor = collections.defaultdict(list)
seen = set()
for r in cc_rows:
    key = (r["Scheme"], r["Manufacturer"], r["Name"], r["Certification Date"])
    if key in seen:
        continue
    seen.add(key)
    cc_by_vendor[nv(r["Manufacturer"])].append((toks(r["Name"], r["Manufacturer"]), r))
jc = {"cmvp_modules_with_vendor": 0, "cmvp_modules_whose_vendor_is_a_cc_manufacturer": 0, "cmvp_modules_with_product_match": 0}
pairs = []
for k, v in sorted(cmvp.items()):
    if not v["vendor"]:
        continue
    jc["cmvp_modules_with_vendor"] += 1
    cand = cc_by_vendor.get(nv(v["vendor"]))
    if not cand:
        continue
    jc["cmvp_modules_whose_vendor_is_a_cc_manufacturer"] += 1
    a = toks(v["module"], v["vendor"])
    best = None
    for b_, r in cand:
        sh = a & b_
        if len(sh) >= 2 and len(sh) / len(a | b_) >= 0.5:
            sc = (len(sh) / len(a | b_), iso(r["Certification Date"]))
            if best is None or sc > best[0]:
                best = (sc, r, sorted(sh))
    if best:
        jc["cmvp_modules_with_product_match"] += 1
        r = best[1]
        pairs.append({"cmvp_certificate": k, "cmvp_vendor": v["vendor"], "cmvp_module": v["module"], "cmvp_type": v["type"], "cmvp_validated": v["first"], "cmvp_status": v["status"],
                      "cc_scheme": r["Scheme"], "cc_manufacturer": r["Manufacturer"], "cc_name": r["Name"][:160], "cc_category": r["Category"], "cc_date": iso(r["Certification Date"]),
                      "cc_assurance": r["Assurance Level"], "shared_tokens": best[2], "jaccard": round(best[0][0], 2)})
jc["rule"] = "same normalised vendor, >= 2 shared product tokens (stop words, vendor words and version numbers removed), Jaccard >= 0.5; best CC row per CMVP module"
random.seed(20261118)
jc["handcheck_pairs"] = random.sample(pairs, min(20, len(pairs)))
out["join_vendor_product_tokens"] = jc

# ---------------------------------------------------------------- parked / other sources and terms pages
o = {}
st, ct, b = get("https://www.cyber.gc.ca/en/tools-services/common-criteria/certified-products")
t = b.decode("utf8", "replace")
rows = re.findall(r"<tr><td>(.*?)</tr>", t, re.S)
o["ca_cccs"] = {"http": st, "bytes": len(b), "table_rows": len(rows), "newest_certificate_date": max(re.findall(r'<span class="nowrap">(\d{4}-\d{2}-\d{2})</span>', t), default=""),
                "terms_link_is_canada_ca": "https://www.canada.ca/en/transparency/terms.html" in t}
st, ct, b = get("https://oc.ccn.cni.es/en/certified-products/certified-products")
o["es_ccn"] = {"http": st, "bytes": len(b), "mentions_certification_date": "Certification date" in text(b)}
st, ct, b = get("https://cyber.gouv.fr/produits-certifies")
o["fr_anssi"] = {"http": st, "bytes": len(b), "incapsula_challenge": b"_Incapsula_Resource" in b}
st, ct, b = get("https://www.bsi.bund.de/EN/Themen/Unternehmen-und-Organisationen/Standards-und-Zertifizierung/Zertifizierung-und-Anerkennung/Zertifizierung-von-Produkten/Zertifizierung-nach-CC/Zertifizierte-Produkte-nach-CC/zertifizierte-produkte-nach-cc_node.html")
o["de_bsi"] = {"http": st, "bytes": len(b), "certificate_ids_on_index_page": len(set(re.findall(r"BSI-DSZ-CC-\d{4}", b.decode("utf8", "replace")))), "note": "category index only; not screened further"}
st, ct, b = get("https://raw.githubusercontent.com/GSA/marketplace-fedramp-gov-data/main/data.json")
try:
    d = json.loads(b)
    o["us_fedramp"] = {"http": st, "bytes": len(b), "last_change": d["meta"]["last_change"], "total": d["data"]["Metrics"]["total"],
                       "note": "cloud service authorisations, a different entity type; not a member"}
except Exception:
    o["us_fedramp"] = {"http": st, "bytes": len(b)}
out["other_sources"] = o

TERMS = [
    ("nist", "https://www.nist.gov/oism/copyrights", "With the exception of material marked as copyrighted, information presented on NIST sites are considered public information and may be distributed or copied."),
    ("canada_ca", "https://www.canada.ca/en/transparency/terms.html", "Unless otherwise specified, you may not reproduce materials on this site, in whole or in part, for the purposes of commercial redistribution without prior written permission from the copyright administrator."),
    ("es_ccn", "https://oc.ccn.cni.es/en/legal-advice", "is totally prohibited unless previous written authorization from the CCN is provided."),
]
out["terms"] = {}
for key, u, quote in TERMS:
    st, ct, b = get(u)
    out["terms"][key] = {"url": u, "http": st, "quote": quote, "quote_found_verbatim": quote in text(b)}

out["requests"] = NREQ[0]
json.dump(out, open("seccert_measure.json", "w"), indent=1, ensure_ascii=False)
print(json.dumps({k: (v if not isinstance(v, dict) else "...") for k, v in out.items()}))
print("bytes", os.path.getsize("seccert_measure.json"))
