"""Deterministic extraction hit rates on 24 seeded NHC Tropical Cyclone Reports (2023-2026 seasons).
Fields: casualty section, deaths, damage in US dollars, landfall, peak wind. Writes extract.json (per-report rows)."""
import json, random, re, subprocess, sys, tempfile, os, urllib.request
UA = {"User-Agent": "data-foundry-scout/1.0 (data@mail.proviciency.com)"}
ids = json.load(open("../../2026-10-18/tropical-cyclones/join.json"))["tcr_ids"]
random.seed(20261031); pick = random.sample(ids, 24)
tmp = tempfile.mkdtemp(); rows = []
def sect(t):
    m = re.search(r"(?is)casualty and damage statistics\s*(.{0,2500})", t)
    return m.group(1) if m else ""
for i in pick:
    b = urllib.request.urlopen(urllib.request.Request("https://www.nhc.noaa.gov/data/tcr/" + i, headers=UA), timeout=180).read()
    p = os.path.join(tmp, i); open(p, "wb").write(b)
    t = subprocess.run(["pdftotext", "-layout", p, "-"], capture_output=True, text=True).stdout
    s = sect(t); flat = re.sub(r"\s+", " ", s)
    deaths = re.search(r"\b(no|\d[\d,]*)\s+(?:direct\s+|indirect\s+)?(?:deaths?|fatalit\w+)\b", flat, re.I)
    damage = re.search(r"\$\s?(\d[\d,.]*)\s*(billion|million|thousand)?", flat)
    land = re.search(r"(?i)\blandfall\b[^.]{0,120}", re.sub(r"\s+", " ", t))
    wind = re.search(r"(?i)maximum sustained winds? (?:of )?(?:near |about )?(\d{2,3}) kt", re.sub(r"\s+", " ", t))
    rows.append({"pdf": i, "chars": len(t), "casualty_section": bool(s), "deaths": deaths.group(0) if deaths else None, "damage": damage.group(0) if damage else None,
                 "landfall": bool(land), "peak_wind_kt": int(wind.group(1)) if wind else None, "section_excerpt": flat[:240]})
o = {"n": len(rows), **{k: sum(1 for r in rows if r[k]) for k in ("casualty_section", "deaths", "damage", "landfall", "peak_wind_kt")}, "rows": rows}
json.dump(o, open("extract.json", "w"), indent=1); print({k: v for k, v in o.items() if k != "rows"})
