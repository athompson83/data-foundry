"""Shared fetch helper for the round 35 (2026-11-28) scout scripts. Stdlib only.

Every request carries the declared User-Agent and is made one at a time with a pause. When the
environment variable SCOUT_CACHE names a directory, a response body is kept there and reused on the
next run of the same day, so a re-run does not download the large files again; without it every
request goes to the source. Each fetched body is recorded with its byte count and SHA-256.
"""
import hashlib, json, os, time, urllib.error, urllib.request

UA = "data-foundry-scout/1.0 (data@mail.proviciency.com)"
CACHE = os.environ.get("SCOUT_CACHE")
FETCHED = {}
REQUESTS = 0
REUSED = []


def get(name, url, timeout=300, accept="*/*"):
    """Return the response body as bytes; record url, bytes and sha256 under `name`."""
    global REQUESTS
    path = os.path.join(CACHE, name) if CACHE else None
    if path and os.path.exists(path):
        body = open(path, "rb").read()
        REUSED.append(name)
    else:
        REQUESTS += 1
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": accept})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
        time.sleep(0.5)
        if path:
            open(path, "wb").write(body)
    FETCHED[name] = {"url": url, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    return body


def status(url, timeout=60):
    """HTTP status of a GET, without raising on 4xx/5xx."""
    global REQUESTS
    REQUESTS += 1
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    time.sleep(0.5)
    return code


def write(script_file, out):
    out["fetched"] = FETCHED
    # A body fetched earlier the same day by one of this round's scripts is reused, not downloaded again.
    out["requests"] = {"made_this_run": REQUESTS, "bodies_reused_from_same_day_cache": len(REUSED), "source_bodies": len(FETCHED)}
    target = os.path.splitext(os.path.abspath(script_file))[0] + ".json"
    json.dump(out, open(target, "w"), indent=1, sort_keys=True, ensure_ascii=False)
    print(json.dumps({k: v for k, v in out.items() if k != "fetched"}, indent=1, ensure_ascii=False)[:9000])


def getz(name, url, timeout=300):
    """Like get(), but sends Accept-Encoding: gzip and decompresses (the eCFR API answers HTTP 406 without it)."""
    global REQUESTS
    import gzip
    path = os.path.join(CACHE, name) if CACHE else None
    if path and os.path.exists(path):
        body = open(path, "rb").read()
        REUSED.append(name)
    else:
        REQUESTS += 1
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                body = gzip.decompress(body)
        time.sleep(0.5)
        if path:
            open(path, "wb").write(body)
    FETCHED[name] = {"url": url, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    return body


def try_get(name, url, timeout=90):
    """get() that returns (body, None) or (None, reason) instead of raising."""
    try:
        return get(name, url, timeout=timeout), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as e:
        return None, type(e).__name__
