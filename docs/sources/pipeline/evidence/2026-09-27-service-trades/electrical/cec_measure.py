import openpyxl,re,random,json,collections
def load(f,sheet=None,hdr='Manufacturer'):
    wb=openpyxl.load_workbook(f,read_only=True); ws=wb[sheet] if sheet else wb.worksheets[0]
    rows=list(ws.iter_rows(values_only=True))
    h=next(i for i,r in enumerate(rows) if r and r[0] and str(r[0]).startswith(hdr))
    hd=rows[h]; skip=2 if rows[h+1][0] is None else 1
    data=[r for r in rows[h+skip:] if r and r[0] and r[1]]
    return hd,data
out={}
# ---- Solar inverters
hd,inv=load('cec_InvertersList.xlsx','Solar_Inverters')
hd2,binv=load('cec_InvertersList.xlsx','Battery_Inverters')
print('solar inverters',len(inv),'battery inverters',len(binv))
D=hd.index('Description'); M=1; FW=18; NOTES=hd.index('Notes')
kw=re.compile(r'(\d+(?:\.\d+)?)\s*kW',re.I); vac=re.compile(r'(\d{3})\s*V\s*ac|(\d{3})\s*Vac',re.I)
ph=re.compile(r'(three|3)[- ]?phase|(single|1)[- ]?phase|split[- ]phase',re.I)
arc=re.compile(r'arc[- ](fault|detect)|AFCI',re.I); rsd=re.compile(r'rapid[- ]shut',re.I); micro=re.compile(r'micro[- ]?inverter',re.I)
curly=re.compile(r'\{([^}]*)\}\s*$')
def st(rows,name):
    n=len(rows); c=collections.Counter()
    for r in rows:
        d=str(r[D] or ''); m=str(r[M])
        c['desc_kw']+=bool(kw.search(d)); c['desc_vac']+=bool(vac.search(d)); c['desc_phase']+=bool(ph.search(d))
        c['desc_arc']+=bool(arc.search(d)); c['desc_rsd']+=bool(rsd.search(d)); c['desc_micro']+=bool(micro.search(d))
        c['model_curly']+=bool(curly.search(m)); fw=str(r[FW] or '')
        c['fw_list_multi']+= (fw.startswith('[') and ',' in fw); c['fw_present']+= fw.startswith('[')
        c['notes_nonempty']+=bool(r[NOTES])
        k=kw.search(d)
        if k and isinstance(r[11],(int,float)):
            c['kw_checked']+=1; c['kw_agree']+= abs(float(k.group(1))-r[11])<0.051
    return n,dict(c)
out['solar_inverters']=st(inv,'s'); print(out['solar_inverters'])
# duplicate model numbers across manufacturers
def dup(rows):
    by=collections.defaultdict(set)
    for r in rows: by[curly.sub('',str(r[1])).strip().upper()].add(r[0])
    multi={k:v for k,v in by.items() if len(v)>1}
    return len(by),len(multi),list(multi.items())[:5]
print('inv base models / cross-mfr dup', dup(inv)[:2], dup(inv)[2][:3])
hdm,mod=load('cec_PVModuleList.xlsx')
print('modules',len(mod)); print('module base/dup',dup(mod)[:2],dup(mod)[2][:3])
# module description parsing
cell=re.compile(r'(\d{2,3})[- ]?(?:half[- ]?)?cells?',re.I); bif=re.compile(r'bifacial',re.I); half=re.compile(r'half[- ]?cut|half[- ]?cell',re.I)
tech=re.compile(r'mono|poly|thin|CdTe|CIGS|HJT|heterojunction|TOPCon|PERC|N-?type|P-?type',re.I); w=re.compile(r'(\d{2,3}(?:\.\d)?)\s*W',re.I)
c=collections.Counter()
for r in mod:
    d=str(r[2] or ''); c['w']+=bool(w.search(d)); c['tech']+=bool(tech.search(d)); c['bifacial']+=bool(bif.search(d)); c['halfcut']+=bool(half.search(d)); c['cells']+=bool(cell.search(d)); c['notes']+=bool(r[6])
    c['has_topcon_etc']+=bool(re.search(r'TOPCon|HJT|heterojunction|PERC|N-?type',d,re.I))
print('module desc',len(mod),dict(c))
hde,ess=load('cec_EnergyStorage.xlsx'); De=hde.index('Description')
kwh=re.compile(r'(\d+(?:\.\d+)?)\s*kWh',re.I); c=collections.Counter()
for r in ess:
    d=str(r[De] or ''); c['kwh']+=bool(kwh.search(d)); c['kw']+=bool(re.search(r'(\d+(?:\.\d+)?)\s*kW(?!h)',d)); c['chem']+=bool(re.search(r'LFP|lithium|NMC|iron',d,re.I)); c['curly']+=bool(curly.search(str(r[2])))
    k=kwh.search(d)
    if k and isinstance(r[16],(int,float)): c['kwh_checked']+=1; c['kwh_agree']+=abs(float(k.group(1))-r[16])<0.051
print('ESS',len(ess),dict(c))
hdb,bat=load('cec_BatteryList.xlsx'); print('batteries',len(bat))
hdmt,met=load('cec_MeterList.xlsx'); print('meters',len(met))
# seeded sample of 25 inverters
random.seed(20260927); s=random.sample(inv,25)
res=[]
for r in s:
    d=str(r[D]); res.append({'mfr':r[0],'model':r[1],'desc':d,'fw':r[FW],'kw':bool(kw.search(d)),'vac':bool(vac.search(d)),'phase':bool(ph.search(d)),'curly':bool(curly.search(str(r[1]))),'fw_multi':str(r[FW] or '').startswith('[') and ',' in str(r[FW])})
json.dump(res,open('cec_inv_sample.json','w'),indent=1,default=str)
for k in ['kw','vac','phase','curly','fw_multi']: print('sample',k,sum(x[k] for x in res),'/25')
for x in res[:25]: print(x['mfr'],'|',x['model'],'|',x['desc'][:90],'|',x['fw'])
print('---- kw disagreement examples')
bad=[r for r in inv if kw.search(str(r[D])) and isinstance(r[11],(int,float)) and abs(float(kw.search(str(r[D])).group(1))-r[11])>=0.051]
for r in bad[:8]: print(r[1],'|',str(r[D])[:60],'| col=',r[11],'| wtd?',r[12],r[13])
ratio=collections.Counter(round(float(kw.search(str(r[D])).group(1))/r[11],2) if r[11] else None for r in bad); print(ratio.most_common(6))
# firmware parse
fwre=re.compile(r'[\[\{]([^\]\}]*)[\]\}]')
cnt=0;tot=0;vers=0
for r in inv:
    f=str(r[FW] or '')
    if f.startswith('[') or f.startswith('{'):
        tot+=1; parts=[p.strip() for g in fwre.findall(f) for p in re.split(r'[;,]',g) if p.strip()]
        vers+=len(parts); cnt+= len(parts)>0
print('firmware cells',tot,'parsed',cnt,'versions',vers)
