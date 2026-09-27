#!/bin/bash
# usage: gettext.sh name url
UA="DataFoundry/1.0 (data@mail.proviciency.com)"
mkdir -p terms
# Never follows redirects (-L): a redirect once led to a prohibited domain. A 3xx is reported, not followed.
code=$(curl -sS -A "$UA" --max-time 60 -o terms/$1.html -w "%{http_code} %{url_effective}" "$2")
echo "$1 $code $(wc -c < terms/$1.html)"
case "$code" in 2*) ;; *) echo "$1: HTTP $code; not a terms page" >&2; exit 1;; esac
python3 -c "
import re,html,sys
t=open('terms/$1.html',errors='ignore').read()
t=re.sub(r'(?s)<script.*?</script>|<style.*?</style>','',t)
s=re.sub(r'\s+',' ',html.unescape(re.sub('<[^>]+>',' ',t)))
open('terms/$1.txt','w').write(s)"
