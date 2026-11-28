"""Drug product labeling: NLM DailyMed SPL index vs openFDA drug label endpoint. Declared join: SPL set_id.
Usage: python3 -I measure.py <out.json>. Sample: page 1..5 of DailyMed spls (pagesize 40, newest first by default order)."""
import sys,json,time,subprocess,urllib.parse
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    for i in range(4):
        p=subprocess.run(['curl','-sSL','-m','45','-A',UA,u],capture_output=True)
        try: return json.loads(p.stdout)
        except Exception: time.sleep(2+i)
    return None
rows=[]; meta=None
for pg in range(1,6):
    j=get('https://dailymed.nlm.nih.gov/dailymed/services/v2/spls.json?pagesize=40&page=%d'%pg)
    if not j: continue
    meta=j['metadata']
    rows+=j['data']
SECT=['indications_and_usage','warnings','boxed_warning','dosage_and_administration','contraindications','adverse_reactions']
out_rows=[]
for r in rows:
    j=get('https://api.fda.gov/drug/label.json?search=set_id:%s&limit=1'%r['setid']); time.sleep(0.25)
    res=(j or {}).get('results') or []
    e=res[0] if res else None
    out_rows.append({'setid':r['setid'],'title':r['title'][:90],'published':r['published_date'],'in_openfda':bool(e),'sections':[s for s in SECT if e and s in e],'effective_time':e.get('effective_time') if e else None,'version_agrees':bool(e) and str(e.get('version'))==str(r['spl_version'])})
n=len(out_rows); f=[x for x in out_rows if x['in_openfda']]
out={'dailymed_total_spls':meta and meta.get('total_elements'),'sampled':n,'setid_found_in_openfda':len(f),'version_agrees':sum(x['version_agrees'] for x in f),'with_indications_text':sum('indications_and_usage' in x['sections'] for x in f),'rows':out_rows}
json.dump(out,open(sys.argv[1],'w'),indent=1)
print({k:v for k,v in out.items() if k!='rows'})
