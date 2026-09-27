import json,re,collections,sys
sys.path.insert(0,'.');from common import *
d=json.load(open('cpsc_all.json'))
# facets: appliance classifier is round-2 classify.py verbatim; others are round-2 keyword sets (HVAC re-stated here)
TYPES={'Gas Ranges (With Ovens)','Stand Alone Freezers','Gas Clothes Dryers','Dryers','Ovens/Stoves/Ranges/Microwaves','Refrigerators','Dishwashers','Washing Machines','Clothes Dryers','Dehumidifiers','Ranges and Ovens','Microwave Ovens','Freezers','Ice Makers','Clothes Washers','Clothes Dryers or Washers','Cooktops','Trash Compactors','Garbage Disposers','Refrigerators or Freezers','Range Hoods','Dryers (Clothes)','Stoves','Wall Ovens'}
KW=re.compile(r"\b(refrigerators?|fridges?|freezers?|dishwashers?|(?:clothes |electric |gas )?dryers?|washing machines?|(?:clothes |front[- ]load(?:ing)? |top[- ]load(?:ing)? )washers?|washers? and dryers?|ranges?|cooktops?|wall ovens?|built-in ovens?|over[- ]the[- ]range|microwave(?: oven)?s?|dehumidifiers?|room air conditioners?|window air conditioners?|portable air conditioners?|ice makers?|trash compactors?|garbage disposers?|range hoods?|wine (?:coolers?|refrigerators?)|beverage (?:coolers?|refrigerators?)|gas stoves?|electric stoves?|through[- ]the[- ]wall air conditioners?|PTACs?)\b",re.I)
NEG=re.compile(r"\b(hair dryers?|hand dryers?|pressure washers?|dryer vent brush|toys?|children|kids|salad spinner|lint|toasters?|crisper|pans?|portable gas stoves?|camp\w*|grills?|oven mitts?|potholders?|dryer sheets?|driving range|range ?finders?|free[- ]range|mountain range|gel packs?|lunch\w*|popcorn|coolers? bags?)\b",re.I)
HVAC=re.compile(r"\b(furnaces?|heat pumps?|air handlers?|central air|condensing units?|mini[- ]splits?|ductless|thermostats?|boilers?|baseboard heaters?|wall heaters?|space heaters?|heaters?|ventilat\w+|bath(?:room)? fans?|exhaust fans?|humidifiers?|air purifiers?|air cleaners?|evaporative coolers?|HVAC|packaged terminal)\b",re.I)
PLUMB=re.compile(r'\b(water heaters?|tankless|faucets?|toilets?|shower ?heads?|bidet|garbage disposals?|sump pumps?|well pumps?|water softeners?|water filters?|water filtration|reverse osmosis|plumbing|backflow|expansion tanks?|boilers?|pex|supply lines?|water dispensers?|shut-?off valves?|pressure relief|gas valves?|hot water dispensers?)\b',re.I)
ELEC=re.compile(r'circuit breaker|\bbreakers?\b|GFCI|AFCI|ground[- ]fault|arc[- ]fault|receptacle|outlet|extension cord|power strip|surge protect|load cent|electrical panel|panelboard|wiring device|light switch|dimmer|\bEV charg|electric vehicle charg|EVSE|ceiling fan|light fixture|luminaire|LED (?:light|lamp|bulb|fixture)|smoke alarm|carbon monoxide alarm|CO alarm|generator|inverter|power station|transfer switch|junction box|electrical cord|power cord',re.I)
BLDG=re.compile(r'\b(windows?|doors?|garage door|door openers?|skylights?|stair|railings?|decking|drywall|insulation|roofing|shingles?|flooring|ladders?|fire extinguishers?|smoke alarms?|carbon monoxide (?:alarms?|detectors?)|fireplaces?|chimney|wood stoves?|pellet stoves?|gas logs?)\b',re.I)
HAZ=re.compile(r'shock|electrocut|fire|burn|overheat|arc',re.I)
def title_prod(r): return (r.get('Title') or '')+' '+' '.join((p.get('Name') or '') for p in r.get('Products') or [])
out=[]
for r in d:
    t=title_prod(r); types={p.get('Type') for p in r.get('Products') or []}
    tt=re.sub(r'Viking Range|Range Corp','',t)
    f=[]
    if (types & TYPES or KW.search(tt)) and not NEG.search(tt): f.append('appliance')
    if HVAC.search(t) and not NEG.search(t) and not re.search(r'hair|hand warmer|bottle|heated (?:vest|jacket|glove|blanket)|seat heater|warmer',t,re.I): f.append('hvac')
    if PLUMB.search(t): f.append('plumbing-water-heating')
    haz=' '.join((h.get('Name') or '') for h in r.get('Hazards') or [])
    if ELEC.search(t) and HAZ.search(haz+' '+(r.get('Description') or '')): f.append('electrical')
    if BLDG.search(t) and not NEG.search(t) and not re.search(r'\bdoll|toy|window (?:blind|covering|shade)s?|window air|window-mounted|cabinet door',t,re.I): f.append('building-products')
    if not f: continue
    firm=re.split(r'\s+(?:Recalls?|Announces?|Expands?|Reannounces?|to Recall|and .{0,40}? Recall)\b',r.get('Title') or '',1)[0]
    firms=[firm]+[x.get('Name','') for k in ('Manufacturers','Importers','Distributors') for x in r.get(k) or []]
    desc=(r.get('Description') or '')+' '+' '.join((p.get('Model') or '')+' '+(p.get('Description') or '') for p in r.get('Products') or [])
    out.append({'id':r['RecallNumber'],'date':r['RecallDate'][:10],'title':r.get('Title'),'facets':f,'firm':firm,
      'brand_tokens':sorted(set().union(*[brand_tokens(x) for x in firms])|brand_tokens(' '.join(p.get('Name') or '' for p in r.get('Products') or []))),
      'models':sorted(model_tokens(desc)),'upcs':[re.sub(r'\D','',u.get('UPC','') if isinstance(u,dict) else str(u)) for u in r.get('ProductUPCs') or []],
      'units':' '.join(p.get('NumberOfUnits') or '' for p in r.get('Products') or []),'url':r.get('URL')})
json.dump(out,open('cpsc_home.json','w'))
c=collections.Counter(x for r in out for x in r['facets']);print(len(out),c)
print('since2015',sum(r['date']>='2015' for r in out),'since2023',sum(r['date']>='2023' for r in out))
print('with model tokens',sum(bool(r['models']) for r in out),'with upc',sum(bool(r['upcs']) for r in out))
