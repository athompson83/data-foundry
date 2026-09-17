#!/usr/bin/env python3
"""Phase 5/6 measurements for the FAA aircraft registry candidate.

Reads the seven-file Releasable Aircraft Database archive and measures the
facts the go/no-go decision depends on: status-enum shape, join resolution,
N-number reassignment, reservation semantics, expiry consistency and how much
of the archive is owner PII the product excludes.

Usage: faa-registry-phase56.py <directory containing MASTER.txt etc.>
Reproduces against https://registry.faa.gov/database/ReleasableAircraft.zip
"""
import csv, sys, os, collections, datetime

d = sys.argv[1]
def rows(name):
    with open(os.path.join(d, name), encoding='utf-8-sig', errors='replace', newline='') as fh:
        r = csv.reader(fh)
        hdr = [h.strip() for h in next(r)]
        for row in r:
            if not row or not row[0].strip():
                continue
            yield hdr, [c.strip() for c in row]

def load(name, keep):
    out = []
    idx = None
    for hdr, row in rows(name):
        if idx is None:
            idx = {k: hdr.index(k) for k in keep}
        out.append(tuple(row[idx[k]] if idx[k] < len(row) else '' for k in keep))
    return out

print('=' * 72)
print('MASTER')
print('=' * 72)
M = load('MASTER.txt', ['N-NUMBER', 'SERIAL NUMBER', 'MFR MDL CODE', 'ENG MFR MDL',
                        'YEAR MFR', 'TYPE REGISTRANT', 'NAME', 'STREET', 'STATUS CODE',
                        'EXPIRATION DATE', 'MODE S CODE HEX', 'CERT ISSUE DATE', 'UNIQUE ID'])
mn = [r[0] for r in M]
print(f'records                       {len(M):>10,}')
print(f'distinct N-numbers            {len(set(mn)):>10,}')
dupes = [n for n, c in collections.Counter(mn).items() if c > 1]
print(f'N-numbers with >1 record      {len(dupes):>10,}')

status = collections.Counter(r[8] for r in M)
print(f'\ndistinct STATUS CODE values   {len(status):>10,}')
for s, c in sorted(status.items(), key=lambda kv: -kv[1]):
    print(f'  {s!r:>6}  {c:>9,}  {100*c/len(M):>6.2f}%')

blank_eng = sum(1 for r in M if not r[3])
blank_mdl = sum(1 for r in M if not r[2])
print(f'\nblank ENG MFR MDL             {blank_eng:>10,}  ({100*blank_eng/len(M):.2f}%)')
print(f'blank MFR MDL CODE            {blank_mdl:>10,}  ({100*blank_mdl/len(M):.2f}%)')

print('\n' + '=' * 72)
print('JOIN RESOLUTION')
print('=' * 72)
A = {r[0]: r for r in load('ACFTREF.txt', ['CODE', 'MFR', 'MODEL', 'TYPE-ACFT', 'NO-ENG', 'NO-SEATS', 'AC-WEIGHT'])}
E = {r[0]: r for r in load('ENGINE.txt', ['CODE', 'MFR', 'MODEL', 'TYPE', 'HORSEPOWER', 'THRUST'])}
print(f'ACFTREF rows                  {len(A):>10,}')
print(f'ENGINE rows                   {len(E):>10,}')
ac_ok = sum(1 for r in M if r[2] and r[2] in A)
ac_orphan = sum(1 for r in M if r[2] and r[2] not in A)
en_ok = sum(1 for r in M if r[3] and r[3] in E)
en_orphan = sum(1 for r in M if r[3] and r[3] not in E)
print(f'MFR MDL CODE resolves         {ac_ok:>10,}  orphans {ac_orphan:,}')
print(f'ENG MFR MDL resolves          {en_ok:>10,}  orphans {en_orphan:,}')

print('\n' + '=' * 72)
print('DEREGISTERED HISTORY AND N-NUMBER REASSIGNMENT')
print('=' * 72)
D = load('DEREG.txt', ['N-NUMBER', 'SERIAL-NUMBER', 'MFR-MDL-CODE', 'STATUS-CODE', 'CANCEL-DATE'])
dn = collections.Counter(r[0] for r in D)
print(f'DEREG records                 {len(D):>10,}')
print(f'distinct N-numbers            {len(dn):>10,}')
print(f'max records for one N-number  {max(dn.values()):>10,}')
depth = collections.Counter(dn.values())
for k in sorted(depth)[:8]:
    print(f'  {k} prior record(s): {depth[k]:>8,} N-numbers')

