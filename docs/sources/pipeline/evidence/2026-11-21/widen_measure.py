#!/usr/bin/env python3
"""Round 30 (2026-11-21): widening the recall datasets with France's RappelConso (DGCCRF). Measures the
full export, the Safety Gate case numbers it carries as notice numbers, how many resolve in the European
Commission's Safety Gate weekly reports, and GTIN overlap with Safety Gate and CPSC. Writes
widen_measure.json. Stdlib only."""
import collections, gzip, html, json, random, re
from scoutlib import get, write

gunzip = lambda b: gzip.decompress(b) if b[:2] == b"\x1f\x8b" else b
out = {"run_date": "2026-11-21"}
DS = "https://data.economie.gouv.fr/api/explore/v2.1/catalog/datasets/rappelconso-v2-gtin-espaces"
meta = json.loads(gunzip(get("fr_meta.json", DS)))
fr = json.loads(gunzip(get("fr_rc.json", DS + "/exports/json", timeout=600)))

def gs1_valid(g):
    if not g.isdigit() or len(g) not in (8, 12, 13, 14):
        return False
    t = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(reversed(g[:-1])))
    return (10 - t % 10) % 10 == int(g[-1])
g14 = lambda g: g.zfill(14)
def fr_gtins(r):
    found = set()
    for item in r.get("identification_produits") or []:
        code = (item.split("$")[0] or "").strip().replace(" ", "")
        if gs1_valid(code) and len(code) >= 12:
            found.add(g14(code))
    return found

SG_NO = re.compile(r"^(?:sr|a1[12]|info)/\d{3,5}/\d{2}$", re.I)
cats = collections.Counter(r["categorie_produit"] for r in fr)
TEXT = ("motif_rappel", "risques_encourus", "description_complementaire_risque", "preconisations_sanitaires", "informations_complementaires_publiques", "conduites_a_tenir_par_le_consommateur")
d = meta["metas"]["default"]
for r in fr:
    r["_g"] = fr_gtins(r)
    r["_sg"] = (r.get("numero_fiche") or "").upper() if SG_NO.match(r.get("numero_fiche") or "") else None
nonfood = [r for r in fr if r["categorie_produit"] != "alimentation"]
sg_fr = [r for r in fr if r["_sg"]]
out["rappelconso"] = {
    "metadata": {k: d.get(k) for k in ("title", "license", "license_url", "modified", "data_processed", "records_count", "publisher")},
    "records": len(fr), "distinct_ids": len({r["id"] for r in fr}), "distinct_numero_fiche": len({r["numero_fiche"] for r in fr}), "fields": len(fr[0]) - 2,
    "by_category": dict(cats.most_common()), "non_food_records": len(nonfood),
    "oldest_publication": min(r["date_publication"] for r in fr)[:10], "newest_publication": max(r["date_publication"] for r in fr)[:10],
    "published_since_2026_11_01": sum(1 for r in fr if r["date_publication"] >= "2026-11-01"),
    "by_year": dict(sorted(collections.Counter(r["date_publication"][:4] for r in fr).items())),
    "records_with_version_above_1": sum(1 for r in fr if (r.get("numero_version") or 1) > 1),
    "records_with_valid_gtin": sum(1 for r in fr if r["_g"]), "non_food_records_with_valid_gtin": sum(1 for r in nonfood if r["_g"]),
    "distinct_gtin14": len(set().union(*(r["_g"] for r in fr))),
    "records_with_brand": sum(1 for r in fr if (r.get("marque_produit") or "").strip()),
    "free_text_characters_by_field": {f: sum(len(r.get(f) or "") for r in fr) for f in TEXT},
    "records_with_recall_reason_text": sum(1 for r in fr if (r.get("motif_rappel") or "").strip()),
    "records_with_image_link": sum(1 for r in fr if r.get("liens_vers_les_images")),
    "records_with_contact_number": sum(1 for r in fr if r.get("numero_contact")),
    "records_whose_notice_number_is_a_safety_gate_case_number": len(sg_fr),
    "safety_gate_numbered_by_category": dict(collections.Counter(r["categorie_produit"] for r in sg_fr).most_common()),
    "safety_gate_numbered_by_year": dict(sorted(collections.Counter(r["date_publication"][:4] for r in sg_fr).items())),
}
lic = get("etalab_open_licence_2.md", "https://raw.githubusercontent.com/etalab/licence-ouverte/master/open-licence.md").decode("utf-8")
out["etalab_open_licence_2_grant"] = re.sub(r"\s+", " ", lic.split('covered by this licence')[1].split("**The")[0]).strip()

