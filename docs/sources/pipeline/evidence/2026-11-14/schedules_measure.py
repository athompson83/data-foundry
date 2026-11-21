#!/usr/bin/env python3
"""Screening 2026-11-14: controlled-substance-schedules. Fetches every source live (stdlib only).
Run from this directory with: python3 -I schedules_measure.py   -> writes schedules_measure.json
Output holds identifiers, substance names (public law text) and counts only."""
import json, re, time, urllib.request, urllib.parse, xml.etree.ElementTree as ET, html as H

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
out = {"run_date": time.strftime("%Y-%m-%d")}


def get(u, tries=3):
    for i in range(tries):
        try:
            r = urllib.request.Request(u, headers={"User-Agent": UA, "Accept-Encoding": "identity"})
            with urllib.request.urlopen(r, timeout=90) as f:
                return f.status, f.geturl(), f.read()
        except urllib.error.HTTPError as e:
            if e.code >= 500 and i < tries - 1:
                time.sleep(20)
                continue
            return e.code, u, e.read()
        except Exception as e:
            if i == tries - 1:
                return 0, u, str(e).encode()
            time.sleep(3)


def clean_name(s):
    """Substance name with explanatory annotations removed and chemical structure kept (Codex review, PR #88).

    Locant commas ("3,4,5-", "N,N-") and attached structural groups ("1-(1-phenylcyclohexyl)piperidine") are part of
    the name. Removed: a parenthetical preceded by whitespace (" (other names: ...)", " (PCP)"), a list separator
    (comma or semicolon followed by whitespace) and everything after it, and trailing salt/derivative clauses.
    """
    s = " ".join((s or "").split())
    s = re.sub(r"^\(\w{1,4}\)\s+", "", s)  # list enumerators such as "(i) Codeine"
    s = re.sub(r"\s*-\s+|\s+-(?=\S)", "-", s)  # XML italic spacing: "Acetyl- alpha -methyl" -> "Acetyl-alpha-methyl"
    out, depth, drop = [], 0, False
    for i, ch in enumerate(s):  # drop balanced parentheticals that follow whitespace; keep attached structural groups
        if ch == "(":
            if depth == 0:
                drop = i > 0 and s[i - 1] == " "
            depth += 1
        if not (drop and depth > 0):
            out.append(ch)
        if ch == ")" and depth > 0:
            depth -= 1
            if depth == 0:
                drop = False
    s = " ".join("".join(out).split())
    s = re.split(r"[,;]\s(?!\d)|\s[,;]", s)[0]  # "3, 17-dione" is a locant list, not a separator
    s = re.sub(r"(?i)\s*\b(and |or )?(any|their|its) (salts?|preparations?|derivatives?|isomers?)\b.*$", "", s)
    return s.strip().rstrip(".,;: ")


def norm(s):
    s = re.sub(r"[^a-z0-9]+", "", clean_name(s).lower())
    return s


def txt(e):
    return " ".join("".join(e.itertext()).split())


# --- 1. eCFR versioner API (named route) ---------------------------------
s, u, b = get("https://www.ecfr.gov/api/versioner/v1/full/2026-11-01/title-21.xml?part=1308")
out["ecfr_api"] = {"status": s, "body_head": b[:160].decode("utf8", "replace")}

# --- 2. GovInfo annual CFR 21 CFR 1308.11-1308.15 (2025 edition) ----------
us = []
fr_cites = []
out["cfr_sections"] = {}
for sec, sched in [("11", "I"), ("12", "II"), ("13", "III"), ("14", "IV"), ("15", "V")]:
    s, u, b = get(f"https://www.govinfo.gov/content/pkg/CFR-2025-title21-vol9/xml/CFR-2025-title21-vol9-sec1308-{sec}.xml")
    if s != 200:
        out["cfr_sections"][sec] = {"status": s}
        continue
    root = ET.fromstring(b)
    date = root.findtext(".//DATE")
    for c in re.findall(r"\b(\d{2}) FR (\d{3,6})\b", b.decode("utf8", "replace")):
        if c not in fr_cites:
            fr_cites.append(c)
    n = 0
    for row in root.iter("ROW"):
        ents = row.findall("ENT")
        if len(ents) >= 2:
            name, code = txt(ents[0]), txt(ents[-1])
            if re.fullmatch(r"\d{4}", code):
                name = re.sub(r"^\(\d+\)\s*", "", name)
                us.append({"schedule": sched, "name": name, "dea_code": code})
                n += 1
    out["cfr_sections"][sec] = {"status": s, "edition_date": date, "rows_with_dea_code": n, "bytes": len(b)}
    time.sleep(0.5)
out["us_rows"] = len(us)
out["us_distinct_dea_codes"] = len({r["dea_code"] for r in us})
out["us_rows_with_cas"] = 0  # the CFR table carries name + DEA code only
us_codes = {}
for r in us:
    us_codes.setdefault(r["dea_code"], []).append(r)

