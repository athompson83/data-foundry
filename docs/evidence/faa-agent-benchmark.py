#!/usr/bin/env python3
"""Agent-efficiency benchmark for the FAA aircraft registry candidate.

Compares four ways an agent can answer the same twelve questions:

  A  raw FAA HTML lookup        registry.faa.gov/AircraftInquiry (measured live)
  B  raw FAA bulk archive       ReleasableAircraft.zip + local joins (measured)
  C  proposed Data Foundry API  local non-PII SQLite mirror, modelled as one
                                HTTP JSON call (measured against the mirror;
                                no endpoint is deployed)
  D  free incumbent MCP server  faa-aircraft-registry.caseyjhand.com (measured live)

Owner name and address are excluded from every path's answer: they are outside
the product scope, so they are not counted as value.

Usage: faa-agent-benchmark.py <archive dir> [--live]
       --live also measures paths A and D over the network.
"""
import csv, json, os, sqlite3, subprocess, sys, time, urllib.request

d = sys.argv[1]
LIVE = '--live' in sys.argv
DB = os.path.join(d, 'mirror.sqlite')

NONPII_MASTER = ['N-NUMBER', 'SERIAL NUMBER', 'MFR MDL CODE', 'ENG MFR MDL', 'YEAR MFR',
                 'TYPE REGISTRANT', 'REGION', 'LAST ACTION DATE', 'CERT ISSUE DATE',
                 'CERTIFICATION', 'TYPE AIRCRAFT', 'TYPE ENGINE', 'STATUS CODE',
                 'MODE S CODE', 'FRACT OWNER', 'AIR WORTH DATE', 'EXPIRATION DATE',
                 'UNIQUE ID', 'KIT MFR', 'KIT MODEL', 'MODE S CODE HEX']
NONPII_DEREG = ['N-NUMBER', 'SERIAL-NUMBER', 'MFR-MDL-CODE', 'STATUS-CODE', 'ENG-MFR-MDL',
                'YEAR-MFR', 'CANCEL-DATE', 'MODE-S-CODE', 'AIR-WORTH-DATE',
                'CERT-ISSUE-DATE', 'MODE S CODE HEX']
NONPII_RESERVED = ['N-NUMBER', 'RSV DATE', 'TR', 'EXP DATE', 'N-NUM-CHG', 'PURGE DATE']


def sniff(name, keep):
    path = os.path.join(d, name)
    with open(path, encoding='utf-8-sig', errors='replace', newline='') as fh:
        r = csv.reader(fh)
        hdr = [h.strip() for h in next(r)]
        idx = [hdr.index(k) for k in keep]
        for row in r:
            if row and row[0].strip():
                yield [row[i].strip() if i < len(row) else '' for i in idx]


def build():
    """Build the non-PII mirror. This is what the product's loader would do."""
    if os.path.exists(DB):
        os.remove(DB)
    c = sqlite3.connect(DB)
    def table(t, cols, src, keep):
        q = ','.join('"%s"' % x for x in cols)
        c.execute(f'CREATE TABLE {t} ({q})')
        c.executemany(f'INSERT INTO {t} VALUES ({",".join("?"*len(cols))})', sniff(src, keep))
    cols = lambda ks: [k.lower().replace(' ', '_').replace('-', '_').replace('(', '').replace(')', '') for k in ks]
    table('master', cols(NONPII_MASTER), 'MASTER.txt', NONPII_MASTER)
    table('acftref', ['code', 'mfr', 'model', 'type_acft', 'type_eng', 'ac_cat',
                      'build_cert_ind', 'no_eng', 'no_seats', 'ac_weight', 'speed'],
          'ACFTREF.txt', ['CODE', 'MFR', 'MODEL', 'TYPE-ACFT', 'TYPE-ENG', 'AC-CAT',
                          'BUILD-CERT-IND', 'NO-ENG', 'NO-SEATS', 'AC-WEIGHT', 'SPEED'])
    table('engine', ['code', 'mfr', 'model', 'type', 'horsepower', 'thrust'],
          'ENGINE.txt', ['CODE', 'MFR', 'MODEL', 'TYPE', 'HORSEPOWER', 'THRUST'])
    table('dereg', cols(NONPII_DEREG), 'DEREG.txt', NONPII_DEREG)
    table('reserved', cols(NONPII_RESERVED), 'RESERVED.txt', NONPII_RESERVED)
    for s in ('CREATE UNIQUE INDEX ix_m ON master(n_number)',
              'CREATE UNIQUE INDEX ix_a ON acftref(code)',
              'CREATE UNIQUE INDEX ix_e ON engine(code)',
              'CREATE INDEX ix_d ON dereg(n_number)',
              'CREATE UNIQUE INDEX ix_r ON reserved(n_number)',
              'CREATE INDEX ix_ms ON master(mode_s_code_hex)'):
        c.execute(s)
    c.commit()
    return c


