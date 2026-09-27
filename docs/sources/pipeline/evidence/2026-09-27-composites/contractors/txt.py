import re,html,sys
t=open(sys.argv[1],encoding='utf-8',errors='ignore').read()
t=re.sub(r'<script.*?</script>|<style.*?</style>|<noscript.*?</noscript>','',t,flags=re.S|re.I)
s=re.sub(r'\s+',' ',html.unescape(re.sub(r'<[^>]+>',' ',t)))
print(s)
