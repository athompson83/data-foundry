# 12 seeded TCR PDFs: text layer and the section headings a deterministic parser would anchor on.
import sys, json, random, subprocess, re, urllib.request, tempfile, os
sys.path.insert(0, '..'); from common import *
random.seed(20261018)
ids = random.sample(json.load(open("join.json"))["tcr_ids"], 12); res = []
d = tempfile.mkdtemp()
for i in ids:
    b = get(f"https://www.nhc.noaa.gov/data/tcr/{i}", raw=True)
    p = os.path.join(d, i); open(p, "wb").write(b)
    t = subprocess.run(["pdftotext", "-layout", p, "-"], capture_output=True, text=True).stdout
    res.append({"pdf": i, "bytes": len(b), "chars": len(t), "meteorological_history": bool(re.search(r"(?i)synoptic history|meteorological history", t)), "casualty_damage": bool(re.search(r"(?i)casualty and damage statistics", t)),
                "forecast_verification": bool(re.search(r"(?i)forecast and warning critique|forecast verification", t)), "has_deaths_figure": bool(re.search(r"\b(\d[\d,]*)\s+(?:direct\s+|indirect\s+)?deaths?", t))})
out = {"n": len(res), **{k: sum(r[k] for r in res) for k in ("meteorological_history", "casualty_damage", "forecast_verification", "has_deaths_figure")}, "text_nonempty": sum(1 for r in res if r["chars"] > 5000), "rows": res}
json.dump(out, open("text.json", "w"), indent=1); print({k: v for k, v in out.items() if k != "rows"})