# --- Safety Gate weekly reports ----------------------------------------------------------------------
lst = get("sg-list.xml", "https://ec.europa.eu/safety-gate-alerts/api/download/weeklyReport/list/xml/en").decode("utf-8", "replace")
reps = [(r, dte, html.unescape(u)) for r, dte, u in re.findall(r"<reference>(Report-\d+-\d+)</reference>\s*<publicationDate>([^<]+)</publicationDate>.*?<URL>([^<]+)</URL>", lst, re.S)]
key = lambda x: tuple(int(n) for n in re.findall(r"\d+", x[0]))
reps.sort(key=key, reverse=True)
first_sg_year = min(int(r["date_publication"][:4]) for r in sg_fr)
use = [x for x in reps if key(x)[0] >= first_sg_year - 1]
alerts = {}
for ref, dte, url in use:
    t = get(f"sg-{ref}.xml", url).decode("utf-8", "replace")
    for blk in re.findall(r"<notifications\b.*?</notifications>", t, re.S):
        def v(tag):
            m = re.search(rf"<{tag}>(?:<!\[CDATA\[(.*?)\]\]>|([^<]*))</{tag}>", blk, re.S)
            return ((m.group(1) or m.group(2) or "") if m else "").strip()
        case = v("caseNumber").upper()
        if case:
            codes = {g14(c) for c in re.findall(r"(?<!\d)\d{12,14}(?!\d)", v("barcode").replace(" ", "")) if gs1_valid(c)}
            alerts[case] = {"report": ref, "country": v("notifyingCountry"), "brand": v("brand"), "name": v("name"), "product": v("product"), "gtins": codes}
out["safety_gate_weekly_reports"] = {
    "reports_listed": len(reps), "reports_read": len(use), "oldest_report_read": use[-1][0], "newest_report_read": use[0][0], "newest_publication_date": use[0][1],
    "distinct_case_numbers": len(alerts), "alerts_notified_by_france": sum(1 for a in alerts.values() if a["country"].lower() == "france"),
    "alerts_with_valid_gtin": sum(1 for a in alerts.values() if a["gtins"]),
}

# --- Declared join: the Safety Gate case number that RappelConso uses as the notice number ------------------
hit = [r for r in sg_fr if r["_sg"] in alerts]
miss = [r for r in sg_fr if r["_sg"] not in alerts]
out["safety_gate_case_number_join"] = {
    "rappelconso_notices_numbered_with_a_safety_gate_case_number": len(sg_fr), "distinct_case_numbers": len({r["_sg"] for r in sg_fr}),
    "resolve_to_a_safety_gate_alert": len(hit), "distinct_case_numbers_resolved": len({r["_sg"] for r in hit}),
    "resolved_alert_notifying_country": dict(collections.Counter(alerts[r["_sg"]]["country"] for r in hit).most_common(5)),
    "unresolved": len(miss), "unresolved_by_year": dict(sorted(collections.Counter(r["date_publication"][:4] for r in miss).items())),
    "unresolved_by_prefix": dict(collections.Counter(r["_sg"].split("/")[0] for r in miss)), "resolved_by_prefix": dict(collections.Counter(r["_sg"].split("/")[0] for r in hit)),
    "resolved_pairs_where_both_sides_carry_a_gtin": sum(1 for r in hit if r["_g"] and alerts[r["_sg"]]["gtins"]),
    "resolved_pairs_sharing_a_gtin": sum(1 for r in hit if r["_g"] & alerts[r["_sg"]]["gtins"]),
    "safety_gate_alerts_notified_by_france": sum(1 for a in alerts.values() if a["country"].lower() == "france"),
    "french_notified_alerts_named_by_a_rappelconso_notice": len({r["_sg"] for r in hit if alerts[r["_sg"]]["country"].lower() == "france"}),
}
random.seed(20261121)
out["case_number_handcheck_sample"] = [{"numero_fiche": r["numero_fiche"], "fr_brand": r.get("marque_produit"), "fr_label": r.get("libelle"), "fr_category": r.get("sous_categorie_produit"),
                                        "sg_brand": alerts[r["_sg"]]["brand"], "sg_name": alerts[r["_sg"]]["name"], "sg_product": alerts[r["_sg"]]["product"], "sg_country": alerts[r["_sg"]]["country"]}
                                       for r in random.sample(sorted(hit, key=lambda r: r["id"]), 20)]

