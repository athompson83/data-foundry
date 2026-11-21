"""GCAT satcat + launch log vs CelesTrak SATCAT, joined on the NORAD catalog number.
Usage: python3 -I measure.py <gcat satcat.tsv> <gcat launch.tsv> <celestrak satcat.csv> <out.json>"""
import sys,csv,json,re
def tsv(p):
    rows=[]; hdr=None
    for ln in open(p,encoding='utf-8',errors='replace'):
        if ln.startswith('#JCAT') or ln.startswith('#Launch_Tag'): hdr=ln[1:].rstrip('\n').split('\t'); continue
        if ln.startswith('#') or not ln.strip(): continue
        f=ln.rstrip('\n').split('\t'); rows.append(dict(zip(hdr,[x.strip() for x in f])))
    return rows
sat=tsv(sys.argv[1]); lau=tsv(sys.argv[2]); cel=list(csv.DictReader(open(sys.argv[3],encoding='utf-8')))
cn={r['NORAD_CAT_ID'].lstrip('0'):r for r in cel}
g=[r for r in sat if r['Satcat'] and r['Satcat'] not in ('-',)]
gn={r['Satcat'].lstrip('0'):r for r in g}
both=[k for k in gn if k in cn]
def y(s): 
    m=re.match(r'(\d{4}) (\w{3})\s+(\d+)',s); return (m.group(1),m.group(2),int(m.group(3))) if m else None
MON={m:i+1 for i,m in enumerate('Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec'.split())}
agree=0; chk=0
for k in both:
    a=y(gn[k]['LDate']); c=cn[k]['LAUNCH_DATE']
    if a and c:
        chk+=1
        if c=='%s-%02d-%02d'%(a[0],MON.get(a[1],0),a[2]): agree+=1
tags={r['Launch_Tag'] for r in lau}; sat_tag=sum(1 for r in g if r['Launch_Tag'] in tags)
out={'gcat_satcat_rows_with_norad_number':len(g),'celestrak_rows':len(cel),'norad_numbers_in_both':len(both),'celestrak_not_in_gcat':sum(1 for k in cn if k not in gn),'launch_date_agrees':agree,'launch_date_checked':chk,
 'gcat_launches':len(lau),'gcat_launches_with_notes':sum(1 for r in lau if r.get('Notes') not in (None,'','-')),'gcat_satcat_rows_whose_launch_tag_is_in_launch_log':sat_tag,'latest_gcat_launch':max(r['Launch_Date'] for r in lau if r['Launch_Date'][:4].isdigit())}
json.dump(out,open(sys.argv[4],'w'),indent=1); print(out)
