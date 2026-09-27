exec(open('cec_measure.py').read().split("# seeded sample")[0])
vs=re.compile(r'(1000|1500|600)\s*V',re.I); bs=re.compile(r'(black|white|clear|transparent)\s*back',re.I); dg=re.compile(r'double[- ]glass|dual[- ]glass|glass[- ]glass',re.I)
print('modules maxsysV',sum(bool(vs.search(str(r[2]))) for r in mod),'backsheet',sum(bool(bs.search(str(r[2]))) for r in mod),'double-glass',sum(bool(dg.search(str(r[2]))) for r in mod),'of',len(mod))
# structured Mounting/Technology column vs desc bifacial - is there a bifacial column?
print(hdm)
