import json,re,requests,time,io,random
from pypdf import PdfReader
H={'User-Agent':'data-foundry-scout/1.0 (data@mail.proviciency.com)'}
a=json.load(open('aaib_all_meta.json'))
pool=[x for x in a if x.get('report_type') and x['report_type'][0] in('field-investigation','formal-report','correspondence-investigation') and (x.get('date_of_occurrence') or '')>='2019']
random.seed(5);smp=random.sample(pool,24)
out=[]
for x in smp:
    c=requests.get('https://www.gov.uk/api/content'+x['_id'],headers=H,timeout=60).json()
    d=c['details'];body=re.sub(r'<[^>]+>',' ',d.get('body',''))
    pdfs=[t for t in d.get('attachments',[]) if t.get('content_type')=='application/pdf' and 'lossary' not in t['title']]
    text=''
    if pdfs:
        try:
            r=requests.get(pdfs[0]['url'],headers=H,timeout=90)
            if len(r.content)<15e6:
                rd=PdfReader(io.BytesIO(r.content));text=' '.join((p.extract_text() or '') for p in rd.pages)
        except Exception as e: text='ERR '+str(e)[:80]
    out.append({'id':x['_id'],'title':x['title'],'reg':x.get('registration'),'type':x.get('aircraft_type'),'date':x.get('date_of_occurrence'),'rtype':x['report_type'],'body_chars':len(body),'n_pdfs':len(pdfs),'pdf_chars':len(text),'text':text[:200000],'body':body[:2000]})
    time.sleep(0.5)
json.dump(out,open('aaib_samples_24.json','w'))
n=len(out);withpdf=[o for o in out if o['pdf_chars']>200]
REG=re.compile(r'\b(?:G-[A-Z]{4}|N\d{1,5}[A-Z]{0,2}|[A-Z]-[A-Z]{4}|9H-[A-Z]{3})\b')
AD=re.compile(r'\b(?:AD|Airworthiness Directive)\s*(?:No\.?\s*)?(?:G-|CF-|US-)?\d{4}-\d{2,4}(?:-\d{2})?\b',re.I)
ADW=re.compile(r'airworthiness directive|\bEASA AD\b|\bFAA AD\b|\bCAA AD\b',re.I)
print(json.dumps({'sampled':n,'pdf_text_extracted':len(withpdf),'body_has_reg':sum(1 for o in out if o['reg'] and o['reg'].strip() in (o['body']+o['title'])),'pdf_names_own_registration':f"{sum(1 for o in withpdf if o['reg'] and o['reg'].strip().upper() in o['text'])}/{len(withpdf)}",'pdf_reg_regex':f"{sum(1 for o in withpdf if REG.search(o['text']))}/{len(withpdf)}",'pdf_AD_word':f"{sum(1 for o in withpdf if ADW.search(o['text']))}/{len(withpdf)}",'pdf_AD_number':f"{sum(1 for o in withpdf if AD.search(o['text']))}/{len(withpdf)}",'ad_examples':[m.group(0) for o in withpdf for m in AD.finditer(o['text'])][:20]},indent=1))