# --- 3. Federal Register API: DEA scheduling documents --------------------
q = ("https://www.federalregister.gov/api/v1/documents.json?per_page=100&order=newest"
     "&conditions[agencies][]=drug-enforcement-administration&conditions[term]=%22Schedules+of+Controlled+Substances%22"
     "&conditions[type][]=RULE&fields[]=document_number&fields[]=publication_date&fields[]=title&fields[]=cfr_references&fields[]=docket_ids")
s, u, b = get(q.replace("[", "%5B").replace("]", "%5D"))
fr = json.loads(b) if s == 200 else {}
out["fr_status"] = s
out["fr_rule_count"] = fr.get("count")
res = fr.get("results", [])
out["fr_newest"] = [(r["publication_date"], r["document_number"], r["title"][:110]) for r in res[:5]]
out["fr_with_cfr_ref_1308"] = sum(any(str(c.get("part")) == "1308" for c in (r.get("cfr_references") or [])) for r in res)
out["fr_sample_size"] = len(res)
s2, u2, b2 = get("https://www.federalregister.gov/documents/full_text/text/2026/11/12/2026-23075.txt")
out["fr_fulltext_route"] = {"status": s2, "final_url": u2, "is_unblock_page": "unblock.federalregister.gov" in u2}

# Join: FR scheduling rule amendatory text "(n) Name ..... 1234" -> DEA code in the CFR 2025 edition table.
# Only rules published before the CFR edition date (2025-04-01) can appear in that edition. The FR document
# text is read from GovInfo because the federalregister.gov full-text route redirects to an unblock page.
# (The CFR text also cites FR pages, but a page-to-document link resolved to an unrelated document on test.)
out["cfr_fr_citations"] = len(fr_cites)
placement = [r for r in res if r["publication_date"] < "2025-03-15"
             and re.search(r"(?i)placement|temporary|specific listing|control of", r["title"])][:12]
checks = []
resolved = 0
for r in placement:
    d = r["publication_date"]
    s, u, b = get(f"https://www.govinfo.gov/content/pkg/FR-{d}/html/{r['document_number']}.htm")
    if s != 200:
        continue
    resolved += 1
    t = H.unescape(re.sub(r"<[^>]+>", " ", b.decode("utf8", "replace")))
    # amendatory entries: "(70) N-phenyl-...acetamide, its    9868\n isomers, ... other name: ...........\n"
    for m in re.finditer(r"(?m)^\((\d+)\)\s+(.+?)(?=^\(\d+\)\s|^\s*$|\Z)", t, re.S):
        ent = m.group(2)
        cm = re.search(r"(?:\s{3,}|\.{3,}\s*)(\d{4})\b", ent)
        if not cm:
            continue
        code = cm.group(1)
        nm = " ".join(re.sub(r"\.{3,}|\s{3,}\d{4}\b", " ", ent).split())
        cfr = us_codes.get(code)
        key = lambda x: re.sub(r"[^a-z0-9]", "", x.lower())[:20]
        checks.append({"fr_doc": r["document_number"], "fr_date": d, "dea_code": code,
                       "in_cfr_2025": bool(cfr),
                       "name_prefix_equal": bool(cfr) and any(key(nm) == key(c["name"]) for c in cfr),
                       "fr_name": nm[:90], "cfr_name": cfr[0]["name"][:90] if cfr else None})
    time.sleep(1)
out["fr_placement_docs_resolved"] = f"{resolved}/{len(placement)}"
out["fr_cfr_join_rows"] = len(checks)
out["fr_cfr_join_code_found"] = sum(c["in_cfr_2025"] for c in checks)
out["fr_cfr_join_name_prefix_equal"] = sum(c["name_prefix_equal"] for c in checks)
out["fr_cfr_join_checks"] = checks

# --- 4. Canada CDSA schedules (Justice Laws XML) ---------------------------
s, u, b = get("https://laws-lois.justice.gc.ca/eng/XML/C-38.8.xml")
root = ET.fromstring(b)
out["ca_status"] = s
out["ca_last_amended"] = root.get("{http://justice.gc.ca/lims}lastAmendedDate")
ca = []
for sch in root.iter("Schedule"):
    hd = sch.find(".//ScheduleFormHeading")
    lab = txt(hd.find("Label")) if hd is not None and hd.find("Label") is not None else (txt(hd)[:15] if hd is not None else "")
    m = re.match(r"SCHEDULE ([IVX]+)", lab)
    if not m or m.group(1) not in ("I", "II", "III", "IV", "V"):
        continue
    for it in sch.iter("Item"):
        te = it.find("Text")
        if te is None:
            continue
        t = txt(te)
        if t.startswith("[Repealed"):
            continue
        ca.append({"schedule": m.group(1), "name": clean_name(t)[:120]})
