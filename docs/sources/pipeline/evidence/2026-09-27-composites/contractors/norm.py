import re,csv,json,random
SUFFIX={'LLC','L','INC','INCORPORATED','CORP','CORPORATION','CO','COMPANY','LTD','LIMITED','LP','LLP','PLLC','PC','PLC','THE','DBA','OF','A'}
ENTITY={'LLC','INC','INCORPORATED','CORP','CORPORATION','CO','COMPANY','LTD','LIMITED','LP','LLP','PLLC','PC','PLC','LC','CORPORATION','SPC','PSC','ASSOCIATES','ENTERPRISES','GROUP','SERVICES','SERVICE','INDUSTRIES','SYSTEMS'}
LEGAL={'LLC','INC','INCORPORATED','CORP','CORPORATION','CO','COMPANY','LTD','LIMITED','LP','LLP','PLLC','PC','PLC','LC','SPC'}
def toks(n):
    n=(n or '').upper().replace('&',' AND ').replace('L.L.C','LLC').replace('L L C','LLC')
    n=re.sub(r"[^A-Z0-9 ]",' ',n)
    return n.split()
def normname(n):
    t=[x for x in toks(n) if x not in SUFFIX]
    t=['AND' if x=='N' else x for x in t]
    return ' '.join(t)
def is_entity(n):
    return any(x in LEGAL for x in toks(n))
def phone(p):
    d=re.sub(r'\D','',p or '')
    if len(d)==11 and d[0]=='1': d=d[1:]
    return d if len(d)==10 and d not in ('0000000000',) else ''
def zip5(z):
    d=re.sub(r'\D','',z or ''); return d[:5] if len(d)>=5 else ''
def rows(f): return list(csv.DictReader(open(f,encoding='utf-8',errors='ignore')))
