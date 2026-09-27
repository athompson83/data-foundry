import re,unicodedata
SUF=r'\b(incorporated|inc|llc|l l c|ltd|limited|corp|corporation|co|company|lp|llp|plc|sa|s a|de c ?v|s de r ?l|gmbh|ag|bv|nv|pty|usa|us|of america|north america|na|group|holdings|industries|international|intl|mfg|manufacturing|products|the)\b'
def norm(s):
  s=unicodedata.normalize('NFKD',s or '').encode('ascii','ignore').decode().lower()
  s=re.split(r'\b(?:dba|d/b/a|a div(?:ision)? of|a division of|formerly|f/k/a|fka|\(prev)\b',s)[0]
  s=s.replace('&',' and ')
  s=re.sub(r'[^a-z0-9 ]',' ',s); s=re.sub(SUF,' ',s); s=re.sub(r'\band\b',' ',s)
  return re.sub(r'\s+',' ',s).strip()
def norm_loose(s):
  return norm(s).replace(' ','')
def norm2(s):
  s=s or ''
  s=re.sub(r'\([^)]*\)','',s)
  s=re.split(r'(?i)\s(?:d\?b\?a|a div\.?(?:ision)?\s?of|div\.?\s?of|a div\.?of)\b|/',s)[0]
  return norm_loose(s)
