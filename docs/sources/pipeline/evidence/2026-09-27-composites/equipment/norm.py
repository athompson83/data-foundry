import re
SUFFIX = r'\b(incorporated|inc|llc|l ?l ?c|ltd|limited|corp|corporation|co|company|usa|us|na|north america|lp|l ?p|gmbh|ag|sa|plc|holdings|group|manufacturing|mfg|international|intl|technologies|technology|industries)\b'
def brand_key(s):
    if not s: return ''
    s = s.lower()
    s = re.sub(r'[®™©]', '', s)
    s = s.replace('&', ' and ')
    s = re.sub(r'[^a-z0-9 ]', ' ', s)
    prev = None
    while prev != s:
        prev = s
        s = re.sub(SUFFIX + r'\s*$', '', s.strip())
    return re.sub(r'\s+', '', s)

WILD = set('*#?')
def is_pattern(m):
    # Wildcards, a parenthesised alternation (EPC110(N,L)) or a single optional literal (RS36W(X)) make a pattern.
    return bool(m) and (any(c in m for c in WILD) or bool(re.search(r'\([A-Z0-9 ]+(,[A-Z0-9 ]+)*\)', m.upper())))

def model_key(m):
    """concrete key: uppercase alnum only"""
    return re.sub(r'[^A-Z0-9]', '', (m or '').upper())

def pattern_key(m):
    """canonical pattern string: uppercase, punctuation dropped, wildcards kept. `*`, `#` and `?` compile to the same
    zero-or-one-character grammar, so they are canonicalised to `*` and equivalent patterns share one key."""
    return re.sub(r'[#?]', '*', re.sub(r'[^A-Z0-9*#?(),]', '', (m or '').upper()))

def compile_pattern(m, mode='opt1'):
    u = (m or '').upper()
    out = []; i = 0
    while i < len(u):
        c = u[i]
        if c == '(':
            j = u.find(')', i)
            if j > 0 and ',' in u[i:j]:
                alts = [re.sub(r'[^A-Z0-9]', '', a) for a in u[i+1:j].split(',')]
                out.append('(?:' + '|'.join(map(re.escape, alts)) + ')'); i = j + 1; continue
            if j > 0 and re.fullmatch(r'[A-Z0-9 ]+', u[i+1:j]):
                # A single parenthesised option is an optional literal: RS36W(X) matches RS36W and RS36WX.
                out.append('(?:' + re.escape(re.sub(r'[^A-Z0-9]', '', u[i+1:j])) + ')?'); i = j + 1; continue
        if c in WILD:
            out.append({'opt1': '[A-Z0-9]?', 'one': '[A-Z0-9]', 'run': '[A-Z0-9]*'}[mode])
        elif c.isalnum():
            out.append(re.escape(c))
        i += 1
    try:
        return re.compile('^' + ''.join(out) + '$')
    except re.error:
        return None

def literal_prefix(m, n=3):
    k = ''
    for c in (m or '').upper():
        if c in WILD or c == '(': break
        if c.isalnum(): k += c
        if len(k) >= n: break
    return k

class Index:
    """brand-scoped model index with exact keys and compiled patterns"""
    def __init__(self, mode=None):
        import os; mode = mode or os.environ.get('WMODE','opt1')
        self.exact = {}      # (brand, key) -> [ids]
        self.exact_any = {}  # key -> [(brand,id)]
        self.pats = {}       # brand -> [(regex, raw, id)]
        self.patkeys = {}    # (brand, patternkey) -> [ids]
        self.pats_any = {}   # prefix3 -> [(regex, raw, brand, id)]
        self.mode = mode
        self.by_brand = {}
    def add(self, brand, model, rid):
        b = brand_key(brand)
        if is_pattern(model):
            rx = compile_pattern(model, self.mode)
            if rx is None: return
            self.pats.setdefault(b, []).append((rx, model, rid))
            self.patkeys.setdefault((b, pattern_key(model)), []).append(rid)
            self.pats_any.setdefault(literal_prefix(model), []).append((rx, model, b, rid))
        else:
            k = model_key(model)
            if len(k) < 3: return
            self.exact.setdefault((b, k), []).append(rid)
            self.by_brand.setdefault(b, set()).add(k)
            self.exact_any.setdefault(k, []).append((b, rid))
    def lookup(self, brand, model, brand_scoped=True):
        """returns (method, ids) or (None, []).

        Every matching listing is returned (exact and wildcard alike, de-duplicated) because the results feed a review
        queue; `method` names the strongest kind found, so per-row counts keep their meaning.
        """
        b = brand_key(brand)
        found = []  # (method, ids) in order of strength
        if is_pattern(model):
            pk = pattern_key(model)
            rx = compile_pattern(model, self.mode)
            if brand_scoped:
                found.append(('pattern=pattern', self.patkeys.get((b, pk), [])))
                if rx is not None:
                    found.append(('their-pattern~our-exact', [rid for k in sorted(self.by_brand.get(b, ())) if rx.match(k) for rid in self.exact[(b, k)]]))
            else:
                found.append(('pattern=pattern-anybrand', [rid for (bb, key), rids in self.patkeys.items() if key == pk for rid in rids]))
                if rx is not None:
                    found.append(('their-pattern~our-exact-anybrand', [rid for k, lst in self.exact_any.items() if rx.match(k) for _, rid in lst]))
        else:
            k = model_key(model)
            if brand_scoped:
                found.append(('exact', self.exact.get((b, k), [])))
                found.append(('our-pattern~their-exact', [rid for rx, raw, rid in self.pats.get(b, []) if rx.match(k)]))
            else:
                found.append(('exact-anybrand', [r for _, r in self.exact_any.get(k, [])]))
                # Patterns are bucketed by their literal prefix, which is shorter than 3 characters when a wildcard comes
                # early (AB*123 -> 'AB'), so every prefix length up to 3 is probed.
                found.append(('pattern-anybrand', [rid for n in sorted({min(i, len(k)) for i in range(4)}) for rx, raw, bb, rid in self.pats_any.get(k[:n], []) if rx.match(k)]))
        method = next((m for m, ids in found if ids), None)
        ids = list(dict.fromkeys(rid for _, lst in found for rid in lst))
        return (method, ids) if method else (None, [])
