#!/usr/bin/env python3
"""Round 35 (2026-11-28): top-level domains. Reads the IANA list of delegated TLDs, the ICANN gTLD registry
agreement table (JSON), the Public Suffix List, and 20 seeded IANA delegation record pages. The join is the TLD
label itself (A-label). Writes tld_measure.json. Stdlib only."""
import collections, json, random, re
import scoutlib as s
from termslib import check, visible

out = {"run_date": "2026-11-28"}
txt = s.get("iana_tlds.txt", "https://data.iana.org/TLD/tlds-alpha-by-domain.txt").decode("ascii").splitlines()
iana = {t.lower() for t in txt[1:] if t.strip()}
out["iana_tld_list"] = {"header": txt[0], "tlds": len(iana), "two_letter": sum(1 for t in iana if len(t) == 2), "idn_a_labels": sum(1 for t in iana if t.startswith("xn--"))}
g = json.loads(s.get("icann_gtlds.json", "https://www.icann.org/resources/registries/gtlds/v2/gtlds.json"))
gt = g["gTLDs"]
live = [x for x in gt if x.get("delegationDate") and not x.get("removalDate")]
out["icann_gtlds"] = {"updated": g.get("updatedOn"), "version": g.get("version"), "records": len(gt), "fields": sorted(gt[0].keys()),
    "delegated_and_not_removed": len(live), "with_removal_date": sum(1 for x in gt if x.get("removalDate")), "contract_terminated": sum(1 for x in gt if x.get("contractTerminated")),
    "specification_13_brand": sum(1 for x in gt if x.get("specification13")), "with_registry_operator": sum(1 for x in gt if x.get("registryOperator")),
    "distinct_registry_operators": len({x.get("registryOperator") for x in gt if x.get("registryOperator")}),
    "delegation_date_range": [min(x["delegationDate"] for x in gt if x.get("delegationDate")), max(x["delegationDate"] for x in gt if x.get("delegationDate"))]}
hit = [x for x in live if x["gTLD"].lower() in iana]
out["join_tld_label"] = {"icann_delegated_not_removed": len(live), "found_in_iana_list": len(hit), "not_found": [x["gTLD"] for x in live if x["gTLD"].lower() not in iana][:20],
    "icann_removed_still_in_iana_list": [x["gTLD"] for x in gt if x.get("removalDate") and x["gTLD"].lower() in iana][:20],
    "iana_tlds_longer_than_two_letters_not_in_icann_table": sorted(t for t in iana if len(t) > 2 and not t.startswith("xn--") and t not in {x["gTLD"].lower() for x in gt})[:20]}
psl = s.get("public_suffix_list.dat", "https://publicsuffix.org/list/public_suffix_list.dat").decode("utf-8")
icann_part = psl.split("// ===BEGIN ICANN DOMAINS===")[1].split("// ===END ICANN DOMAINS===")[0]
private_part = psl.split("// ===BEGIN PRIVATE DOMAINS===")[1]
def rules(part):
    return [l.strip() for l in part.splitlines() if l.strip() and not l.startswith("//")]
def tld_of(rule):
    return rule.lstrip("!*.").split(".")[-1].encode("idna").decode("ascii").lower()
ri, rp = rules(icann_part), rules(private_part)
psl_tlds = {tld_of(r) for r in ri}
out["public_suffix_list"] = {"version_lines": [l for l in psl.splitlines()[:12] if "VERSION" in l or "COMMIT" in l], "icann_rules": len(ri), "private_rules": len(rp),
    "wildcard_rules": sum(1 for r in ri + rp if r.startswith("*")), "exception_rules": sum(1 for r in ri + rp if r.startswith("!")),
    "comment_lines": sum(1 for l in psl.splitlines() if l.startswith("//")), "comment_characters": sum(len(l) for l in psl.splitlines() if l.startswith("//")),
    "comment_lines_citing_a_url": sum(1 for l in psl.splitlines() if l.startswith("//") and "http" in l),
    "tlds_of_icann_rules": len(psl_tlds), "of_those_in_iana_list": len(psl_tlds & iana), "psl_tlds_not_in_iana": sorted(psl_tlds - iana)[:20], "iana_tlds_without_a_psl_rule": sorted(iana - psl_tlds)[:20]}
random.seed(20261128)
sample = []
for x in random.sample(sorted(hit, key=lambda x: x["gTLD"]), 20):
    body, err = s.try_get(f"iana_rootdb_{x['gTLD']}.html", f"https://www.iana.org/domains/root/db/{x['gTLD']}.html")
    if err:
        sample.append({"tld": x["gTLD"], "error": err}); continue
    t = visible(body.decode("utf-8", "replace"))
    m = re.search(r"Manager\s+(.*?)\s+Contacts", t)
    org = m.group(1) if m else None
    sample.append({"tld": x["gTLD"], "icann_registry_operator": x.get("registryOperator"), "icann_delegation_date": x.get("delegationDate"),
        "iana_page_characters": len(t), "iana_manager_first_90_characters": (org or "")[:90],
        "manager_starts_with_icann_operator_name": bool(org and x.get("registryOperator") and org.lower().startswith(x["registryOperator"].lower())),
        "iana_delegated_since": (re.search(r"Delegated since (\d{4}-\d{2}-\d{2})", t) or [None, None])[1], "iana_record_last_updated": (re.search(r"Last Updated (\d{4}-\d{2}-\d{2})", t) or [None, None])[1],
        "has_whois_server": "WHOIS Server" in t, "has_rdap_base_url": "RDAP Base URLs" in t, "has_name_servers": bool(re.search(r"\bNS \S+", t)), "has_dnssec_ds": bool(re.search(r"\bDS \d+", t)),
        "has_delegation_report": bool(re.search(r"Related Information\s+\S", t)), "has_contacts_block": "Contacts" in t})
ok = [x for x in sample if "error" not in x]
out["iana_delegation_records_sample"] = {"requested": 20, "read": len(ok), "characters": sum(x["iana_page_characters"] for x in ok),
    "with_manager": sum(1 for x in ok if x["iana_manager_first_90_characters"]), "manager_starts_with_icann_operator_name": sum(x["manager_starts_with_icann_operator_name"] for x in ok),
    "with_delegated_since": sum(1 for x in ok if x["iana_delegated_since"]), "with_whois_server": sum(x["has_whois_server"] for x in ok), "with_rdap_base_url": sum(x["has_rdap_base_url"] for x in ok),
    "with_name_servers": sum(x["has_name_servers"] for x in ok), "with_dnssec_ds": sum(x["has_dnssec_ds"] for x in ok), "with_delegation_report": sum(x["has_delegation_report"] for x in ok),
    "with_contacts_block": sum(x["has_contacts_block"] for x in ok),
    "delegated_since_equals_icann_delegation_date": sum(1 for x in ok if x["iana_delegated_since"] and x["icann_delegation_date"] and x["iana_delegated_since"] == x["icann_delegation_date"][:10])}
out["handcheck_sample"] = sample
out["terms"] = {
    "iana": check("terms_iana.html", "https://www.iana.org/help/licensing-terms", [], ("CC0", "public domain", "Root Zone", "TLD")),
    "icann": check("terms_icann.html", "https://www.icann.org/privacy/tos", [], ("commercial", "reproduc", "redistribut", "permission", "license")),
    "psl": {"header_lines": psl.splitlines()[:4]},
}
s.write(__file__, out)
