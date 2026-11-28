"""SPDX license list vs OSI license API. Usage: python3 -I measure.py <spdx licenses.json> <osi api json> <out.json> <details dir>
details dir holds details/<id>.json for the first 40 non-deprecated SPDX ids (fetched with curl)."""
import sys,json,os
spdx=json.load(open(sys.argv[1]))['licenses']; osi=json.load(open(sys.argv[2])); det=sys.argv[4]
ids={x['licenseId'] for x in spdx}; flagged={x['licenseId'] for x in spdx if x.get('isOsiApproved')}
oa=[x for x in osi if x.get('spdx_id')]
hit=[x['spdx_id'] for x in oa if x['spdx_id'] in ids]
texts=0; n=0; lens=[]
for f in sorted(os.listdir(det)):
    d=json.load(open(os.path.join(det,f))); n+=1
    if d.get('licenseText'): texts+=1; lens.append(len(d['licenseText']))
out={'spdx_list_version':json.load(open(sys.argv[1]))['licenseListVersion'],'spdx_licenses':len(spdx),'spdx_deprecated':sum(1 for x in spdx if x['isDeprecatedLicenseId']),
 'spdx_osi_flagged':len(flagged),'osi_records':len(osi),'osi_with_spdx_id':len(oa),'osi_spdx_id_found_in_spdx':len(hit),
 'osi_spdx_id_missing':sorted(x['spdx_id'] for x in oa if x['spdx_id'] not in ids),
 'osi_ids_flagged_by_spdx_as_osi_approved':sum(1 for i in hit if i in flagged),
 'detail_files_checked':n,'detail_files_with_license_text':texts,'license_text_chars_min_max':[min(lens),max(lens)] if lens else None}
json.dump(out,open(sys.argv[3],'w'),indent=1); print(out)
