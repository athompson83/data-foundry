import json,re
S=json.load(open('8k_samples.json'))
MON=r'(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}'
def section(t,it):
    m=re.search(r'Item\s*'+re.escape(it)+r'\.?\s',t,re.I)
    if not m: return ''
    rest=t[m.end():]
    n=re.search(r'\nItem\s*\d\.\d\d|SIGNATURE',rest,re.I)
    return rest[:n.start() if n else 4000]
checks={
 '5.02':{'role':r'\b(Chief \w+ Officer|President|Director|Chair\w*|General Counsel|Treasurer|Secretary|CEO|CFO|COO)\b',
         'event':r'\b(resign\w*|retire\w*|appoint\w*|elect\w*|terminat\w*|depart\w*|step(?:ped)? down)\b',
         'eff_date':r'effective\s+(?:as of\s+)?'+MON,
         'person':r'\b(?:Mr\.|Ms\.|Dr\.)\s+[A-Z][a-z]+|\b[A-Z][a-z]+ (?:[A-Z]\. )?[A-Z][a-z]+(?= \()',
         'salary':r'base salary[^.$]{0,60}\$[\d,]+',
         'no_disagreement':r'not (?:the )?(?:result of|due to) any disagreement'},
 '1.01':{'agreement_type':r'\b(Credit Agreement|Merger|Purchase Agreement|Loan|Indenture|Amendment|License|Lease|Securities Purchase|Underwriting|Employment)\b',
         'amount':r'\$\s?[\d,.]+\s*(?:million|billion)?','date':MON,
         'counterparty':r'(?:by and among|with|between)\s+[A-Z][\w&.,\- ]{3,80}?(?:Inc\.|LLC|L\.P\.|N\.A\.|Corporation|Ltd\.|plc)',
         'rate':r'(?:SOFR|interest rate|per annum|%)'},
 '1.05':{'discovery_date':r'(?:On|on)\s+'+MON, 'actor':r'\b(ransomware|threat actor|unauthori[sz]ed|third[- ]party|cyber)\w*',
         'material':r'\b(not (?:reasonably likely to )?(?:be )?material|material impact|has not determined)\b','law_enf':r'law enforcement','data':r'\b(personal|customer|employee|data)\b'},
 '1.03':{'court':r'Bankruptcy Court for the [A-Z][\w ]+?(?=\s\(|,| “)','chapter':r'Chapter\s+(?:7|11|15)','case_no':r'Case No\.?\s*[\d\-:]+[\w\-]*','date':MON,'dip':r'debtor[- ]in[- ]possession|DIP'},
 '4.01':{'old_auditor':r'dismiss\w*|resign\w*|declin\w* to stand','firm':r'\b[A-Z][\w&,. ]{2,60}(?:LLP|LLC|P\.C\.|CPAs?)\b','date':MON,'no_disagree':r'no (?:“|")?disagreements','adverse':r'adverse opinion|disclaimer of opinion|going concern','reportable':r'reportable events?'},
}
tot={}
for s in S:
    sec=section(s['text'],s['item'])
    res={k:(bool(re.search(p,sec)) if k not in('person','firm','counterparty','court') else bool(re.search(p,sec))) for k,p in checks[s['item']].items()}
    hits={k:(re.search(p,sec).group(0)[:60] if re.search(p,sec) else None) for k,p in checks[s['item']].items()}
    for k,v in res.items(): tot.setdefault(s['item'],{}).setdefault(k,0); tot[s['item']][k]+=v
    print(s['item'],s['name'][:40],s['date'],'len',len(sec),'| exhibits EX-99?' , 'Exhibit 99' in s['text'])
    print('   ',{k:v for k,v in hits.items() if v})
print(json.dumps(tot))
