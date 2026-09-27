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
    return bool(m) and (any(c in m for c in WILD) or bool(re.search(r'\([A-Z0-9 ]+(,[A-Z0-9 ]+)+\)', m.upper())))

def model_key(m):
    """concrete key: uppercase alnum only"""
    return re.sub(r'[^A-Z0-9]', '', (m or '').upper())

def pattern_key(m):
    """canonical pattern string: uppercase, punctuation dropped, wildcards kept"""
    return re.sub(r'[^A-Z0-9*#?(),]', '', (m or '').upper())

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
        """returns (method, ids) or (None, [])"""
        b = brand_key(brand)
        if is_pattern(model):
            ids = self.patkeys.get((b, pattern_key(model))) if brand_scoped else None
            if ids: return ('pattern=pattern', ids)
            # compare pattern against concrete models of same brand: compile incoming
            rx = compile_pattern(model, self.mode)
            if rx is None: return (None, [])
            hits = [rid for k in self.by_brand.get(b, ()) if rx.match(k) for rid in self.exact[(b, k)]] if brand_scoped else []
            if hits: return ('their-pattern~our-exact', hits)
            return (None, [])
        k = model_key(model)
        if brand_scoped:
            if (b, k) in self.exact: return ('exact', self.exact[(b, k)])
            hits = [rid for rx, raw, rid in self.pats.get(b, []) if rx.match(k)]
            if hits: return ('our-pattern~their-exact', hits)
            return (None, [])
        if k in self.exact_any: return ('exact-anybrand', [r for _, r in self.exact_any[k]])
        hits = [rid for rx, raw, bb, rid in self.pats_any.get(k[:3], []) if rx.match(k)]
        if hits: return ('pattern-anybrand', hits)
        return (None, [])
