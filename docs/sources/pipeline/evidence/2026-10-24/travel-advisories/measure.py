"""Travel advisories: US State Dept (JSON feed), UK FCDO (GOV.UK content API) and Global Affairs Canada (open JSON) joined on country.
Usage: python3 -I measure.py <out.json> <handcheck.json>. The State feed keys countries by FIPS/GEC code, not ISO; this measures how far a
code join gets and how far a normalised-name join gets, and lists code collisions."""
import sys,json,re,subprocess,random,collections
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u): return json.loads(subprocess.run(['curl','-sS','-m','60','-A',UA,u],capture_output=True,text=True).stdout)
S=get('https://cadataapi.state.gov/api/TravelAdvisories')
C=get('https://data.international.gc.ca/travel-voyage/index-alpha-eng.json')['data']
F=get('https://www.gov.uk/api/content/foreign-travel-advice')['links']['children']
code=lambda x:x['Category'][0] if isinstance(x['Category'],list) else x['Category']
norm=lambda s:re.sub(r'[^a-z]','',re.sub(r'\(.*?\)|^the ','',s.lower()))
ALIAS={'burma':'myanmar','ctedivoire':'ivorycoast','kingdomofdenmark':'denmark','federatedstatesofmicronesia':'micronesia','naoero':'nauru','macau':'macao','thebahamas':'bahamas','mexicotraveladvisory':'mexico','myanmarburma':'myanmar','congo':'republicofcongo','stlucia':'saintlucia','stkittsandnevis':'saintkittsandnevis','stmaarten':'sintmaarten'}
n=lambda s:ALIAS.get(norm(s),norm(s))
st={n(x['Title'].split(' - ')[0]):x for x in S}
ca={n(v['country-eng']):(k,v) for k,v in C.items()}
fc={n(f['details']['country']['name']):f for f in F if 'details' in f}
iso=set(C)
codes=[code(x) for x in S]
coll=[(x['Title'].split(' - ')[0],code(x),C[code(x)]['country-eng']) for x in S if code(x) in iso and n(C[code(x)]['country-eng'])!=n(x['Title'].split(' - ')[0])]
lvl=lambda x:int(re.search(r'Level (\d)',x['Title']).group(1))
agree=[(lvl(st[k]),ca[k][1]['advisory-state']) for k in st if k in ca]
out={'state_items':len(S),'state_distinct_codes':len(set(codes)),'state_codes_equal_to_a_canada_iso_code':sum(1 for c in set(codes) if c in iso),
 'state_codes_equal_to_iso_but_a_different_country':len(coll),'code_collision_examples':coll[:8],'canada_items':len(C),'fcdo_items':len(fc),
 'name_join_state_canada':len(set(st)&set(ca)),'name_join_state_fcdo':len(set(st)&set(fc)),'name_join_canada_fcdo':len(set(ca)&set(fc)),
 'all_three':len(set(st)&set(ca)&set(fc)),'state_level_counts':dict(collections.Counter(lvl(x) for x in S)),'canada_advisory_state_counts':dict(collections.Counter(v['advisory-state'] for v in C.values())),
 'state_level4_also_canada_avoid_all_travel_3':sum(1 for a,b in agree if a==4 and b==3),'state_level4_total_matched':sum(1 for a,b in agree if a==4),
 'state_items_dated_after_run_date':sum(1 for x in S if x['Published']>'2026-10-24'),'state_summary_chars_mean':sum(len(x['Summary']) for x in S)//len(S)}
json.dump(out,open(sys.argv[1],'w'),indent=1)
random.seed(24); keys=random.sample(sorted(set(st)&set(ca)&set(fc)),12)
json.dump([{'state':st[k]['Title'].split(' - ')[0],'state_code':code(st[k]),'canada':ca[k][1]['country-eng'],'canada_iso':ca[k][0],'fcdo':fc[k]['details']['country']['name']} for k in keys],open(sys.argv[2],'w'),indent=1)
print(json.dumps(out,indent=1))
