"""Collect the CPSC Recall API list (JSON) in RecallDate windows, splitting a window in half when the API answers its
HTTP-200 error body ('Error retrieving Recalls: The underlying provider failed on Open.'). Records every failure seen."""
import json, subprocess, time, datetime as dt
UA = 'data-foundry-scout (data@mail.proviciency.com)'
fails = []; out = {}
def fetch(s, e):
    url = f'https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart={s}&RecallDateEnd={e}'
    for a in range(3):
        o = subprocess.run(['curl', '-sS', '-m', '120', '-A', UA, url], capture_output=True, text=True).stdout
        time.sleep(0.7)
        try:
            j = json.loads(o)
        except Exception: j = None
        if j is not None and not (j and j[0].get('RecallID') == 0 and not j[0].get('RecallNumber')): return j
        fails.append((s, e, o[:80]))
        time.sleep(2)
    return None
def win(s, e, depth=0):
    j = fetch(s, e)
    if j is not None:
        for r in j: out[r['RecallNumber']] = r
        return
    a, b = dt.date.fromisoformat(s), dt.date.fromisoformat(e)
    if (b - a).days < 20: print('GAVE UP', s, e, flush=True); return
    m = a + (b - a) / 2
    win(s, str(m), depth + 1); win(str(m + dt.timedelta(days=1)), e, depth + 1)
for s, e in [('1900-01-01', '1989-12-31'), ('1990-01-01', '1999-12-31')] + [(f'{y}-01-01', f'{y}-12-31') for y in range(2000, 2027)]:
    win(s, e)
json.dump(list(out.values()), open('/tmp/claude-0/rw/cpsc.json', 'w'))
json.dump(fails, open('/tmp/claude-0/rw/cpsc_fails.json', 'w'))
print('records', len(out), 'failed attempts', len(fails), flush=True)
