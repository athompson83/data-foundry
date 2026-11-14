"""Gene-disease evidence: ClinGen gene-disease validity curations (CSV download) vs UniProtKB/Swiss-Prot (REST).
Declared join: HGNC id on the ClinGen row = HGNC cross-reference on the UniProt entry.
Usage: python3 -I measure.py <clingen.csv> <out.json>. Sample: every 15th distinct ClinGen gene in file order, up to 60."""
import sys,csv,json,time,subprocess,urllib.parse
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u):
    for i in range(4):
        p=subprocess.run(['curl','-sSL','-m','45','-A',UA,u],capture_output=True)
        try: return json.loads(p.stdout)
        except Exception: time.sleep(2+i)
    return None
rows=[r for r in csv.reader(open(sys.argv[1],encoding='utf-8')) if len(r)>=10 and r[1].startswith('HGNC:')]
genes={}
for r in rows: genes.setdefault(r[1],[]).append({'symbol':r[0],'disease':r[2],'mondo':r[3],'moi':r[4],'classification':r[6],'date':r[8]})
ids=list(genes)[::15][:60]
out_rows=[]
for h in ids:
    j=get('https://rest.uniprot.org/uniprotkb/search?query=%s&size=2&fields=accession,gene_primary,cc_function,cc_disease,xref_hgnc&format=json'%urllib.parse.quote('reviewed:true AND organism_id:9606 AND xref:hgnc-'+h.split(':')[1]))
    res=(j or {}).get('results') or []
    e=res[0] if res else None
    hg=[x['id'] for x in e['uniProtKBCrossReferences'] if x['database']=='HGNC'] if e else []
    gp=e['genes'][0]['geneName']['value'] if e and e.get('genes') else None
    cm={c['commentType'] for c in e.get('comments',[])} if e else set()
    out_rows.append({'hgnc':h,'clingen_symbol':genes[h][0]['symbol'],'curations':len(genes[h]),'uniprot':e['primaryAccession'] if e else None,'hgnc_xref_matches':h in hg,'symbol_agrees':gp==genes[h][0]['symbol'],'function_text':'FUNCTION' in cm,'disease_text':'DISEASE' in cm})
    time.sleep(0.3)
f=[r for r in out_rows if r['uniprot']]
out={'clingen_curations':len(rows),'clingen_genes':len(genes),'sampled_genes':len(out_rows),'found_in_uniprot':len(f),'hgnc_xref_matches':sum(r['hgnc_xref_matches'] for r in f),'symbol_agrees':sum(r['symbol_agrees'] for r in f),'with_function_text':sum(r['function_text'] for r in f),'with_disease_text':sum(r['disease_text'] for r in f),'rows':out_rows}
json.dump(out,open(sys.argv[2],'w'),indent=1)
print({k:v for k,v in out.items() if k!='rows'})
