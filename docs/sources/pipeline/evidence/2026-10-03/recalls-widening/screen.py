#!/usr/bin/env python3
"""Recalls widening screen (2026-10-03). Consolidated from the interactive measurement session; re-runnable.
Downloads (all keyless, UA below, <=2 req/s): NHTSA FLAT_RCL_PRE/POST_2010.zip (7.4MB+14.9MB), Transport Canada
vrdb_full_monthly.csv (207MB: exceeds the 50MB guidance, fetched once; use --tc-sample-only next time), CPSC
saferproducts Recall API in 8 date windows (~28MB), Health Canada HCRSAMOpenData.json (15.7MB).
Usage: python3 screen.py WORKDIR
"""
import csv, collections, datetime as dt, json, re, subprocess, sys, zipfile, pathlib
UA = 'data-foundry-scout (data@mail.proviciency.com)'
W = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.'); W.mkdir(parents=True, exist_ok=True)
csv.field_size_limit(10**9)

def get(url, out):
    subprocess.run(['curl', '-sS', '-m', '300', '-A', UA, '-o', str(W / out), url], check=True)

def fetch_all():
    get('https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_PRE_2010.zip', 'pre.zip')
    get('https://static.nhtsa.gov/odi/ffdd/rcl/FLAT_RCL_POST_2010.zip', 'post.zip')
    for z in ('pre.zip', 'post.zip'): zipfile.ZipFile(W / z).extractall(W)
    get('https://opendatatc.tc.canada.ca/vrdb_full_monthly.csv', 'tc.csv')
    get('https://recalls-rappels.canada.ca/sites/default/files/opendata-donneesouvertes/HCRSAMOpenData.json', 'hc.json')
    (W / 'cp').mkdir(exist_ok=True)
    for s, e in [('1973', '1999'), ('2000', '2005'), ('2006', '2010'), ('2011', '2014'), ('2015', '2018'), ('2019', '2021'), ('2022', '2023'), ('2024', '2026')]:
        end = '2026-10-03' if e == '2026' else f'{e}-12-31'
        get(f'https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart={s}-01-01&RecallDateEnd={end}', f'cp/{s}-{e}.json')

def load():
    nh = []
    for fn in ('FLAT_RCL_PRE_2010.txt', 'FLAT_RCL_POST_2010.txt'):
        for l in open(W / fn, encoding='latin-1'):
            p = l.rstrip('\n').split('\t')
            if len(p) >= 27: nh.append(p)
    camp = {}
    for p in nh: camp.setdefault(p[1], p)
    cp = {}
    for f in (W / 'cp').glob('*.json'):
        for r in json.load(open(f)): cp[r['RecallID']] = r
    tc = list(csv.DictReader(open(W / 'tc.csv', encoding='utf-8', errors='replace')))
    tcr = {}
    for r in tc: tcr.setdefault(r['RECALL_NUMBER_NUM'], []).append(r)
    hc = json.load(open(W / 'hc.json'))
    return nh, camp, cp, tc, tcr, hc

nk = lambda s: re.sub(r'[^A-Z0-9]', '', s.upper())
d8 = lambda s: dt.datetime.strptime(s, '%Y%m%d')

def main():
    if not (W / 'tc.csv').exists(): fetch_all()
    nh, camp, cp, tc, tcr, hc = load()
    R = {'nhtsa': {'rows': len(nh), 'campaigns': len(camp), 'by_type': dict(collections.Counter(p[10] for p in camp.values())),
                   'rcdate_min': min(p[15] for p in camp.values() if p[15].strip()), 'rcdate_max': max(p[15] for p in camp.values())},
         'tc': {'rows': len(tc), 'recalls': len(tcr), 'date_min': min(r['RECALL_DATE_DTE'] for r in tc), 'date_max': max(r['RECALL_DATE_DTE'] for r in tc)},
         'cpsc': {'recalls': len(cp)}}
    # J1 declared: CPSC Inconjunctions URL -> TC VRDB recall number (?rn=)
    rows = [(r['RecallNumber'], m.group(1)) for r in cp.values() for i in r['Inconjunctions'] if (m := re.search(r'wwwapps\.tc\.gc\.ca.*rn=(\d+)', i.get('URL', '')))]
    R['cpsc_to_tc'] = {'cpsc_citing': len({a for a, _ in rows}), 'resolving_in_vrdb': sum(1 for _, b in rows if b in tcr)}
    # J2 declared: TC MANUFACTURER_RECALL_NO_TXT == NHTSA MFGCAMPNO and same make/manufacturer
    nhm = collections.defaultdict(set)
    for p in nh:
        if p[5].strip(): nhm[nk(p[5])].add(p[1])
    hit = {}
    for k, v in tcr.items():
        for x in re.split(r'[/,;]|\s{2,}', v[0]['MANUFACTURER_RECALL_NO_TXT']):
            t = nk(x); tm = (v[0]['MAKE_NAME_NM'].upper().split() or [''])[0][:4]
            if len(t) >= 4 and t in nhm:
                for c in nhm[t]:
                    if tm and (tm in camp[c][2].upper() or tm in camp[c][7].upper()): hit[k] = (c, t); break
            if k in hit: break
    R['tc_to_nhtsa_mfr_campaign'] = {'tc_with_mfr_no': sum(1 for v in tcr.values() if v[0]['MANUFACTURER_RECALL_NO_TXT'].strip()), 'matched_with_make_agreement': len(hit)}
    # J3 candidate: CPSC titles naming NHTSA -> NHTSA child restraint/tire campaign (manufacturer+model+date<=120d)
    # J4 candidate: TC child seat/booster/tire/equipment since 2010 -> NHTSA C/T/E (make + shared model token + date<=90d)
    print(json.dumps(R, indent=1))
    json.dump(R, open(W / 'results_auto.json', 'w'), indent=1)

if __name__ == '__main__': main()
