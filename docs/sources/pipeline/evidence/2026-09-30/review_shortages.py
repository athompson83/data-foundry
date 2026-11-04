"""Hand review of the 30 EMA shortage entries that shared a token with an FDA shortage generic name (grants_shortages.json).
A match is correct only when both name the same active substance. The verdict list below is the reviewer's judgement, recorded here."""
import json

WRONG = {"concentrate of proteolytic enzymes enriched in bromelain": "different substance (cromolyn)", "pancreas powder;pancrelipase": "token 'powder' only",
         "insulin human": "different insulin (glargine)", "insulin degludec": "different insulin (glargine)", "insulin aspart": "different insulin (glargine)",
         "insulin lispro": "different insulin (glargine)", "amoxicillin;clavulanic acid": "token 'acid' only", "eptacog alfa (activated)": "token 'activated' only",
         "ceftolozane;tazobactam": "only tazobactam shared, partner substance differs", "dibotermin alfa": "token 'alfa' only"}
data = json.load(open("grants_shortages.json"))["shortages"]["candidates"]
rows = []
for m in data:
    reason = next((why for name, why in WRONG.items() if m["ema_inn"].lower().startswith(name)), None)
    rows.append({**m, "same_active_substance": reason is None, "reason": reason})
result = {"checked": len(rows), "correct": sum(r["same_active_substance"] for r in rows), "rows": rows}
json.dump(result, open("shortage_review.json", "w"), indent=1)
print(result["correct"], "/", result["checked"])
