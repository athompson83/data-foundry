"""Software packages: PyPI JSON API vs deps.dev API v3. Declared join: package URL (purl) pkg:pypi/<normalised name>.
Usage: python3 -I measure.py <out.json>. Sample: the 60 most recently updated project names from the PyPI RSS feed of new/updated releases."""
import sys,json,re,time,subprocess
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    for i in range(3):
        p=subprocess.run(['curl','-sSL','-m','40','-A',UA,u],capture_output=True)
        if p.returncode==0 and p.stdout: return p.stdout.decode('utf-8','replace')
        time.sleep(2)
    return ''
names=[]
for n in re.findall(r'<link>https://pypi.org/project/([^/]+)/[^<]*</link>',get('https://pypi.org/rss/updates.xml')):
    if n not in names: names.append(n)
names=names[:60]
rows=[]
for n in names:
    pj=None
    try: pj=json.loads(get('https://pypi.org/pypi/%s/json'%n))
    except Exception: pass
    norm=re.sub(r'[-_.]+','-',n).lower()
    dj=None
    try: dj=json.loads(get('https://api.deps.dev/v3/systems/pypi/packages/%s'%norm))
    except Exception: pass
    time.sleep(0.3)
    info=(pj or {}).get('info') or {}
    rows.append({'name':n,'pypi':bool(pj),'description_chars':len(info.get('description') or ''),'license':info.get('license_expression') or (info.get('license') or '')[:40],'deps_dev':bool(dj),'deps_versions':len((dj or {}).get('versions',[])),'latest_agrees':bool(pj and dj and any(v['versionKey']['version']==info.get('version') for v in dj.get('versions',[])))})
p=[r for r in rows if r['pypi']]
out={'sampled':len(rows),'on_pypi':len(p),'in_deps_dev':sum(r['deps_dev'] for r in p),'latest_version_in_deps_dev':sum(r['latest_agrees'] for r in p),'with_description':sum(r['description_chars']>200 for r in p),'with_license_field':sum(bool(r['license']) for r in p),'rows':rows}
json.dump(out,open(sys.argv[1],'w'),indent=1); print({k:v for k,v in out.items() if k!='rows'})
