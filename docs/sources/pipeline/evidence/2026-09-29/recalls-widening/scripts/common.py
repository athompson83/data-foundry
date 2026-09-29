import urllib.request, json, time, os, re, sys
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(BASE, "raw")
def get(url, retries=3, timeout=90, binary=False):
    last = None
    for a in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA})
            r = urllib.request.urlopen(req, timeout=timeout)
            b = r.read()
            return (b if binary else b.decode("utf-8", "replace")), r.status
        except urllib.error.HTTPError as e:
            last = e
            if e.code in (404, 403, 401): return None, e.code
            time.sleep(3)
        except Exception as e:
            last = e; time.sleep(3)
    return None, str(last)
def gs1_valid(g):
    if not g.isdigit() or len(g) not in (8, 12, 13, 14): return False
    t = sum(int(c) * (3 if i % 2 == 0 else 1) for i, c in enumerate(reversed(g[:-1])))
    return (10 - t % 10) % 10 == int(g[-1])
def gtins(s):
    out = set()
    for tok in re.split(r'[,;/|\n]+|\s{2,}|\s(?=\d{8,14}(?!\d))', s or ''):
        for g in re.findall(r'(?<!\d)(\d{14}|\d{13}|\d{12}|\d{8})(?!\d)', re.sub(r'(?<=\d)[ -](?=\d)', '', tok)):
            if gs1_valid(g): out.add(g.zfill(14))
    return out
def gtins_fused(s):
    """gtins() plus recovery of several codes printed back-to-back with no separator: a digit run whose length is a
    multiple of 13 (or 12, 14, 8) is cut into equal chunks; a chunk counts only if its GS1 check digit is valid."""
    out = set(gtins(s))
    for run in re.findall(r'(?<!\d)\d{16,}(?!\d)', re.sub(r'(?<=\d)[ -](?=\d)', '', s or '')):
        for w in (13, 14, 12, 8):
            if len(run) % w == 0:
                ch = [run[i:i+w] for i in range(0, len(run), w)]
                if all(gs1_valid(c) for c in ch): out |= {c.zfill(14) for c in ch}; break
    return out
