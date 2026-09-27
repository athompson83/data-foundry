import json,re,collections
d=json.load(open('cpsc_all.json'))
TYPES0={'Gas Ranges (With Ovens)','Stand Alone Freezers','Gas Clothes Dryers','Dryers','Ovens/Stoves/Ranges/Microwaves','Refrigerators','Dishwashers','Washing Machines','Clothes Dryers','Dehumidifiers','Ranges and Ovens','Microwave Ovens','Freezers','Ice Makers','Air Conditioners','Clothes Washers','Clothes Dryers or Washers','Cooktops','Trash Compactors','Garbage Disposers','Refrigerators or Freezers','Range Hoods','Dryers (Clothes)','Stoves','Wall Ovens'}
KW=re.compile(r"\b(refrigerators?|fridges?|freezers?|dishwashers?|(?:clothes |electric |gas )?dryers?|washing machines?|(?:clothes |front[- ]load(?:ing)? |top[- ]load(?:ing)? )washers?|washers? and dryers?|ranges?|cooktops?|wall ovens?|built-in ovens?|over[- ]the[- ]range|microwave(?: oven)?s?|dehumidifiers?|room air conditioners?|window air conditioners?|portable air conditioners?|ice makers?|trash compactors?|garbage disposers?|range hoods?|wine (?:coolers?|refrigerators?)|beverage (?:coolers?|refrigerators?)|gas stoves?|electric stoves?|through[- ]the[- ]wall air conditioners?|PTACs?)\b",re.I)
NEG=re.compile(r"\b(hair dryers?|hand dryers?|pressure washers?|dryer vent brush|toys?|children|kids|salad spinner|lint|toasters?|crisper|pans?|portable gas stoves?|camp\w*|grills?|oven mitts?|potholders?|dryer sheets?|driving range|range ?finders?|free[- ]range|mountain range|gel packs?|lunch\w*|popcorn|coolers? bags?)\b",re.I)
TYPES=TYPES0-{'Air Conditioners'}
alltypes=collections.Counter()
for r in d:
  for p in r.get('Products') or []: alltypes[p.get('Type')]+=1
print([t for t in alltypes if t and re.search(r'refrig|freez|dish|wash|dryer|oven|range|stove|microw|dehumid|air cond|ice mak|compact|dispos|hood|cooktop',t,re.I)])
out=[]
for r in d:
  types={p.get('Type') for p in r.get('Products') or []}
  t=re.sub(r'Viking Range|Range Corp','',r.get('Title') or '')
  hit=False
  if types & TYPES and not NEG.search(t): hit=True
  elif KW.search(t) and not NEG.search(t): hit=True
  if hit: out.append(r)
print(len(out))
json.dump(out,open('cpsc_appliance.json','w'))
by=collections.Counter(r['RecallDate'][:4] for r in out)
print(sorted(by.items()))
