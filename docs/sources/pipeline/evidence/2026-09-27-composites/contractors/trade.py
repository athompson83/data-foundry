import re
def wa_trade(x):
    t=x['contractorlicensetypecodedesc']; s=(x['specialtycode1desc']+' | '+x['specialtycode2desc']).upper()
    out=set()
    if t=='ELECTRICAL CONTRACTOR': out.add('electrical')
    if t=='PLUMBING CONTRACTOR': out.add('plumbing')
    if 'HVAC' in s or 'REFRIG' in s or 'BOILER' in s: out.add('hvac')
    if re.search(r'\bPLUMBING\b|BACKFLOW|DRAIN CLEAN|SIDE SEWER',s): out.add('plumbing')
    if 'ROOFING' in s or 'GUTTER' in s: out.add('roofing')
    if 'APPLIANCE' in s: out.add('appliance')
    return out
