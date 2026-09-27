import re,html,sys
def txt(f):
  t=open(f,errors='ignore').read()
  t=re.sub(r'<script.*?</script>|<style.*?</style>','',t,flags=re.S)
  tx=html.unescape(re.sub(r'<[^>]+>',' ',t)); return re.sub(r'\s+',' ',tx)
if __name__=='__main__':
  f=sys.argv[1]; tx=txt(f)
  for k in sys.argv[2:]:
    for m in list(re.finditer(k,tx,re.I))[:3]:
      print('['+k+']',tx[max(0,m.start()-300):m.start()+500]); print('---')
