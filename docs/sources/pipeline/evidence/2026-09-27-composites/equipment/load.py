import csv, json, sys, glob, os
csv.field_size_limit(10**9)
B='/tmp/claude-0/-home-user-data-foundry/ea325b01-a089-5c05-94c4-acbba3dfebfa/scratchpad'
E3=B+'/research3/equipment'
def es_mi():
    return list(csv.DictReader(open(E3+'/es/mi_noncac.csv', encoding='utf-8')))
def es_cac():
    return list(csv.DictReader(open(E3+'/es/mi_cac_grp.csv', encoding='utf-8')))
def nrcan():
    out=[]
    for f in glob.glob(E3+'/nrcan/*/*Data_Donn*.csv'):
        cat=os.path.basename(os.path.dirname(f))
        for r in csv.DictReader(open(f, encoding='latin-1')):
            out.append({'file':cat,'id':r['REC_REF_KEY'],'brand':r['BRAND_NAME'],'model':r['MODEL_NUM_1']})
    return out
def au(name):
    p={'ac':E3+'/au/ac.csv','hw':E3+'/au/hw.csv','rf':B+'/research2/appliance/au_rf.csv','dw':B+'/research2/appliance/au_dw.csv','cw':B+'/research2/appliance/au_cw.csv'}[name]
    return list(csv.DictReader(open(p, encoding='utf-8-sig', errors='ignore')))
def ws():
    out=[]
    for f in glob.glob(E3+'/ws/*.csv'):
        for r in csv.DictReader(open(f, encoding='utf-8-sig', errors='ignore')):
            r['_file']=os.path.basename(f); out.append(r)
    return out
def cpsc():
    return json.load(open(B+'/cpsc-recalls/recalls.json'))
