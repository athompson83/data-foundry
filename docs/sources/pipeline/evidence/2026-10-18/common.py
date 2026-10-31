import json, urllib.request, urllib.parse, time
UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
def get(url, tries=3, raw=False):
    for i in range(tries):
        try:
            r = urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=45)
            b = r.read()
            return b if raw else json.loads(b)
        except Exception as e:
            err = e; time.sleep(2 * (i + 1))
    return None
