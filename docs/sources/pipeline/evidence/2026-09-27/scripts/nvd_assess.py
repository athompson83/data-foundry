import json,re,random,collections
v=json.load(open('nvd_recent.json'))['vulnerabilities']+json.load(open('nvd_last.json'))['vulnerabilities']
v=[x['cve'] for x in v if x['cve']['vulnStatus']!='Rejected']
noconf=[c for c in v if not c.get('configurations')]
print('non-rejected',len(v),'noconf',len(noconf))
def aff(c):
    a=c.get('affected') or []
    ad=[d for s in a for d in s.get('affectedData',[])]
    return ad
has_aff=[c for c in noconf if aff(c)]
print('noconf w/ CNA affected',len(has_aff))
def vinfo(c):
    ad=aff(c); vs=[ver for d in ad for ver in d.get('versions',[])]
    rng=any('lessThan' in x or 'lessThanOrEqual' in x for x in vs)
    real=any(x.get('version') not in (None,'0','*','n/a','unspecified') for x in vs)
    cpe=any(d.get('cpes') for d in ad)
    vp=all(d.get('vendor') not in (None,'n/a','') and d.get('product') not in (None,'n/a','') for d in ad) and ad
    return rng,real,cpe,bool(vp)
cnt=collections.Counter()
for c in noconf:
    r=vinfo(c); 
    for k,val in zip(['range','anyversion','cnacpe','vendorproduct'],r): cnt[k]+=val
print('among noconf:',dict(cnt))
# cwe from CNA
print('noconf with weaknesses',sum(1 for c in noconf if c.get('weaknesses')),'with metrics',sum(1 for c in noconf if c.get('metrics')))
# regex on descriptions of noconf lacking a version range
random.seed(1); tgt=[c for c in noconf if not vinfo(c)[0]]
print('noconf without structured range',len(tgt))
S=random.sample(tgt,50)
pat={
 'range_before':re.compile(r'\b(?:before|prior to|through|up to|<=?|and earlier|or earlier|to)\s+v?\d+(?:\.\d+)+',re.I),
 'fixed_in':re.compile(r'\b(?:fixed in|patched in|upgrade to|addressed in|resolved in)\s+(?:version\s+)?v?\d+(?:\.\d+)*',re.I),
 'any_version':re.compile(r'\bv?\d+\.\d+(?:\.\d+)*\b'),
 'vuln_class':re.compile(r'sql injection|cross[- ]site|xss|buffer overflow|use[- ]after[- ]free|path traversal|command injection|deserializ|ssrf|csrf|out-of-bounds|null pointer|denial of service|privilege|authentication bypass|code execution|information disclosure|race condition|integer overflow|memory leak|missing authorization|improper',re.I),
 'remote':re.compile(r'remote(?:ly)?|network|unauthenticated|local attacker|physical',re.I),
 'exploit_public':re.compile(r'exploit (?:has been|is now|was) (?:disclosed|public|made public)|actively exploited|in the wild',re.I),
}
hit=collections.Counter()
for c in S:
    d=next(x['value'] for x in c['descriptions'] if x['lang']=='en')
    for k,p in pat.items(): hit[k]+=bool(p.search(d))
print('50-sample regex hits:',dict(hit))
for c in S[:6]:
    d=next(x['value'] for x in c['descriptions'] if x['lang']=='en'); print('-',c['id'],c['sourceIdentifier'],'|',d[:260])
# linux kernel share
print('kernel CNA',sum(1 for c in v if c['sourceIdentifier']=='416baaa9-dc9f-4396-8d5f-8c081fb06d67'))
