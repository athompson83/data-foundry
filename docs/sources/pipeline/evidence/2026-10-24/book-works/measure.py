"""Books: Project Gutenberg catalog (CSV, 'Text#' = ebook number) vs Open Library works that declare id_project_gutenberg.
Usage: python3 -I measure.py <pg_catalog.csv> <out.json> <handcheck.json>   (download https://www.gutenberg.org/cache/epub/feeds/pg_catalog.csv first)"""
import sys,csv,json,re,subprocess,random
UA='data-foundry-scout/1.0 (data@mail.proviciency.com)'
def get(u): return subprocess.run(['curl','-sSL','-m','90','-A',UA,u],capture_output=True,text=True).stdout
pg={r['Text#']:r for r in csv.DictReader(open(sys.argv[1],encoding='utf-8'))}
ol=[];off=0
while True:
    j=json.loads(get(f'https://openlibrary.org/search.json?q=id_project_gutenberg:*&limit=100&offset={off}&fields=key,title,author_name,first_publish_year,id_project_gutenberg,lccn,oclc_numbers,isbn'))
    ol+=j['docs']; off+=100
    if off>=j['numFound'] or off>=2200: break
norm=lambda s:re.sub(r'[^a-z0-9]','',s.lower())
ids=[(d,i) for d in ol for i in d.get('id_project_gutenberg',[])]
found=[(d,i) for d,i in ids if i in pg]
tmatch=[(d,i) for d,i in found if norm(d['title'])[:12] and norm(d['title'])[:12] in norm(pg[i]['Title'])]
out={'pg_catalog_rows':len(pg),'pg_text_rows':sum(1 for r in pg.values() if r['Type']=='Text'),'pg_with_subjects':sum(1 for r in pg.values() if r['Subjects']),'pg_with_loc_class':sum(1 for r in pg.values() if r['LoCC']),
 'ol_works_declaring_gutenberg_id':len(ol),'ol_gutenberg_ids':len(ids),'ids_present_in_pg_catalog':len(found),'ids_whose_title_prefix_agrees':len(tmatch),
 'ol_with_lccn':sum(1 for d in ol if d.get('lccn')),'ol_with_isbn':sum(1 for d in ol if d.get('isbn'))}
random.seed(24); s=random.sample(found,12)
json.dump(out,open(sys.argv[2],'w'),indent=1)
json.dump([{'ol_key':d['key'],'ol_title':d['title'],'ol_author':(d.get('author_name') or [''])[0],'gutenberg_id':i,'pg_title':pg[i]['Title'][:80],'pg_author':pg[i]['Authors'][:60]} for d,i in s],open(sys.argv[3],'w'),indent=1)
print(json.dumps(out,indent=1))
