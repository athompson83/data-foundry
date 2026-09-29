import json,re,requests,time,collections,random
H={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)'}
fr=json.load(open('fr_2026_texts_60.json'));lst=json.load(open('fr_2026_list.json'))
easa=json.load(open('easa_samples.json'))
res={}
def cnt(seq,fn):
    seq=list(seq);return f'{sum(1 for x in seq if fn(x))}/{len(seq)}'
# --- FR extraction hit rates on 60 texts
def adnum(d): 
    for x in (d.get('docket_ids') or []):
        m=re.match(r'AD (\d{4}-\d{2}-\d{2})$',x)
        if m:return m.group(1)
n=len(fr)
res['fr_texts']=n
res['fr_AD_number_in_docket_ids']=cnt(fr,lambda d:adnum(d))
res['fr_AD_number_regex_in_text']=cnt(fr,lambda d:re.search(r'AD (\d{4}-\d{2}-\d{2})',d['text']))
res['fr_ATA_code_in_text']=cnt(fr,lambda d:re.search(r'(?:ATA|JASC)[^.]{0,40}?(?:Code|Chapter)\D{0,15}\d{2}',d['text'],re.I))
res['fr_supersedes_AD']=cnt(fr,lambda d:re.search(r'supersed\w+[^.]{0,80}AD \d{4}-\d{2}-\d{2}',d['text']))
res['fr_cites_EASA_AD']=cnt(fr,lambda d:re.search(r'EASA[^.]{0,60}?(?:AD|Airworthiness Directive)\s*(?:No\.?\s*)?\d{4}-\d{4}',d['text']))
res['fr_cites_TC_AD']=cnt(fr,lambda d:re.search(r'Transport Canada[^.]{0,120}CF-\d{4}-\d+',d['text']))
res['fr_model_regex']=cnt(fr,lambda d:re.search(r'\b(?:Model|Models)\s+[A-Z0-9][\w\-/]+',d['text']))
# FAA->EASA declared cross-citation check
cites=[]
for d in fr:
    for m in set(re.findall(r'EASA[^.]{0,60}?(?:AD|Airworthiness Directive)\s*(?:No\.?\s*)?(\d{4}-\d{4}(?:R\d)?)',d['text'])): cites.append((d['document_number'],m))
ok=0;chk=[]
for dn,c in cites[:40]:
    try:
        r=requests.get('https://ad.easa.europa.eu/ad/'+c,headers=H,timeout=60,allow_redirects=False);hit=r.status_code==200 and ('Issue date' in r.text)
    except Exception as ex:
        class R: status_code=str(ex)[:30]
        r=R();hit=False
    chk.append((dn,c,r.status_code,hit));ok+=hit;time.sleep(0.4)
res['faa_to_easa_declared_cited_total']=len(cites)
res['faa_to_easa_resolved_on_easa_tool']=f"{ok}/{len(chk)}";res['faa_to_easa_detail']=chk
# --- EASA US- -> FAA
us=[e for e in easa if e['id'].startswith('US-')]
def faa_lookup(ad):
    r=requests.get('https://www.federalregister.gov/api/v1/documents.json',params=[('conditions[term]',ad),('conditions[type][]','RULE'),('conditions[agencies][]','federal-aviation-administration'),('fields[]','document_number'),('fields[]','docket_ids'),('per_page',20)],headers=H,timeout=60).json()
    for d in r.get('results',[]):
        if any(x==f'AD {ad}' for x in (d.get('docket_ids') or [])): return d['document_number']
m=0;det=[]
for e in us:
    ad=e['id'][3:]
    dn=faa_lookup(ad);det.append((e['id'],dn));m+=bool(dn);time.sleep(0.3)
res['easa_US_records_matched_to_FAA_FR_AD']=f"{m}/{len(us)}";res['easa_US_detail']=det
# EASA sample fields
ee=[e for e in easa if re.match(r'\d{4}-\d{4}',e['id'])]
res['easa_own_AD_samples']=len(ee)
res['easa_ata_present']=cnt(easa,lambda e:e['ata'])
res['easa_holder_type_present']=cnt(easa,lambda e:e['holder_type'])
res['easa_supersedure_states_AD']=cnt(ee,lambda e:e['supersedure'] and re.search(r'\d{4}-\d{4}',e['supersedure']))
res['easa_body_cites_FAA_AD_number']=cnt(easa,lambda e:re.search(r'FAA[^.]{0,40}\d{4}-\d{2}-\d{2}',e['body']))
res['easa_body_cites_TC_CF']=cnt(easa,lambda e:re.search(r'CF-\d{4}-\d+',e['body']))
json.dump(res,open('ad_analysis.json','w'),indent=1)
print(json.dumps(res,indent=1))
