# Federal Register API metadata coverage over the saved samples:
# fr_rules.json (recent rules) and fr_pro.json (recent proposed rules).
import json, re
rules = json.load(open('fr_rules.json'))['results']
props = json.load(open('fr_pro.json'))['results']
eff = sum(bool(r.get('effective_on')) for r in rules)
cfr = sum(bool(r.get('cfr_references')) for r in rules + props)
close = sum(bool(r.get('comments_close_on')) for r in props)
comp = sum(bool(re.search(r'compliance date', r.get('dates') or '', re.I)) for r in rules)
print(f'rules={len(rules)} effective_on={eff} dates_mentions_compliance_date={comp}')
print(f'proposed={len(props)} comments_close_on={close}')
print(f'cfr_references_present={cfr}/{len(rules) + len(props)}')
# fr_comp.json: rules from the last 12 months whose full text mentions
# "compliance date" (API term search); first page saved.
comp_rules = json.load(open('fr_comp.json'))
page = comp_rules['results']
in_dates = sum(bool(re.search(r'compliance date', r.get('dates') or '', re.I)) for r in page)
no_eff = sum(not r.get('effective_on') for r in page)
print(f'compliance_date_rules_total={comp_rules["count"]} sampled={len(page)} dates_field_mentions={in_dates} effective_on_missing={no_eff}')