out["ca_items"] = len(ca)
out["ca_items_by_schedule"] = {k: sum(1 for r in ca if r["schedule"] == k) for k in ("I", "II", "III", "IV", "V")}
out["ca_cas_pattern_hits"] = len(re.findall(rb"\b\d{2,7}-\d{2}-\d\b", b))

# --- 5. UK Misuse of Drugs Act 1971 schedule 2 (legislation.gov.uk XML) ---
s, u, b = get("https://www.legislation.gov.uk/ukpga/1971/38/schedule/2/data.xml")
root = ET.fromstring(b)
L = "{http://www.legislation.gov.uk/namespaces/legislation}"
out["uk_status"] = s
mm = re.search(rb"<dc:modified>([^<]*)", b)
out["uk_modified"] = mm.group(1).decode() if mm else None
uk = []
for part in root.iter(L + "Part"):
    nm = part.find(L + "Number")
    cls = {"Part I": "A", "Part II": "B", "Part III": "C"}.get(txt(nm) if nm is not None else "")
    if not cls:
        continue
    for li in part.iter(L + "ListItem"):
        t = txt(li)
        if len(t) > 3 and not t.lower().startswith(("any ", "the ")):
            uk.append({"class": cls, "name": clean_name(t)[:120]})
out["uk_items"] = len(uk)
out["uk_items_by_class"] = {k: sum(1 for r in uk if r["class"] == k) for k in "ABC"}
out["uk_cas_pattern_hits"] = len(re.findall(rb"\b\d{2,7}-\d{2}-\d\b", b))

# --- 6. Cross-jurisdiction name join (candidate) ---------------------------
usn = {norm(r["name"]): r for r in us if norm(r["name"])}
can = {norm(r["name"]): r for r in ca if norm(r["name"])}
ukn = {norm(r["name"]): r for r in uk if norm(r["name"])}
out["us_uk_name_matches"] = f"{len(set(usn) & set(ukn))}/{len(usn)}"
out["us_ca_name_matches"] = f"{len(set(usn) & set(can))}/{len(usn)}"

# --- 7. PubChem CAS resolution (name -> synonyms -> CAS-pattern) -----------
CAS = re.compile(r"^\d{2,7}-\d{2}-\d$")


def cas_ok(c):
    d = c.replace("-", "")
    return int(d[-1]) == sum(int(x) * (i + 1) for i, x in enumerate(reversed(d[:-1]))) % 10


def pubchem(name):
    name = clean_name(name)
    if not name:
        return {"status": None, "cid": None, "cas": []}
    s, u, b = get("https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/" + urllib.parse.quote(name) + "/synonyms/JSON")
    time.sleep(0.35)
    if s != 200:
        return {"status": s, "cid": None, "cas": []}
    info = json.loads(b)["InformationList"]["Information"][0]
    cas = [x for x in info.get("Synonym", []) if CAS.match(x) and cas_ok(x)]
    return {"status": s, "cid": info.get("CID"), "cas": cas[:3]}


def sample(rows, n):
    step = max(1, len(rows) // n)
    return rows[::step][:n]


pc = {}
for label, rows in (("us", us), ("ca", ca), ("uk", uk)):
    sm = sample(rows, 15)
    res_ = []
    for r in sm:
        p = pubchem(r["name"])
        res_.append({"name": r["name"][:80], "cid": p["cid"], "cas": p["cas"]})
    pc[label] = {"sampled": len(sm), "resolved_cid": sum(1 for x in res_ if x["cid"]),
                 "with_cas": sum(1 for x in res_ if x["cas"]), "rows": res_}
out["pubchem_resolution"] = pc

# CAS confirmation of US-UK name matches: same first CAS on both sides via PubChem (same name -> same query,
# so instead resolve the US name and UK name strings as written; differing spellings are the test)
pairs = []
for k in sorted(set(usn) & set(ukn))[:10]:
    a, c = pubchem(usn[k]["name"]), pubchem(ukn[k]["name"])
    pairs.append({"us_name": usn[k]["name"][:60], "uk_name": ukn[k]["name"][:60], "us_cid": a["cid"], "uk_cid": c["cid"],
                  "same_cid": bool(a["cid"]) and a["cid"] == c["cid"], "cas": a["cas"][:1]})
out["us_uk_pairs_checked"] = pairs
out["us_uk_pairs_same_cid"] = f"{sum(p['same_cid'] for p in pairs)}/{len(pairs)}"

json.dump(out, open("schedules_measure.json", "w"), indent=1)
print(json.dumps({k: v for k, v in out.items() if k not in ("fr_cfr_join_checks", "pubchem_resolution", "us_uk_pairs_checked")}, indent=1))
