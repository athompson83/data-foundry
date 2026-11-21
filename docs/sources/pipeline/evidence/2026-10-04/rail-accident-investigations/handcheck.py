#!/usr/bin/env python3
"""Hand-check outcome for the NTSB RIR <-> FRA Form 54 candidate links in results.json (ntsb_fra_link).
Each verdict was read by a human-equivalent comparison of the RIR section 1.1 text with the FRA narrative,
using railroad, date, place and train identifier. Appends `hand_check` to results.json."""
import json, os
p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'results.json')
R = json.load(open(p))
checks = [
 ('2502', 'CSX 000217438', True,  'CSX, 2024-04-15, Folkston GA, head-on collision on the Jesup Subdivision (FRA narrative names stationary train L74314, RIR names the same rock train)'),
 ('2503', 'BNSF PR1023108', True, 'BNSF, 2023-10-15, Pueblo CO; train C-ATMCRD0-31D appears in both'),
 ('2505', 'NS 155636', True,      'NS, 2024-01-31, Decatur AL yard rollout striking an occupied locomotive; 1 killed in both'),
 ('2508', 'UP 0724PR005', True,   'UP, 2024-07-06, Melrose Park IL; trains MCBCH-05 and MPRNL-06 appear in both'),
 ('2401', 'PCMZ 20220310B', True, 'Caltrain 506, 2022-03-10, San Bruno CA, struck three hi-rail vehicles at MP 11.6 in both'),
 ('2403', 'UP 0822TO041', True,   'UP, 2022-08-29, El Paso TX; train ISIEP-29 shoving move derailing two cars in both'),
 ('2406', 'NS 152485', True,      'NS, 2023-03-07, Cleveland OH; train C75B106 struck by dump truck at private crossing in both'),
 ('2407', 'UP 0922LA016', True,   'UP, 2022-09-08, Imperial County CA (FRA station NILAND); train ISILB-07 into Bertram siding, 2 killed in both. City rule missed it; county matched'),
 ('2412', 'UP 0423TO022', True,   'UP, 2023-04-16, Chico TX (FRA station BRIDGEPORT, same Wise County); train GS15 vs RD14 collision in both. City rule missed it'),
 ('2506', 'NS Middletown PA', False, 'NTSB occurrence at Easton PA; the only same-day PA FRA records are NS at MIDDLETOWN, a different place; not the same record'),
 ('2402', 'CSX Fort Deposit AL', False, 'NTSB case is Norfolk Southern at Bessemer AL; FRA same-day AL record is CSX at Fort Deposit; different railroad and place'),
 ('2301', 'BNSF Ludlow CA', False, 'NTSB case is La Mirada CA yard fatality; FRA same-day CA record is BNSF at LUDLOW with 0 killed; different place'),
]
R['hand_check'] = {'rule': 'same date + same state (candidate), then compare railroad, place and train id', 'checked': len(checks), 'correct': sum(c[2] for c in checks),
                   'rows': [{'rir': a, 'fra': b, 'same_record': c, 'basis': d} for a, b, c, d in checks]}
json.dump(R, open(p, 'w'), indent=1, default=str)
print(R['hand_check']['correct'], '/', R['hand_check']['checked'])
