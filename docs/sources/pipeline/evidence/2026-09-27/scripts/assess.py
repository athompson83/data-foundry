import json, re, statistics as st

def pct(n, d): return f"{n}/{d} ({100*n//max(d,1)}%)"

# ---------------- Labels ----------------
L = json.load(open('rx100.json'))['results'] + json.load(open('rx20.json'))['results']
N = len(L)
print("LABELS n=", N, "raw bytes/label median", st.median(len(json.dumps(r)) for r in L))
secs = ['boxed_warning','contraindications','drug_interactions','dosage_and_administration','pregnancy','use_in_specific_populations','lactation','nursing_mothers','pediatric_use','geriatric_use','warnings_and_cautions','adverse_reactions']
for s in secs:
    ls = [len(' '.join(r[s])) for r in L if s in r]
    if ls: print(f"  {s:30s} present {pct(len(ls),N)} median chars {int(st.median(ls))} max {max(ls)}")
ids = dict(ndc=sum(1 for r in L if r.get('openfda',{}).get('product_ndc')),
           rxcui=sum(1 for r in L if r.get('openfda',{}).get('rxcui')),
           set_id=sum(1 for r in L if r.get('set_id')))
print("  ids", {k: pct(v, N) for k, v in ids.items()})

txt = lambda r, s: ' '.join(r.get(s, []))
CYP = re.compile(r'\bCYP\s?\d[A-Z]\d{1,2}\b')
STRENGTH = re.compile(r'\b(strong|moderate|weak)\s+(CYP\s?\d[A-Z]\d{1,2}\s+)?(inhibitor|inducer)s?', re.I)
ACTION = re.compile(r'\b(avoid (concomitant|coadministration|use)|contraindicated|reduce the (dose|dosage)|dose adjustment|not recommended|monitor)', re.I)
DOSE = re.compile(r'\b\d+(\.\d+)?\s?(mg|mcg|g|units?|mL)(/kg|/m2|/m²)?\b', re.I)
FREQ = re.compile(r'\b(once|twice|three times|four times)\s+(daily|a day|weekly)|\bevery\s+\d+\s+(hours|days|weeks)\b|\bq\d+h\b', re.I)
RENAL = re.compile(r'(CLcr|CrCl|creatinine clearance|eGFR)\s*(<|>|≤|≥|less than|greater than|of)?\s*\d+', re.I)
HEPATIC = re.compile(r'Child[- ]Pugh\s+(class\s+)?[ABC]\b|(mild|moderate|severe) hepatic impairment', re.I)
PED = re.compile(r'\b(\d+)\s*(years?|months?|kg)\b', re.I)
PLLR = re.compile(r'Risk Summary', re.I)
LACT = re.compile(r'\b(lactation|breastfe\w+|breast[- ]fe\w+|human milk)\b', re.I)
BW_TOPIC = re.compile(r'WARNING:\s*([A-Z ,;\-/()AND]+?)(?=\s{1,}|See full)', re.S)
CI_BULLET = re.compile(r'(•|^\s*[-*]|\(\d+\.\d+\))', re.M)

c = dict(cyp=0, strength=0, action=0, dose=0, freq=0, renal=0, hepatic=0, pllr=0, lact=0, bwtitle=0, ci_list=0)
bw = []
for r in L:
    di, da = txt(r,'drug_interactions'), txt(r,'dosage_and_administration')
    pop = txt(r,'use_in_specific_populations') + txt(r,'pregnancy') + txt(r,'nursing_mothers') + txt(r,'lactation')
    if CYP.search(di): c['cyp'] += 1
    if STRENGTH.search(di): c['strength'] += 1
    if ACTION.search(di): c['action'] += 1
    if DOSE.search(da): c['dose'] += 1
    if FREQ.search(da): c['freq'] += 1
    if RENAL.search(da + pop): c['renal'] += 1
    if HEPATIC.search(da + pop): c['hepatic'] += 1
    if PLLR.search(pop): c['pllr'] += 1
    if LACT.search(pop): c['lact'] += 1
    b = txt(r, 'boxed_warning')
    m = BW_TOPIC.search(b)
    if b and m: c['bwtitle'] += 1; bw.append(m.group(1).strip()[:70])
    if CI_BULLET.search(txt(r,'contraindications')): c['ci_list'] += 1
nb = sum(1 for r in L if 'boxed_warning' in r)
print("  regex hits:", {k: pct(v, nb if k=='bwtitle' else N) for k, v in c.items()})
print("  boxed-warning titles sample:", bw[:8])
print("  DI excerpt:", txt(L[3],'drug_interactions')[:400])
print("  tables present:", pct(sum(1 for r in L if any(k.endswith('_table') for k in r)), N))

# ---------------- Trials ----------------
T = json.load(open('ct100.json'))['studies'] + json.load(open('ct20.json'))['studies']
n = len(T)
el = [s['protocolSection'].get('eligibilityModule', {}) for s in T]
crit = [e.get('eligibilityCriteria', '') for e in el]
print("\nTRIALS n=", n, "criteria chars median", int(st.median(len(x) for x in crit)), "max", max(len(x) for x in crit))
INC = re.compile(r'inclusion criteria', re.I); EXC = re.compile(r'exclusion criteria', re.I)
BUL = re.compile(r'^\s*(\*|-|\d+[.)])\s+', re.M)
AGE = re.compile(r'(aged?|years? of age|\byears?\b).{0,20}\d+|\b\d+\s*(to|-|and)\s*\d+\s*years', re.I)
LAB = re.compile(r'\b(ANC|absolute neutrophil|platelets?|hemoglobin|haemoglobin|creatinine|bilirubin|AST|ALT|eGFR|CrCl|HbA1c|INR|albumin|LVEF)\b[^.\n]{0,60}?(≥|≤|>=|<=|>|<|\\[<>]|greater|less|at least|within)[^.\n]{0,20}\d', re.I)
ECOG = re.compile(r'\b(ECOG|Karnofsky|KPS)\b', re.I)
PRIOR = re.compile(r'\b(prior|previous(ly)?|history of)\b[^.\n]{0,40}\b(therapy|treatment|chemotherapy|immunotherapy|radiation|surgery|transplant|inhibitor)', re.I)
PREG = re.compile(r'\b(pregnan\w*|breast-?feeding|lactating|contracept\w*)\b', re.I)
INF = re.compile(r'\b(HIV|hepatitis [BC]|HBV|HCV)\b', re.I)
k = dict(split=0, bullets=0, age_text=0, lab=0, ecog=0, prior=0, preg=0, inf=0)
nb_items = []
for x in crit:
    if INC.search(x) and EXC.search(x): k['split'] += 1
    b = BUL.findall(x); nb_items.append(len(b))
    if len(b) >= 2: k['bullets'] += 1
    for key, rx in (('age_text',AGE),('lab',LAB),('ecog',ECOG),('prior',PRIOR),('preg',PREG),('inf',INF)):
        if rx.search(x): k[key] += 1
print("  structured already: minAge", pct(sum(1 for e in el if e.get('minimumAge')), n), "maxAge", pct(sum(1 for e in el if e.get('maximumAge')), n), "sex", pct(sum(1 for e in el if e.get('sex')), n))
print("  regex hits:", {a: pct(b, n) for a, b in k.items()}, "median bullet items", st.median(nb_items))
labs = [m.group(0) for x in crit for m in LAB.finditer(x)][:8]
print("  lab samples:", labs)
