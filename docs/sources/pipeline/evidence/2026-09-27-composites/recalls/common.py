import re,unicodedata
def fold(s):
    s=unicodedata.normalize('NFKD',s or '');return ''.join(c for c in s if not unicodedata.combining(c))
def nmodel(t):
    """Deterministic model normalisation: NFKD fold, upper, drop everything but A-Z0-9."""
    return re.sub(r'[^A-Z0-9]','',fold(t).upper())
STOP={'THE','AND','INC','LLC','LTD','CO','CORP','CORPORATION','COMPANY','GROUP','USA','US','INTERNATIONAL','PTY','LIMITED','GMBH','SA','SL','SLU','AB','BV','NV','SPA','SRL','OF','BRAND','PRODUCTS','HOME','PLC','NORTH','AMERICA','AMERICAS','CANADA','UK','EUROPE','HOLDINGS','INDUSTRIES','ENTERPRISES','TECHNOLOGY','TECHNOLOGIES','ELECTRONICS','APPLIANCES','MANUFACTURING','TRADING'}
def brand_key(s):
    """Normalised brand: folded, upper, alnum words, legal-form/stop words removed, first 2 remaining words joined."""
    w=[x for x in re.findall(r'[A-Z0-9]+',fold(s).upper()) if x not in STOP]
    return ' '.join(w[:2])
# Real two-character brands. Other two-character tokens (initials, sizes, "UK") are too ambiguous to gate a candidate.
SHORT_BRANDS={'GE','LG','HP','3M','JL','AO','BK','KC'}
def brand_tokens(s):
    return {x for x in re.findall(r'[A-Z0-9]+',fold(s).upper()) if x not in STOP and (len(x)>=3 or x in SHORT_BRANDS)}
def slash_parts(t):
    """The extra model identifiers one slash form stands for, as printed (see model_tokens): the base of a short market
    suffix containing a letter (MODEL123/AA -> MODEL123), each half of an unspaced pair of model-like halves
    (ABC123/DEF456 -> ABC123, DEF456); nothing for any other form (FV126.07/87 stays one literal identifier)."""
    if t.count('/')!=1: return []
    head,tail=t.split('/')
    like=lambda k: len(nmodel(k))>=5 and re.search(r'\d',k) and re.search(r'[A-Za-z]',k)
    if like(head) and re.fullmatch(r'(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{1,3}',tail): return [head]
    if like(head) and like(tail): return [head,tail]
    return []
# model-like token: >=5 chars after normalisation, has a letter and a digit (round-2 TOKEN regex, extended)
TOKEN=re.compile(r"(?<![A-Za-z0-9])(?=[A-Za-z0-9/\-\.]*\d)(?=[A-Za-z0-9/\-\.]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9/\-\.]{3,}[A-Za-z0-9](?![A-Za-z0-9])")
def model_tokens(text):
    out=set()
    for t in TOKEN.findall(text or ''):
        n=nmodel(t)
        if len(n)<5 or not re.search(r'\d',n) or not re.search(r'[A-Z]',n): continue
        if re.fullmatch(r'\d+(MM|CM|IN|V|W|KW|MAH|WH|HZ|LBS?|OZ|ML|L|G|KG|FT|BTU|AMPS?|A|GB|TB)',n): continue
        if re.fullmatch(r'(19|20)\d\d[A-Z]{1,3}',n): continue
        # '/' is source-dependent (research record, "/ has three meanings"), so only two unambiguous forms change keys:
        # - a market suffix: one to three characters including a letter (Samsung /AA, /A5, /EU) -> the whole key plus
        #   the base key;
        # - an unspaced pair of two model-like halves (indoor/outdoor, ABC123/DEF456) -> each half, never the fused
        #   whole, which names no product.
        # Anything else (FV126.07/87, a numeric or long tail) stays one literal key.
        parts=slash_parts(t)
        if len(parts)<2: out.add(n)
        out.update(nmodel(x) for x in parts)
    return out
def digit_codes(s):
    """Barcode-like digit runs in a field that may list several codes: split on separators first, then rejoin a code
    printed in groups ("5 012345 678900"). Deleting every space first would fuse adjacent codes into one number."""
    out=[]
    for tok in re.split(r'[,;/|\n]+|\s{2,}|\s(?=\d{8,14}(?!\d))',s or ''):
        out+=re.findall(r'(?<!\d)\d{8,14}(?!\d)',re.sub(r'(?<=\d)[ -](?=\d)','',tok))
    return out