# --- GTIN joins (declared at product level; never merges recall events) ------------------------------
sg_by_g = collections.defaultdict(set)
for case, a in alerts.items():
    for g in a["gtins"]:
        sg_by_g[g].add(case)
nf_g = [r for r in nonfood if r["_g"]]
gt_hit = [r for r in nf_g if any(g in sg_by_g for g in r["_g"])]
cpsc = json.loads(get("cpsc_full.json", "https://www.saferproducts.gov/RestWebServices/Recall?format=json", timeout=600))
cp_by_g = collections.defaultdict(set)
for c in cpsc:
    for u in c.get("ProductUPCs") or []:
        code = re.sub(r"\D", "", u.get("UPC") or "")
        if gs1_valid(code) and len(code) >= 12:
            cp_by_g[g14(code)].add(c["RecallID"])
cp_hit = [r for r in fr if any(g in cp_by_g for g in r["_g"])]
random.seed(20261121)
out["gtin_handcheck_sample"] = [{"numero_fiche": r["numero_fiche"], "fr_brand": r.get("marque_produit"), "fr_label": r.get("libelle"), "fr_date": r["date_publication"][:10],
                                 "safety_gate": [{"case": c, "brand": alerts[c]["brand"], "name": alerts[c]["name"], "product": alerts[c]["product"], "country": alerts[c]["country"]} for g in sorted(r["_g"]) for c in sorted(sg_by_g.get(g, ()))][:3]}
                                for r in random.sample(sorted(gt_hit, key=lambda r: r["id"]), 20)]
out["gtin_joins"] = {
    "non_food_rappelconso_notices_with_valid_gtin": len(nf_g), "of_which_share_a_gtin_with_a_safety_gate_alert": len(gt_hit),
    "of_which_the_shared_gtin_alert_is_not_the_notice_s_own_case_number": sum(1 for r in gt_hit if not (r["_sg"] and any(r["_sg"] in sg_by_g[g] for g in r["_g"]))),
    "cpsc_recalls": len(cpsc), "cpsc_recalls_with_valid_upc": len({i for s in cp_by_g.values() for i in s}), "cpsc_distinct_gtin14": len(cp_by_g),
    "rappelconso_notices_with_valid_gtin": sum(1 for r in fr if r["_g"]), "rappelconso_notices_sharing_a_gtin_with_a_cpsc_recall": len(cp_hit),
    "cpsc_matches": [{"numero_fiche": r["numero_fiche"], "label": r.get("libelle"), "brand": r.get("marque_produit"), "shared_gtin14": sorted(g for g in r["_g"] if g in cp_by_g),
                      "cpsc": [{"RecallID": c["RecallID"], "RecallDate": (c.get("RecallDate") or "")[:10], "Title": c.get("Title")} for c in cpsc if c["RecallID"] in {i for g in r["_g"] for i in cp_by_g.get(g, ())}]} for r in cp_hit][:10],
}
write(__file__, out)
