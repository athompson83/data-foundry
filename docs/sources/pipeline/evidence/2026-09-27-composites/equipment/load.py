import csv, json, sys, glob, os
csv.field_size_limit(10**9)
# Input root for a replay: set DF_EVIDENCE_INPUTS to the directory holding the restored inputs, laid out as
# research3/equipment/{es,au,nrcan,ws}/..., research2/appliance/au_*.csv, research2/electrical/cec_*.xlsx and
# cpsc-recalls/recalls.json. Defaults to ./inputs next to this script.
B=os.environ.get('DF_EVIDENCE_INPUTS', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'inputs'))
E3=B+'/research3/equipment'
# Generated outputs are written next to the scripts (the committed evidence), never into the restored input tree.
OUT=os.path.dirname(os.path.abspath(__file__))
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
