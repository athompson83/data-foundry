import re,unicodedata
def fold(s):
    s=unicodedata.normalize('NFKD',s or '');return ''.join(c for c in s if not unicodedata.combining(c))
def nmodel(t):
    """Deterministic model normalisation: NFKD fold, upper, drop everything but A-Z0-9."""
    return re.sub(r'[^A-Z0-9]','',fold(t).upper())
def base_model(t):
    """Strip a market suffix after '/' (e.g. Samsung /AA, /EU) before normalising."""
    return nmodel(re.split(r'/',t,1)[0])
STOP={'THE','AND','INC','LLC','LTD','CO','CORP','CORPORATION','COMPANY','GROUP','USA','US','INTERNATIONAL','PTY','LIMITED','GMBH','SA','SL','SLU','AB','BV','NV','SPA','SRL','OF','BRAND','PRODUCTS','HOME','PLC','NORTH','AMERICA','AMERICAS','CANADA','UK','EUROPE','HOLDINGS','INDUSTRIES','ENTERPRISES','TECHNOLOGY','TECHNOLOGIES','ELECTRONICS','APPLIANCES','MANUFACTURING','TRADING'}
def brand_key(s):
    """Normalised brand: folded, upper, alnum words, legal-form/stop words removed, first 2 remaining words joined."""
    w=[x for x in re.findall(r'[A-Z0-9]+',fold(s).upper()) if x not in STOP]
    return ' '.join(w[:2])
def brand_tokens(s):
    return {x for x in re.findall(r'[A-Z0-9]+',fold(s).upper()) if x not in STOP and len(x)>=3}
# model-like token: >=5 chars after normalisation, has a letter and a digit (round-2 TOKEN regex, extended)
TOKEN=re.compile(r"(?<![A-Za-z0-9])(?=[A-Za-z0-9/\-\.]*\d)(?=[A-Za-z0-9/\-\.]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9/\-\.]{3,}[A-Za-z0-9](?![A-Za-z0-9])")
def model_tokens(text):
    out=set()
    for t in TOKEN.findall(text or ''):
        n=nmodel(t)
        if len(n)<5 or not re.search(r'\d',n) or not re.search(r'[A-Z]',n): continue
        if re.fullmatch(r'\d+(MM|CM|IN|V|W|KW|MAH|WH|HZ|LBS?|OZ|ML|L|G|KG|FT|BTU|AMPS?|A|GB|TB)',n): continue
        if re.fullmatch(r'(19|20)\d\d[A-Z]{1,3}',n): continue
        out.add(n)
    return out
