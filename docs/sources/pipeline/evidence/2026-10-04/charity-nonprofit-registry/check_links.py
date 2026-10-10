#!/usr/bin/env python3
"""Hand-check record for the website-domain and name candidate links measured by screen.py.

Judgement rule: a pair is `correct` when the two legal names (and, for name matches, the site and activities text)
show the same named organisation or a direct national affiliate of the same named parent. This is an affiliate
relationship between separate legal entities in different countries, NOT an identity merge. Platform / shared-host
domains and different local units (individual congregations, parishes, branches) are `wrong`.
Reads results.json, writes hand_check.json.
"""
import json, os
D = os.path.dirname(os.path.abspath(__file__))
r = json.load(open(os.path.join(D, "results.json")))
wrong = {
 "acnc-cra": {"bahai.org", "cycnow.com", "jw.org", "kingdomofjesuschrist.org", "kresy-siberia.org", "svenskakyrkan.se", "goethe.de"},
 "acnc-uk": {"africanrevival.com", "anu.edu.au", "bahai.org", "cambridge.org", "cdfcharity.org", "cmiaid.org", "fb.com", "fb.me", "healcharity.org", "lr.org", "m.facebook.com", "m.me", "none.com", "nowebsite.com", "oneschoolglobal.com", "paypal.com", "plymouthbrethrenchristianchurch.org", "purebhakti.com", "rccg.org", "sarzspiritfoundation.org", "soroptimistinternational.org", "tandfonline.com", "thisisyourbible.com", "tjc.org", "ucl.ac.uk", "web.facebook.com", "world-outreach.com"},
 "cra-uk": {"africanchildrenschoir.com", "bahai.org", "churchesofgod.info", "cibc.com", "e-clubhouse.org", "freewebs.com", "geocities.com", "medium.com", "members.tjc.org", "mun.ca", "queensu.ca", "swaminarayan.info", "tjc.org", "yasodhara.org"},
}
platform = {"facebook.com", "google.com", "instagram.com", "linktr.ee", "sites.google.com", "business.facebook.com", "tinyurl.com", "cafe.daum.net", "youtube.com", "linkedin.com", "twitter.com", "wix.com", "weebly.com", "godaddysites.com", "squarespace.com", "wordpress.com", "x.com"}
total = {"acnc-cra": 36, "acnc-uk": 151, "cra-uk": 59}  # shared domains left after dropping `platform`, as printed in the review run
out = {"rule": __doc__.strip().splitlines()[3:7], "website_domain": {}}
for k, t in total.items():
    shared = r["linkage_candidates"][k]["website_domain_matches"]
    out["website_domain"][k] = {"shared_domains_raw": shared, "after_dropping_platform_domains": t, "wrong": len(wrong[k]), "correct": t - len(wrong[k]), "checked": t, "wrong_domains": sorted(wrong[k])}
# name-only: random.seed(7) sample of 25 ACNC-vs-UK exact normalised-name matches (see notes.md)
out["name_only_acnc_uk"] = {"checked": 25, "correct": 8, "correct_names": ["baps charities", "hothouse theatre", "empart", "justsow giving", "muslim care", "british council", "child migrants", "bible league"]}
# IRS 990 XML sample (1,416 distinct names from the first 8MB of 2026_TEOS_XML_01A) vs the three registers, exact normalised name only.
# Hand-checked using city, mission text and website: only same-name affiliates counted.
out["irs990_sample_name"] = {
    "uk": {"matched": 15, "checked": 15, "correct": 2, "correct_names": ["love146", "variety the children's charity"]},
    "cra": {"matched": 12, "checked": 12, "correct": 1, "correct_names": ["the mission of tao-confucianism"]},
    "acnc": {"matched": 5, "checked": 5, "correct": 0, "correct_names": []},
}
json.dump(out, open(os.path.join(D, "hand_check.json"), "w"), indent=1)
print(json.dumps({k: (v["correct"], v["checked"]) for k, v in out["website_domain"].items()}), out["name_only_acnc_uk"]["correct"], "/25")
