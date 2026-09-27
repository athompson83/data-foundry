import json,glob,re
rows=[]
for f in sorted(glob.glob('es_hp_*.json')): rows+=json.load(open(f))
def compile_pat(p):
    out='';i=0
    while i<len(p):
        c=p[i]
        if c=='*': out+='[A-Z0-9\\-]*'
        elif c=='(':
            j=p.index(')',i); alts=p[i+1:j].split(','); out+='(?:'+'|'.join(re.escape(a.strip()) for a in alts)+')'; i=j
        elif c=='[':
            j=p.index(']',i); out+='['+re.escape(p[i+1:j].replace(',',''))+']'; i=j
        elif c in ' ': pass
        else: out+=re.escape(c)
        i+=1
    return re.compile('^'+out+'$')
ok=fail=0;fails=[];comp=0;parts=0
for r in rows:
    for fld in ['model_number','indoor_unit_model_number','furnace_model_number']:
        v=r.get(fld)
        if not v: continue
        for part in v.split('+'):
            parts+=1
            try: compile_pat(part.strip()); ok+=1
            except Exception as e: fail+=1; fails.append((r['pd_id'],fld,part))
print('pattern parts',parts,'compiled',ok,'failed',fail, fails[:8])
# self-match check: expand pattern by substituting '' for * and first alt, must match itself compiled