dser = collections.defaultdict(set)
for r in D:
    dser[r[0]].add(r[1])
both = [r for r in M if r[0] in dn]
reassigned = [r for r in both if r[1] not in dser[r[0]]]
print(f'\nN-numbers live now AND in DEREG        {len(both):>10,}')
print(f'  ... where the live serial number is')
print(f'  absent from every prior DEREG row     {len(reassigned):>10,}  '
      f'({100*len(reassigned)/max(len(both),1):.1f}% of overlap)')
print('  -> the same N-number now identifies a different airframe')

print('\n' + '=' * 72)
print('RESERVED N-NUMBERS')
print('=' * 72)
R = load('RESERVED.txt', ['N-NUMBER', 'RSV DATE', 'EXP DATE', 'N-NUM-CHG', 'PURGE DATE'])
rn = set(r[0] for r in R)
print(f'RESERVED records              {len(R):>10,}')
print(f'distinct N-numbers            {len(rn):>10,}')
print(f'also present in MASTER        {len(rn & set(mn)):>10,}')
print(f'also present in DEREG         {len(rn & set(dn)):>10,}')
print(f'N-NUM-CHG flag set            {sum(1 for r in R if r[3]):>10,}')

print('\n' + '=' * 72)
print('EXPIRY / STATUS CONSISTENCY')
print('=' * 72)
today = datetime.date.today().strftime('%Y%m%d')
print(f'snapshot compared against     {today}')
exp_blank = sum(1 for r in M if not r[9])
expired = [r for r in M if r[9] and r[9] < today]
print(f'blank EXPIRATION DATE         {exp_blank:>10,}')
print(f'EXPIRATION DATE in the past   {len(expired):>10,}  ({100*len(expired)/len(M):.2f}%)')
exp_status = collections.Counter(r[8] for r in expired)
print('  their STATUS CODE:')
for s, c in sorted(exp_status.items(), key=lambda kv: -kv[1])[:8]:
    print(f'    {s!r:>6}  {c:>8,}')

print('\n' + '=' * 72)
print('OWNER PII THE PRODUCT EXCLUDES')
print('=' * 72)
name_pop = sum(1 for r in M if r[6])
street_pop = sum(1 for r in M if r[7])
print(f'NAME populated                {name_pop:>10,}  ({100*name_pop/len(M):.2f}%)')
print(f'STREET populated              {street_pop:>10,}  ({100*street_pop/len(M):.2f}%)')
reg = collections.Counter(r[5] for r in M)
print('TYPE REGISTRANT distribution:')
labels = {'1': 'Individual', '2': 'Partnership', '3': 'Corporation', '4': 'Co-Owned',
          '5': 'Government', '7': 'LLC', '8': 'Non Citizen Corporation',
          '9': 'Non Citizen Co-Owned', '': '(blank)'}
for k, c in sorted(reg.items(), key=lambda kv: -kv[1]):
    print(f'  {k!r:>4} {labels.get(k,"?"):<26} {c:>9,}  {100*c/len(M):>6.2f}%')

print('\n' + '=' * 72)
print('BENCHMARK CASE SELECTION')
print('=' * 72)
def show(label, r):
    a = A.get(r[2])
    e = E.get(r[3])
    print(f'{label}: N{r[0]}  status={r[8]!r} serial={r[1]!r} mdl={r[2]!r} eng={r[3]!r}')
    print(f'    ACFTREF -> {a[1] + " " + a[2] if a else None}')
    print(f'    ENGINE  -> {e[1] + " " + e[2] if e else None}')

blank_e = next(r for r in M if not r[3] and r[2] in A and r[8] == 'V')
show('blank engine key      ', blank_e)
odd = next(r for r in M if r[8] not in ('V',) and r[2] in A and r[3] in E)
show('non-valid status      ', odd)
rich = next(r for r in M if r[2] in A and r[3] in E and A[r[2]][5] and int(A[r[2]][5] or 0) > 100)
show('ACFTREF-heavy record  ', rich)
reas = reassigned[0] if reassigned else None
if reas:
    show('reassigned N-number   ', reas)
    print(f'    prior DEREG serials for N{reas[0]}: {sorted(dser[reas[0]])[:4]}')
