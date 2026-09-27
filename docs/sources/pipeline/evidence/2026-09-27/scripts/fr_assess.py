import re,html,glob,json,collections,os
R=os.path.dirname(os.path.abspath(__file__))
meta={x['document_number']:x for f in ['fr_rules.json','fr_pro.json'] for x in json.load(open(f'{R}/{f}'))['results']}
M=r'(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}'
P={
 'compliance_date':re.compile(r'compliance date[^.]{0,120}?'+M,re.I),
 'applicability_date':re.compile(r'applicab\w+ date[^.]{0,120}?'+M,re.I),
 'through_end':re.compile(r'through\s+'+M,re.I),
 'comment_deadline':re.compile(r'comments?[^.]{0,80}?(?:on or before|by|no later than)\s+'+M,re.I),
 'dollar':re.compile(r'\$\s?\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion))?',re.I),
 'small_entities_count':re.compile(r'\b[\d,]+\s+small (?:entities|businesses)',re.I),
 'naics':re.compile(r'\bNAICS\b',re.I),
 'applies_to_me':re.compile(r'does this action apply to me|who is affected|affected entities|regulated entities|applies to',re.I),
 'cfr_amend':re.compile(r'\b(?:amend|revise|add|remove)\w*\s+(?:§|part|parts)\s*\d+',re.I),
 'paperwork_burden':re.compile(r'(?:estimated|total) (?:annual )?burden',re.I),
}
hits=collections.Counter(); n=0; ex={}
for f in sorted(glob.glob(f'{R}/gi/*.htm')):
    d=os.path.basename(f)[:-4]; s=open(f,errors='ignore').read()
    t=re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',s))); n+=1
    for k,p in P.items():
        m=p.search(t)
        if m: hits[k]+=1; ex.setdefault(k,(d,m.group(0)[:160]))
print('docs',n,dict(hits))
for k,v in ex.items(): print(k,v)