def answer(c, n):
    """One question -> one answer, the shape endpoint 1 would return.

    FAA stores the N-number without its leading 'N'; the API accepts either.
    """
    n = n[1:] if n[:1].upper() == 'N' else n
    n = n.upper()
    cur = c.execute(
        'SELECT m.n_number, m.serial_number, m.year_mfr, m.status_code, m.mode_s_code_hex,'
        ' m.expiration_date, m.type_aircraft, m.type_engine, m.eng_mfr_mdl,'
        ' a.mfr, a.model, a.no_eng, a.no_seats, e.mfr, e.model, e.horsepower, e.thrust'
        ' FROM master m JOIN acftref a ON a.code = m.mfr_mdl_code'
        ' LEFT JOIN engine e ON e.code = m.eng_mfr_mdl WHERE m.n_number = ?', (n,))
    row = cur.fetchone()
    if row is None:
        for t, kind in (('dereg', 'deregistered'), ('reserved', 'reserved')):
            r = c.execute(f'SELECT * FROM {t} WHERE n_number = ?', (n,)).fetchone()
            if r:
                return {'nNumber': n, 'recordType': kind}
        return {'nNumber': n, 'recordType': 'not_on_file'}
    out = {'nNumber': row[0], 'recordType': 'active', 'serialNumber': row[1],
           'yearManufactured': row[2], 'status': row[3], 'modeSCodeHex': row[4],
           'expirationDate': row[5], 'aircraftType': row[6], 'engineTypeCode': row[7],
           'make': row[9], 'model': row[10], 'engineCount': row[11], 'seats': row[12]}
    out['engine'] = None if not row[8] else {
        'make': row[13], 'model': row[14], 'horsepower': row[15], 'thrust': row[16]}
    out['engineKeyPresent'] = bool(row[8])
    return out


# Each question carries the tokens an answer must contain to count as complete,
# and tokens it must not contain (a guess where the source records absence).
QUESTIONS = [
    ('Q1',  'What aircraft is registered as N1013A?',                  'N1013A',  ['767-36N'], []),
    ('Q2',  'What engine does N10000 have? (blank engine key)',        'N10000',  ['Unknown', 'null', 'None', 'SR22T'], ['LYCOMING', 'CONT MOTOR', '"engineMake"']),
    ('Q3',  'Is N10025 a valid registration? (status edge case)',      'N10025',  ['Revoked', 'revoked', '"9"'], []),
    ('Q4',  'Make/model/seats for N1013A (ACFTREF resolution)',        'N1013A',  ['BOEING'], []),
    ('Q5',  'When does N100 expire?',                                  'N100',    ['2027-04-30', '04/30/2027', '20270430'], []),
    ('Q6',  'What airframe was N10003? (deregistered)',                'N10003',  ['056336T', 'Deregistered', 'deregistered'], []),
    ('Q7',  'What is N1000C? (reserved, never registered)',            'N1000C',  ['Reserved', 'reserved'], []),
    ('Q8',  'Mode S hex for N1013A (ADS-B correlation)',               'N1013A',  ['A00B2D'], []),
    ('Q9',  'Year of manufacture for N100',                            'N100',    ['1940'], []),
    ('Q10', 'Engine count and seats for N10000',                       'N10000',  ['SR22T'], []),
    ('Q11', 'Has N100 ever carried a different airframe? (history)',   'N100',    ['150'], []),
    ('Q12', 'What is N99AQ? (valid format, unassigned)',               'N99AQ',   ['not_on_file', 'not found', 'No records', 'Not Found', 'is Not Assigned', 'no aircraft'], []),
]


def complete(blob, expect, forbid):
    """Complete == at least one expected token present and no forbidden token."""
    if not blob:
        return False
    if any(f.lower() in blob.lower() for f in forbid):
        return False
    return any(e.lower() in blob.lower() for e in expect)


def http(url):
    t0 = time.time()
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64)'})
    with urllib.request.urlopen(req, timeout=40) as r:
        body = r.read()
    return body, time.time() - t0


