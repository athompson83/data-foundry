"""Screen EPA SNAP rules in the Federal Register API: count, date range and title patterns. Run: python3 -I screen.py"""
import json, subprocess, re
UA = 'data-foundry-scout/1.0 (data@mail.proviciency.com)'
base = 'https://www.federalregister.gov/api/v1/documents.json?conditions[term]=%22Significant+New+Alternatives+Policy%22&conditions[agencies][]=environmental-protection-agency&conditions[type][]=RULE&per_page=200&order=oldest&fields[]=document_number&fields[]=title&fields[]=publication_date&fields[]=effective_on&fields[]=abstract&fields[]=full_text_xml_url'
d = json.loads(subprocess.run(['curl', '-g', '-sS', '-m', '90', '-A', UA, base], capture_output=True).stdout)
rs = d['results']
snap_titled = [r for r in rs if 'Significant New Alternatives Policy' in r['title']]
out = {'count': d['count'], 'returned': len(rs), 'oldest': rs[0]['publication_date'], 'newest': rs[-1]['publication_date'],
       'title_names_snap': len(snap_titled), 'with_effective_on': sum(1 for r in rs if r.get('effective_on')), 'with_abstract': sum(1 for r in rs if r.get('abstract')),
       'sample': [(r['document_number'], r['publication_date'], r['title'][:100]) for r in snap_titled[-5:]]}
json.dump(out, open('screen.json', 'w'), indent=1); print(out)
