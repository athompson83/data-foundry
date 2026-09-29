import json,glob,random,re,collections
S='/tmp/claude-0/-home-user-data-foundry/18750a82-58eb-5501-8b7a-380a3c543347/scratchpad/he/'
fs=sorted(glob.glob(S+'project-rcn-*.json'))
random.seed(29)
al=[json.load(open(f)) for f in fs]
print('total HE project files',len(al))
print('max startDate',max(a.get('startDate') or '' for a in al),'min',min(a.get('startDate') or '9' for a in al),'max lastUpdate',max(a.get('lastUpdateDate') or '' for a in al))
print('status',collections.Counter(a.get('status') for a in al))
print('objective present',sum(1 for a in al if len(a.get('objective') or '')>50),'/',len(al))
print('grantDoi present',sum(1 for a in al if (a.get('identifiers') or {}).get('grantDoi')),'/',len(al))
s=random.sample(al,20)
json.dump([{k:(v if k!='relations' else None) for k,v in a.items()} for a in s],open('cordis_samples.json','w'),indent=1)
h=lambda f:sum(1 for a in s if f(a))
print('sample: id 9 digits',h(lambda a:re.fullmatch(r'\d{9}',str(a['id']))),'grantDoi 10.3030',h(lambda a:re.fullmatch(r'10\.3030/\d{9}',(a['identifiers'] or {}).get('grantDoi') or '')),'objective',h(lambda a:len(a.get('objective') or '')>50),'teaser',h(lambda a:bool(a.get('teaser'))))
orgs=[o for a in s for o in a['relations']['associations'] if o['contenttype']=='organization']
print('orgs in sample',len(orgs),'with id(PIC)',sum(1 for o in orgs if re.fullmatch(r'\d{9}',str(o.get('id','')))),'with vat',sum(1 for o in orgs if o.get('vatNumber')),'with ror',sum(1 for o in orgs if 'ror' in json.dumps(o).lower()))
print('org keys',sorted(orgs[0].keys()))
json.dump([a['id'] for a in s],open('cordis_sample_ids.json','w'))