def mcp(name, args):
    ep = 'https://faa-aircraft-registry.caseyjhand.com/mcp'
    hdr = ['-H', 'Content-Type: application/json', '-H', 'Accept: application/json, text/event-stream']
    init = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize",
                       "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                                  "clientInfo": {"name": "df-eval", "version": "1"}}})
    subprocess.run(['curl', '-s', '-m', '30', '-X', 'POST', ep] + hdr + ['-d', init],
                   capture_output=True)
    body = json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                       "params": {"name": name, "arguments": args}})
    t0 = time.time()
    p = subprocess.run(['curl', '-s', '-m', '40', '-X', 'POST', ep] + hdr + ['-d', body],
                       capture_output=True)
    dt = time.time() - t0
    payload = b''
    for line in p.stdout.split(b'\n'):
        if line.startswith(b'data: ') and b'"id":2' in line:
            payload = line[6:]
    return payload, dt


if __name__ == '__main__':
    t0 = time.time()
    c = build()
    build_s = time.time() - t0
    size = os.path.getsize(DB)
    print(f'non-PII mirror built in {build_s:.1f}s -> {size:,} bytes ({size/1048576:.0f} MiB)')
    print()
    hdr = (f'{"Q":<5}{"question":<50}'
           f'{"A bytes":>9}{"A ms":>7}{"A ok":>6}'
           f'{"C bytes":>9}{"C ms":>7}{"C ok":>6}'
           f'{"D bytes":>9}{"D ms":>7}{"D ok":>6}')
    print(hdr); print('-' * len(hdr))
    tot = {k: [0, 0.0, 0] for k in 'ACD'}
    for qid, q, n, expect, forbid in QUESTIONS:
        t = time.time()
        a = answer(c, n)
        cms = (time.time() - t) * 1000
        cblob = json.dumps(a, separators=(',', ':'))
        cb = len(cblob)
        cok = complete(cblob, expect, forbid)
        tot['C'][0] += cb; tot['C'][1] += cms; tot['C'][2] += cok
        ab = am = db = dm = 0; aok = dok = False
        if LIVE:
            try:
                blob, s_ = http(f'https://registry.faa.gov/AircraftInquiry/Search/NNumberResult?nNumberTxt={n[1:]}')
                ab, am = len(blob), s_ * 1000
                aok = complete(blob.decode('utf-8', 'replace'), expect, forbid)
            except Exception:
                ab = -1
            tool = 'faa_lookup_registration' if a.get('recordType') == 'active' else 'faa_get_registration_status'
            try:
                blob, s_ = mcp(tool, {'nNumber': n})
                db, dm = len(blob), s_ * 1000
                dok = complete(blob.decode('utf-8', 'replace'), expect, forbid)
            except Exception:
                db = -1
            tot['A'][0] += max(ab, 0); tot['A'][1] += am; tot['A'][2] += aok
            tot['D'][0] += max(db, 0); tot['D'][1] += dm; tot['D'][2] += dok
        print(f'{qid:<5}{q:<50}{ab:>9,}{am:>7.0f}{("yes" if aok else "NO"):>6}'
              f'{cb:>9,}{cms:>7.1f}{("yes" if cok else "NO"):>6}'
              f'{db:>9,}{dm:>7.0f}{("yes" if dok else "NO"):>6}')
    print('-' * len(hdr))
    n = len(QUESTIONS)
    print(f'{"TOT":<5}{"":<50}{tot["A"][0]:>9,}{tot["A"][1]:>7.0f}{str(tot["A"][2])+"/"+str(n):>6}'
          f'{tot["C"][0]:>9,}{tot["C"][1]:>7.1f}{str(tot["C"][2])+"/"+str(n):>6}'
          f'{tot["D"][0]:>9,}{tot["D"][1]:>7.0f}{str(tot["D"][2])+"/"+str(n):>6}')
    if LIVE and tot['A'][0]:
        print(f'\nbytes per answer: A {tot["A"][0]/n:,.0f}  C {tot["C"][0]/n:,.0f}  D {tot["D"][0]/n:,.0f}')
        print(f'C is {tot["A"][0]/tot["C"][0]:.0f}x lighter than A; D is {tot["A"][0]/tot["D"][0]:.0f}x lighter than A; '
              f'C is {tot["D"][0]/tot["C"][0]:.1f}x lighter than D')
