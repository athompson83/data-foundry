"""Candidate (review-only) join: does an EU Safety Gate brand also appear in a
live CPSC recall title/description/product name? This never auto-links (AGENTS.md
rule 7); it only proposes candidates, a sample of which is then hand-checked below.
"""

import json
import re

GENERIC = {"original", "the", "new", "set", "pro", "max", "mini", "plus", "classic", "basic", "standard", "premium", "deluxe", "super", "ultra", "home", "style", "line"}


def norm(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def main() -> None:
    eu = json.load(open("../eu_records_sample.json"))
    cpsc = json.load(open("../raw/cpsc_recent.json"))

    cpsc_text = [
        (r["RecallNumber"], r["Title"], norm(r.get("Title", "") + " " + r.get("Description", "") + " " + " ".join(p.get("Name", "") for p in (r.get("Products") or []))))
        for r in cpsc
    ]

    matches = []
    for record in eu:
        brand = norm(record.get("brand"))
        if not brand or len(brand) < 4 or brand in GENERIC:
            continue
        for recall_no, title, text in cpsc_text:
            if re.search(r"\b" + re.escape(brand) + r"\b", text):
                matches.append({"eu_case": record["caseNumber"], "eu_brand": record["brand"], "eu_product": record["product"], "eu_model": record["model"], "cpsc_recall": recall_no, "cpsc_title": title})

    distinct_eu = sorted({m["eu_case"] for m in matches})
    non_generic_brand_count = sum(1 for r in eu if r.get("brand") and norm(r["brand"]) not in GENERIC and len(norm(r["brand"])) >= 4)
    print(f"EU records with a non-generic brand field (candidate-join eligible): {non_generic_brand_count}/{len(eu)}")
    print(f"distinct EU records with >=1 brand-token candidate match against the live CPSC sample: {len(distinct_eu)}/{len(eu)}")
    for case in distinct_eu:
        first = next(m for m in matches if m["eu_case"] == case)
        count = sum(1 for m in matches if m["eu_case"] == case)
        print(f"  {case}  brand={first['eu_brand']!r}  eu_product={first['eu_product']!r}  -> {count} CPSC candidate(s), e.g. {first['cpsc_title'][:90]!r}")

    print()
    print("Hand review (6 of the 13 distinct candidates, chosen across the frequency spread):")
    reviewed = ["SR/02399/26", "SR/02405/26", "SR/02414/26", "SR/02448/26", "SR/02496/26", "SR/02617/26"]
    verdicts = {
        "SR/02399/26": ("Seven", False, "EU 'Seven' furniture chair brand; CPSC hits are Shein toys / Aojieni teething toys - coincidental token match, not the same firm."),
        "SR/02405/26": ("Allegro", False, "EU 'Allegro' e-bike; CPSC hit is 'Lancaster Table & Seating Brand Allegro' plastic chairs - different firm, coincidental brand-name reuse."),
        "SR/02414/26": ("Husqvarna", True, "EU notice lists Husqvarna off-road motorcycle models FX350/450, FE 250/350/450/501, TE 150/250/300 MY22-24 (Austria); CPSC 26710 'KTM North America Recalls Off-Road Motorcycles' explicitly lists 'Husqvarna Models 2022 FE 350, 2022 FE 501, 2022 TE 150i...' - same brand family (KTM Group) and overlapping model codes."),
        "SR/02448/26": ("Shein", False, "EU notice: Shein cushion cover, chemical risk, Ireland. CPSC 26782/26732/26567: 'SHEIN Distribution Corporation Recalls Pull and Chew Montessori Teething Toys ...' - same distributor, but this dataset's entity is a recall notice about a specific product (README: 'grouped into recall_event clusters ... linked to affected products'), not a distributor; a cushion cover and a teething toy are different, unrelated recalled products, so sharing a distributor does not make this a same-record candidate. Distributor identity could be a separate reviewed enrichment, but is not counted as a positive product-level match here."),
        "SR/02496/26": ("Best", False, "EU 'Best' degreaser; CPSC hits are 'SUGIFT' pressure washers and 'Best Buy Insignia' gas ranges - coincidental common-word match, not the same firm."),
        "SR/02617/26": ("Torch", False, "EU 'Torch' toy gun set; CPSC hits are Fantastic Four cups and 'Jobon Torch Lighters' - coincidental common-word match, not the same firm."),
    }
    correct = 0
    for case in reviewed:
        brand, ok, note = verdicts[case]
        correct += 1 if ok else 0
        print(f"  {case} ({brand}): {'CORRECT' if ok else 'false positive'} - {note}")
    print(f"\nreviewed: {correct}/{len(reviewed)} correct")


if __name__ == "__main__":
    main()
