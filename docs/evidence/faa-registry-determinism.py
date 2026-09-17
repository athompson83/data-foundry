#!/usr/bin/env python3
# VALIDATION PROTOTYPE -- not product code, not wired to anything.
# Reproduces the determinism and join-integrity measurements in
# docs/commercial-validation/deterministic-candidate-screen-20260917.md
#
#   curl -o reg.zip https://registry.faa.gov/database/ReleasableAircraft.zip
#   python3 faa-registry-determinism.py reg.zip
import csv, io, sys, zipfile, collections

def load(z, name):
    with z.open(name) as f:
        return [{k.strip(): (v.strip() if v else '') for k, v in row.items() if k}
                for row in csv.DictReader(io.TextIOWrapper(f, encoding='utf-8-sig', errors='replace'))]

def main(path):
    z = zipfile.ZipFile(path)
    acft = {r['CODE']: r for r in load(z, 'ACFTREF.txt')}
    eng = {r['CODE']: r for r in load(z, 'ENGINE.txt')}
    master = load(z, 'MASTER.txt')

    nn = collections.Counter(r['N-NUMBER'] for r in master)
    dupes = [k for k, v in nn.items() if v > 1]
    print(f'master rows        : {len(master):,}')
    print(f'distinct N-numbers : {len(nn):,}')
    print(f'N-numbers with >1  : {len(dupes)}   <- must be 0 for a single-answer API')

    resolves_a = sum(1 for r in master if r['MFR MDL CODE'] in acft)
    blank_e = sum(1 for r in master if not r['ENG MFR MDL'])
    resolves_e = sum(1 for r in master if r['ENG MFR MDL'] in eng)
    orphan_e = len(master) - blank_e - resolves_e
    print(f'MFR MDL CODE resolves: {resolves_a:,}/{len(master):,} = {100*resolves_a/len(master):.2f}%')
    print(f'ENG MFR MDL resolves : {resolves_e:,}  blank {blank_e:,}  orphan {orphan_e}')

    # PII census -- drives the 49 U.S.C. 44114(b) scoping decision
    named = sum(1 for r in master if r['NAME'])
    indiv = sum(1 for r in master if r['TYPE REGISTRANT'] == '1')
    print(f'rows carrying owner NAME: {named:,}   registrant type Individual: {indiv:,}')

if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'reg.zip')
